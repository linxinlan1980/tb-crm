/**
 * 统一连接器接口
 * 所有外部系统集成实现此接口，通过连接器注册表管理
 * 参考文档：crm/05_集成方案/钉钉_用友_邮件集成方案.md §4
 */
export interface Connector {
  /** 连接器编码（唯一标识） */
  code: string;
  /** 连接器名称 */
  name: string;

  /** 建立连接（验证凭证有效性） */
  connect(config: TenantIntegrationConfig): Promise<void>;
  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 数据同步 */
  sync(direction: 'inbound' | 'outbound', payload: SyncPayload): Promise<SyncResult>;

  /** Webhook回调处理 */
  webhook?(event: WebhookEvent): Promise<void>;

  /** 健康检查 */
  healthCheck(): Promise<HealthStatus>;
}

export interface TenantIntegrationConfig {
  tenantId: number;
  enabled: boolean;
  credentials: Record<string, string>; // 加密存储的凭证
  settings: Record<string, any>;       // 集成配置（字段映射等）
}

export interface SyncPayload {
  objectType: string;   // customer / order / invoice / receipt
  action: 'create' | 'update' | 'delete' | 'query';
  data: Record<string, any>;
  objectId?: number;
}

export interface SyncResult {
  success: boolean;
  externalId?: string;
  externalNo?: string;
  error?: string;
  raw?: any;
}

export interface WebhookEvent {
  source: string;
  eventType: string;
  payload: Record<string, any>;
  signature?: string;
  timestamp?: number;
}

export interface HealthStatus {
  connected: boolean;
  lastSyncAt?: Date;
  lastError?: string;
  latencyMs?: number;
}

/**
 * 连接器注册表（运行时管理所有连接器实例）
 */
export class ConnectorRegistry {
  private connectors = new Map<string, Connector>();

  register(connector: Connector) {
    this.connectors.set(connector.code, connector);
  }

  get(code: string): Connector | undefined {
    return this.connectors.get(code);
  }

  list(): Connector[] {
    return [...this.connectors.values()];
  }

  async healthCheckAll(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {};
    for (const [code, connector] of this.connectors) {
      results[code] = await connector.healthCheck().catch(() => ({ connected: false, lastError: 'health check failed' }));
    }
    return results;
  }
}

export const connectorRegistry = new ConnectorRegistry();
