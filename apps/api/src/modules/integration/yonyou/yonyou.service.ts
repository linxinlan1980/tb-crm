import { Injectable, Logger } from '@nestjs/common';
import { Connector, SyncPayload, SyncResult, HealthStatus, TenantIntegrationConfig } from '../connector.interface';

/**
 * 用友集成服务（YonSuite / BIP / NC / U8C）
 * 一期能力：客商同步 / 销售订单同步 / 发票同步 / 收款凭证同步
 * 参考文档：crm/05_集成方案/钉钉_用友_邮件集成方案.md §2
 *
 * 当前状态：骨架代码（S8实现完整逻辑）
 */
@Injectable()
export class YonyouService implements Connector {
  private readonly logger = new Logger('YonyouIntegration');
  readonly code = 'yonyou';
  readonly name = '用友集成';

  private config: TenantIntegrationConfig | null = null;

  async connect(config: TenantIntegrationConfig): Promise<void> {
    this.config = config;
    this.logger.log(`用友连接器已配置（apiBase=${config.credentials.apiBase || 'N/A'}）`);
  }

  async disconnect(): Promise<void> { this.config = null; }

  async sync(direction: 'inbound' | 'outbound', payload: SyncPayload): Promise<SyncResult> {
    if (!this.config?.enabled) return { success: false, error: '用友集成未启用' };
    this.logger.debug(`[用友同步] ${direction} ${payload.objectType} ${payload.action}`);

    switch (`${direction}:${payload.objectType}`) {
      case 'outbound:customer': return this.pushCustomer(payload);
      case 'outbound:order': return this.pushOrder(payload);
      case 'outbound:invoice': return this.pushInvoice(payload);
      case 'outbound:receipt': return this.pushReceipt(payload);
      case 'inbound:customer': return this.pullCustomers(payload);
      default: return { success: false, error: `不支持的同步类型: ${direction}:${payload.objectType}` };
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    return { connected: !!this.config?.enabled, lastError: this.config?.enabled ? undefined : '未配置' };
  }

  // ===== 用友专有方法（S8实现） =====

  /** 推送客商到用友 */
  private async pushCustomer(payload: SyncPayload): Promise<SyncResult> {
    // TODO S8: POST /yonbip/customer/create
    this.logger.warn('用友客商推送: S8实现');
    return { success: true, externalId: 'MOCK' };
  }

  /** 推送销售订单到用友 */
  private async pushOrder(payload: SyncPayload): Promise<SyncResult> {
    // TODO S8: POST /yonbip/sales/order/create
    this.logger.warn('用友订单推送: S8实现');
    return { success: true, externalNo: 'MOCK-XS' };
  }

  /** 推送发票到用友 */
  private async pushInvoice(payload: SyncPayload): Promise<SyncResult> {
    // TODO S8: 同步应收/发票信息
    this.logger.warn('用友发票推送: S8实现');
    return { success: true };
  }

  /** 推送收款凭证到用友 */
  private async pushReceipt(payload: SyncPayload): Promise<SyncResult> {
    // TODO S8: POST /yonbip/receipt/voucher/create
    this.logger.warn('用友凭证推送: S8实现');
    return { success: true, externalNo: 'MOCK-记' };
  }

  /** 从用友拉取客商（数据迁移用） */
  private async pullCustomers(payload: SyncPayload): Promise<SyncResult> {
    // TODO S8/S11: 拉取用友客商列表
    this.logger.warn('用友客商拉取: S8实现');
    return { success: true };
  }

  /** NC/U8C中间库同步（老版本） */
  async syncViaMiddleDB(tenantId: number, objectType: string): Promise<SyncResult> {
    // TODO S8: 中间库ETL
    this.logger.warn('用友中间库同步: S8实现');
    return { success: true };
  }

  /** 月度对账 */
  async reconcile(tenantId: number): Promise<{ matched: number; mismatched: number; details: any[] }> {
    // TODO S8: 对比CRM vs 用友数据
    this.logger.warn('用友对账: S8实现');
    return { matched: 0, mismatched: 0, details: [] };
  }
}
