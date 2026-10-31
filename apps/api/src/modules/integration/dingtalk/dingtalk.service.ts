import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connector, SyncPayload, SyncResult, HealthStatus, TenantIntegrationConfig } from '../connector.interface';

/**
 * 钉钉集成服务
 * 一期能力：组织架构同步 / 免登认证 / 审批双向同步 / 工作通知推送
 * 参考文档：crm/05_集成方案/钉钉_用友_邮件集成方案.md §1
 *
 * 当前状态：骨架代码（S5实现完整逻辑）
 */
@Injectable()
export class DingtalkService implements Connector {
  private readonly logger = new Logger('DingtalkIntegration');
  readonly code = 'dingtalk';
  readonly name = '钉钉集成';

  private config: TenantIntegrationConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private configService: ConfigService) {}

  async connect(config: TenantIntegrationConfig): Promise<void> {
    this.config = config;
    this.logger.log(`钉钉连接器已配置（corpId=${config.credentials.corpId || 'N/A'}）`);
  }

  async disconnect(): Promise<void> {
    this.config = null;
    this.accessToken = null;
  }

  async sync(direction: 'inbound' | 'outbound', payload: SyncPayload): Promise<SyncResult> {
    if (!this.config?.enabled) return { success: false, error: '钉钉集成未启用' };
    this.logger.debug(`[钉钉同步] ${direction} ${payload.objectType} ${payload.action}`);
    // TODO S5: 实现具体同步逻辑
    return { success: true };
  }

  async healthCheck(): Promise<HealthStatus> {
    return { connected: !!this.config?.enabled, lastError: this.config?.enabled ? undefined : '未配置' };
  }

  // ===== 钉钉专有方法（S5实现） =====

  /** 获取access_token（自动刷新） */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;
    // TODO: POST https://api.dingtalk.com/v1.0/oauth2/accessToken
    this.logger.warn('钉钉getAccessToken: S5实现');
    return '';
  }

  /** 免登：authCode → userId */
  async getUserIdByAuthCode(authCode: string): Promise<string | null> {
    // TODO S5: POST /v1.0/oauth2/userAccessToken → GET /v1.0/contact/users/me
    this.logger.warn('钉钉免登: S5实现');
    return null;
  }

  /** 发送工作通知（ActionCard） */
  async sendWorkNotification(userId: string, title: string, markdown: string, btnTitle: string, btnUrl: string): Promise<boolean> {
    // TODO S5: POST /topapi/message/corpconversation/asyncsend_v2
    this.logger.debug(`[钉钉通知] → ${userId}: ${title}`);
    return true;
  }

  /** 创建钉钉审批实例 */
  async createApprovalInstance(processCode: string, originatorUserId: string, formValues: Record<string, any>): Promise<string | null> {
    // TODO S5: POST /v1.0/workflow/processInstances
    this.logger.warn('钉钉审批创建: S5实现');
    return null;
  }

  /** 同步组织架构（部门+人员） */
  async syncOrganization(tenantId: number): Promise<{ depts: number; users: number }> {
    // TODO S5: 递归获取部门树 + 按部门获取人员 → 更新CRM
    this.logger.warn('钉钉组织同步: S5实现');
    return { depts: 0, users: 0 };
  }

  /** 验证Webhook回调签名 */
  verifyCallbackSignature(signature: string, timestamp: string, nonce: string, body: string): boolean {
    // TODO S5: 钉钉加密回调验签
    return true;
  }
}
