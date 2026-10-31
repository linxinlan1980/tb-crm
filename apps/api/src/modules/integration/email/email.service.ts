import { Injectable, Logger } from '@nestjs/common';
import { Connector, SyncPayload, SyncResult, HealthStatus, TenantIntegrationConfig } from '../connector.interface';

/**
 * 邮件集成服务
 * 一期能力：SMTP发送（报价/催收/通知）/ IMAP接收→线索 / 邮件模板渲染
 * 参考文档：crm/05_集成方案/钉钉_用友_邮件集成方案.md §3
 *
 * 当前状态：骨架代码（S3实现完整逻辑）
 */
@Injectable()
export class EmailService implements Connector {
  private readonly logger = new Logger('EmailIntegration');
  readonly code = 'email';
  readonly name = '邮件集成';

  private config: TenantIntegrationConfig | null = null;

  async connect(config: TenantIntegrationConfig): Promise<void> {
    this.config = config;
    this.logger.log(`邮件连接器已配置（smtp=${config.credentials.smtpHost || 'localhost'}）`);
  }

  async disconnect(): Promise<void> { this.config = null; }

  async sync(direction: 'inbound' | 'outbound', payload: SyncPayload): Promise<SyncResult> {
    if (direction === 'outbound') return this.sendEmail(payload);
    return { success: false, error: '邮件不支持inbound sync（用pollEmails）' };
  }

  async healthCheck(): Promise<HealthStatus> {
    return { connected: !!this.config?.enabled };
  }

  // ===== 邮件专有方法 =====

  /** 发送邮件 */
  async sendEmail(payload: SyncPayload): Promise<SyncResult> {
    const { to, subject, html, text } = payload.data;
    // TODO S3: 使用nodemailer通过SMTP发送
    this.logger.debug(`[邮件发送] → ${to}: ${subject}`);
    return { success: true };
  }

  /** 发送模板邮件 */
  async sendTemplate(to: string, templateCode: string, variables: Record<string, any>): Promise<SyncResult> {
    // TODO S3: 从notification_templates获取模板→渲染变量→发送
    this.logger.debug(`[模板邮件] → ${to}: ${templateCode}`);
    return { success: true };
  }

  /** 轮询收件箱（IMAP）→ 自动创建线索 */
  async pollEmails(tenantId: number): Promise<{ processed: number; leadsCreated: number }> {
    // TODO S3: IMAP连接→拉取未读→解析发件人/主题/正文→匹配客户或创建线索
    this.logger.warn('邮件轮询: S3实现');
    return { processed: 0, leadsCreated: 0 };
  }
}
