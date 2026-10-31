import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  /**
   * 账号密码登录
   * 错误码：01001(用户名或密码错误) / 01002(账号锁定) / 01003(账号停用)
   */
  async login(dto: LoginDto) {
    // 查找用户（跨租户，因为登录时还不知道tenant_id）
    const user = await this.prisma.system.user.findFirst({
      where: { username: dto.username, deletedAt: null, tenant: { code: dto.tenantCode ?? 'TINGMENG' } },
      include: { tenant: true, department: true, roles: { include: { role: true } } },
    });

    if (!user) {
      throw new UnauthorizedException({ code: 1001, message: '用户名或密码错误' });
    }

    // 校验密码
    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      // TODO: 登录失败计数 + 锁定逻辑（Redis）
      throw new UnauthorizedException({ code: 1001, message: '用户名或密码错误' });
    }

    // 校验状态
    if (user.status === 'inactive') {
      throw new ForbiddenException({ code: 1003, message: '账号已停用，请联系管理员' });
    }
    if (user.status === 'resigned') {
      throw new ForbiddenException({ code: 1003, message: '账号已停用（离职），请联系管理员' });
    }

    // 校验租户状态
    if (user.tenant.status !== 'active' && user.tenant.status !== 'trial') {
      throw new ForbiddenException({ code: 1003, message: '租户已停用' });
    }

    // 更新最后登录时间
    await this.prisma.system.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 生成JWT
    return this.generateTokens(user);
  }

  /**
   * 钉钉免登
   */
  async dingtalkLogin(authCode: string) {
    // TODO S5: 调用钉钉API换取userId → 匹配CRM用户
    // 一期先返回mock，S5实现完整逻辑
    throw new UnauthorizedException({ code: 1008, message: '钉钉认证暂未实现（S5交付）' });
  }

  /**
   * 刷新Token
   */
  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      if (payload.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      const user = await this.prisma.system.user.findUnique({
        where: { id: payload.sub },
        include: { tenant: true, roles: { include: { role: true } } },
      });
      if (!user || user.status !== 'active' || !['active', 'trial'].includes(user.tenant.status)) {
        throw new UnauthorizedException({ code: 1007, message: '刷新令牌无效' });
      }
      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException({ code: 1007, message: '刷新令牌无效' });
    }
  }

  /**
   * 获取用户Profile（含权限）
   */
  async getProfile(userId: number, tenantId: number) {
    const user = await this.prisma.system.user.findUnique({
      where: { id: userId },
      include: {
        department: true,
        roles: { include: { role: true } },
      },
    });
    if (!user || user.tenantId !== tenantId) {
      throw new UnauthorizedException({ code: 1005, message: '用户不存在' });
    }

    const roles = user.roles.map((ur) => ur.role);
    const permissions = this.mergePermissions(roles);
    const dataScope = this.resolveDataScope(roles);

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      phone: user.phone, // TODO: 脱敏
      email: user.email,
      avatar: user.avatarUrl,
      dept: user.department ? { id: user.department.id, name: user.department.name } : null,
      position: user.position,
      roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
      permissions,
      dataScope,
    };
  }

  /**
   * 登出（Token加入黑名单）
   */
  async logout(userId: number) {
    // TODO: Redis黑名单（TTL=Token剩余有效期）
    return { message: '已登出' };
  }

  // ===== Private =====

  private generateTokens(user: any) {
    const roles = user.roles?.map((ur: any) => ur.role?.code || ur.code).filter(Boolean) || [];

    const payload = {
      sub: user.id,
      tid: user.tenantId,
      username: user.username,
      name: user.name,
      roles,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.config.get('app.jwt.accessExpiresIn', '2h'),
    });

    const refreshToken = this.jwtService.sign(
      { ...payload, type: 'refresh' },
      { expiresIn: this.config.get('app.jwt.refreshExpiresIn', '7d') },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 7200,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        avatar: user.avatarUrl,
        dept: user.department ? { id: user.department.id, name: user.department.name } : null,
        roles: roles,
      },
    };
  }

  private mergePermissions(roles: any[]): string[] {
    const perms = new Set<string>();
    for (const role of roles) {
      if (role.permissions) {
        const rolePerms = Array.isArray(role.permissions) ? role.permissions : [];
        rolePerms.forEach((p: string) => perms.add(p));
      }
    }
    return Array.from(perms);
  }

  private resolveDataScope(roles: any[]): string {
    // 取最大scope: all > dept > team > custom > self
    const scopeOrder = ['all', 'dept', 'team', 'custom', 'self'];
    for (const scope of scopeOrder) {
      if (roles.some((r) => r.dataScope === scope)) return scope;
    }
    return 'self';
  }
}
