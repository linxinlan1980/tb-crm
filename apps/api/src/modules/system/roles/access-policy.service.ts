import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '../../../common/types/actor';
import { PrismaService } from '../../../database/prisma.service';
import { checkVersion, object, runCommand, validateActor } from '../../workspace/command-runner';
import { accessCatalog, configuredPoints, parsePolicy, permits, policyPermissions } from './access-policy';
import { roleAuthority } from '../../../common/types/role-authority';
const administrator = (actor: Actor) => {
  if (!actor.roles.includes('super_admin')) throw new ForbiddenException('仅管理员可配置权限');
};
@Injectable()
export class AccessPolicyService {
  constructor(private prisma: PrismaService) {}
  async person(actor: Actor, targetId: number) {
    administrator(actor);
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, actor);
        const person = await tx.user.findFirst({
          where: { id: targetId, tenantId: actor.tenantId, deletedAt: null },
          select: {
            id: true,
            name: true,
            username: true,
            status: true,
            department: { select: { id: true, name: true } },
            roles: { include: { role: true } },
          },
        });
        if (!person) throw new NotFoundException('当前公司人员不存在');
        const authority = roleAuthority(person.roles.map((r) => r.role));
        return {
          user: {
            id: person.id,
            name: person.name,
            username: person.username,
            status: person.status,
            department: person.department,
          },
          roles: person.roles.map((r) => ({ id: r.role.id, name: r.role.name, code: r.role.code })),
          permissions: authority.permissions,
          dataScope: authority.dataScope,
          configuredPoints: configuredPoints(authority.permissions),
          catalog: accessCatalog,
          assignedCustomers: await tx.customer.count({
            where: { tenantId: actor.tenantId, ownerId: targetId, deletedAt: null },
          }),
          notice:
            person.status === 'active'
              ? '当前有效权限来自角色；公海、显式协作及敏感操作仍遵守各业务规则'
              : '人员未启用，不能登录；以下是其角色配置，启用后才生效',
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async state(actor: Actor) {
    administrator(actor);
    return this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, actor);
      const roles = await tx.role.findMany({
        where: { tenantId: actor.tenantId, code: { in: ['super_admin', 'sales_manager', 'sales', 'gm'] } },
        orderBy: { id: 'asc' },
        include: { _count: { select: { userRoles: true } } },
      });
      return {
        catalog: accessCatalog,
        scopes: [
          { code: 'self', name: '本人及显式协作' },
          { code: 'dept', name: '本部门（不含下级）及显式协作' },
          { code: 'all', name: '当前公司' },
        ],
        roles: roles.map((role) => ({
          ...role,
          configuredPoints: configuredPoints(role.permissions),
          editable: ['sales', 'sales_manager'].includes(role.code),
        })),
      };
    });
  }
  save(actor: Actor, roleId: number, body: Record<string, unknown>) {
    administrator(actor);
    object(body);
    if (Object.keys(body).some((k) => !['requestKey', 'expectedUpdatedAt', 'permissions', 'dataScope'].includes(k)))
      throw new BadRequestException('不允许的权限配置参数');
    return runCommand(this.prisma, actor, 'identity.role.policy.update@1.0', { ...body, roleId }, async (tx) => {
      await tx.tenant.update({ where: { id: actor.tenantId }, data: { updatedAt: new Date() } });
      const role = await tx.role.findFirst({ where: { id: roleId, tenantId: actor.tenantId } });
      if (!role) throw new NotFoundException('当前公司角色不存在');
      checkVersion(role, body.expectedUpdatedAt);
      const policy = parsePolicy(role.code, body.permissions, body.dataScope),
        permissions = policyPermissions(role.permissions, policy.points);
      const members = await tx.user.findMany({
        where: { tenantId: actor.tenantId, deletedAt: null, roles: { some: { tenantId: actor.tenantId, roleId } } },
        select: { id: true },
        take: 501,
      });
      if (members.length > 500) throw new ConflictException('角色成员超过本批配置预算');
      const ids = members.map((u) => u.id);
      if (
        await tx.approvalNode.count({
          where: {
            tenantId: actor.tenantId,
            approverId: { in: ids },
            action: 'pending',
            approval: { status: 'pending' },
          },
        })
      )
        throw new ConflictException('角色成员仍有待处理审批，请先转审或处理；紧急撤权可重置人员密码');
      if (!['project:read', 'project:update'].every((p) => permits(permissions, p))) {
        const responsibilities = await Promise.all([
          tx.project.count({
            where: {
              tenantId: actor.tenantId,
              pmId: { in: ids },
              deletedAt: null,
              status: { notIn: ['completed', 'cancelled'] },
            },
          }),
          tx.projectTask.count({
            where: {
              tenantId: actor.tenantId,
              assigneeId: { in: ids },
              deletedAt: null,
              status: { notIn: ['done', 'cancelled'] },
              project: { deletedAt: null, status: { notIn: ['completed', 'cancelled'] } },
            },
          }),
          tx.serviceTicket.count({
            where: { tenantId: actor.tenantId, assigneeId: { in: ids }, status: { notIn: ['closed', 'cancelled'] } },
          }),
        ]);
        if (responsibilities.some(Boolean))
          throw new ConflictException('角色成员仍有项目、任务或工单责任，请先交接再收回交付权限');
      }
      const updated = await tx.role.update({
        where: { id: role.id },
        data: { permissions, dataScope: policy.dataScope },
      });
      const sessions = await tx.authSession.updateMany({
        where: { tenantId: actor.tenantId, userId: { in: ids }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return {
        id: updated.id,
        name: updated.name,
        code: updated.code,
        permissions: updated.permissions,
        dataScope: updated.dataScope,
        updatedAt: updated.updatedAt,
        affectedPeople: ids.length,
        revokedSessions: sessions.count,
        previousPolicy: { permissions: role.permissions, dataScope: role.dataScope },
      };
    });
  }
}
