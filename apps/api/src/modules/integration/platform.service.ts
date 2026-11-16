import {
  Injectable,
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Actor } from '../../common/types/actor';
import { admin } from '../workspace/access';
export type Platform = 'dingtalk' | 'feishu';
export function platform(value: string): Platform {
  if (value !== 'dingtalk' && value !== 'feishu') throw new BadRequestException('仅支持钉钉、飞书');
  return value;
}
interface Config {
  appId: string;
  secret: string;
  tenantId: number;
}
@Injectable()
export class PlatformService {
  private readonly cache = new Map<string, { token: string; until: number }>();
  private config(provider: Platform, a: Actor): Config {
    if (!admin(a)) throw new ForbiddenException('仅管理员可管理集成');
    const prefix = provider === 'dingtalk' ? 'DINGTALK' : 'FEISHU';
    const appId =
      process.env[`${prefix}_APP_ID`] ?? (provider === 'dingtalk' ? process.env.DINGTALK_APP_KEY : '') ?? '';
    const secret = process.env[`${prefix}_APP_SECRET`] ?? '',
      tenantId = Number(process.env[`${prefix}_TENANT_ID`]);
    if (!appId || !secret || tenantId !== a.tenantId)
      throw new ServiceUnavailableException('当前租户尚未配置应用凭证，请在服务器本地环境配置并重启');
    return { appId, secret, tenantId };
  }
  statuses(a: Actor) {
    return (['dingtalk', 'feishu'] as const).map((provider) => {
      try {
        const c = this.config(provider, a);
        return {
          code: provider,
          name: provider === 'dingtalk' ? '钉钉' : '飞书',
          configured: true,
          appId: c.appId,
          connected: null,
          message: '已配置，需连接测试；不代表真实企业联调已通过',
        };
      } catch {
        return {
          code: provider,
          name: provider === 'dingtalk' ? '钉钉' : '飞书',
          configured: false,
          connected: false,
          message: '未配置当前租户的应用凭证',
        };
      }
    });
  }
  private async request(url: string, init: RequestInit = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
      } catch {
        throw new BadGatewayException('平台连接失败或超时，请检查网络');
      }
      if (response.status === 429 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      let body: Record<string, unknown>;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        throw new BadGatewayException('平台返回格式无效');
      }
      if (!response.ok || Number(body.errcode ?? body.code ?? 0) !== 0)
        throw new BadGatewayException(
          `平台请求失败（${String(body.errcode ?? body.code ?? response.status).slice(0, 30)}），请检查凭证、权限、可见范围及IP白名单`,
        );
      return body;
    }
    throw new BadGatewayException('平台限流，请稍后重试');
  }
  private async token(provider: Platform, a: Actor, force = false) {
    const c = this.config(provider, a),
      cacheKey = `${a.tenantId}:${provider}`,
      cached = this.cache.get(cacheKey);
    if (!force && cached && cached.until > Date.now()) return cached.token;
    const body =
      provider === 'dingtalk'
        ? await this.request('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appKey: c.appId, appSecret: c.secret }),
          })
        : await this.request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: c.appId, app_secret: c.secret }),
          });
    const token = body.accessToken ?? body.tenant_access_token,
      expires = Number(body.expireIn ?? body.expire ?? 7200);
    if (typeof token !== 'string' || !token) throw new BadGatewayException('平台未返回有效令牌');
    this.cache.set(cacheKey, { token, until: Date.now() + Math.max(0, Math.min(expires, 7200) - 120) * 1000 });
    return token;
  }
  async test(provider: Platform, a: Actor) {
    await this.token(provider, a, true);
    return {
      code: provider,
      connected: true,
      checkedAt: new Date().toISOString(),
      message: '应用令牌获取成功；通讯录权限需单独预览验证',
    };
  }
  async directory(provider: Platform, a: Actor, q: Record<string, string>) {
    const token = await this.token(provider, a);
    const departmentId = (q.departmentId ?? (provider === 'dingtalk' ? '1' : '0')).slice(0, 100),
      cursor = (q.cursor ?? '').slice(0, 500);
    if (provider === 'dingtalk') {
      if (!/^\d+$/.test(departmentId) || (cursor && !/^\d+$/.test(cursor)))
        throw new BadRequestException('部门或分页参数无效');
      const response = await this.request(
        `https://oapi.dingtalk.com/topapi/v2/user/list?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dept_id: Number(departmentId), cursor: Number(cursor || 0), size: 100 }),
        },
      );
      const result = response.result as {
        list?: { userid: string; name: string; dept_id_list?: number[] }[];
        has_more?: boolean;
        next_cursor?: number;
      };
      return {
        items: (result?.list ?? []).map((u) => ({
          externalId: u.userid,
          name: u.name,
          departmentIds: u.dept_id_list ?? [],
        })),
        hasMore: result?.has_more === true,
        nextCursor: result?.has_more ? String(result.next_cursor) : null,
        imported: false,
      };
    }
    const params = new URLSearchParams({
      department_id: departmentId,
      department_id_type: 'open_department_id',
      user_id_type: 'open_id',
      page_size: '50',
      ...(cursor ? { page_token: cursor } : {}),
    });
    const response = await this.request(
      `https://open.feishu.cn/open-apis/contact/v3/users/find_by_department?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = response.data as {
      items?: { open_id: string; name: string; department_ids?: string[] }[];
      has_more?: boolean;
      page_token?: string;
    };
    return {
      items: (data?.items ?? []).map((u) => ({
        externalId: u.open_id,
        name: u.name,
        departmentIds: u.department_ids ?? [],
      })),
      hasMore: data?.has_more === true,
      nextCursor: data?.has_more ? data.page_token : null,
      imported: false,
    };
  }
  async departments(provider: Platform, a: Actor, q: Record<string, string>) {
    const token = await this.token(provider, a),
      parent = (q.parentId ?? (provider === 'dingtalk' ? '1' : '0')).slice(0, 100);
    if (provider === 'dingtalk') {
      if (!/^\d+$/.test(parent)) throw new BadRequestException('部门编号无效');
      const data = await this.request(
        `https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dept_id: Number(parent) }),
        },
      );
      return {
        items: ((data.result ?? []) as { dept_id: number; name: string; parent_id: number }[]).map((d) => ({
          externalId: String(d.dept_id),
          name: d.name,
          parentId: String(d.parent_id),
        })),
        hasMore: false,
      };
    }
    const params = new URLSearchParams({
      department_id_type: 'open_department_id',
      page_size: '50',
      ...(q.cursor ? { page_token: q.cursor.slice(0, 500) } : {}),
    });
    const data = await this.request(
      `https://open.feishu.cn/open-apis/contact/v3/departments/${encodeURIComponent(parent)}/children?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const result = data.data as {
      items?: { open_department_id: string; name: string; parent_department_id: string }[];
      has_more?: boolean;
      page_token?: string;
    };
    return {
      items: (result?.items ?? []).map((d) => ({
        externalId: d.open_department_id,
        name: d.name,
        parentId: d.parent_department_id,
      })),
      hasMore: result?.has_more === true,
      nextCursor: result?.page_token,
    };
  }
}
