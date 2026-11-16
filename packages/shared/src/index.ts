/**
 * @partneros/shared - 前后端共享类型、常量、工具
 * 所有业务枚举/错误码/事件名/权限点在此定义，前后端统一引用
 */

// ===== 枚举常量 =====
export const POOL_TYPE = { PUBLIC: 'public', DEPT: 'dept', PRIVATE: 'private' } as const;
export type PoolType = (typeof POOL_TYPE)[keyof typeof POOL_TYPE];

export const CUSTOMER_STATUS = { ACTIVE: 'active', INACTIVE: 'inactive', CHURNED: 'churned' } as const;
export type CustomerStatus = (typeof CUSTOMER_STATUS)[keyof typeof CUSTOMER_STATUS];

export const LEAD_STATUS = {
  NEW: 'new', CLEANING: 'cleaning', QUALIFIED: 'qualified', UNQUALIFIED: 'unqualified',
  ASSIGNED: 'assigned', CONVERTED: 'converted', REJECTED: 'rejected', EXPIRED: 'expired',
} as const;
export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

export const OPP_STATUS = { OPEN: 'open', WON: 'won', LOST: 'lost', CANCELLED: 'cancelled', ON_HOLD: 'on_hold' } as const;
export type OppStatus = (typeof OPP_STATUS)[keyof typeof OPP_STATUS];

export const CONTRACT_TYPE = {
  SOFTWARE_SALE: 'software_sale', IMPLEMENTATION: 'implementation', MAINTENANCE: 'maintenance',
  OUTSOURCE: 'outsource', AI_FDE: 'ai_fde', SAAS_SUB: 'saas_sub', CHANNEL: 'channel',
} as const;
export type ContractType = (typeof CONTRACT_TYPE)[keyof typeof CONTRACT_TYPE];

export const CONTRACT_STATUS = {
  DRAFT: 'draft', PENDING_APPROVAL: 'pending_approval', APPROVED: 'approved', REJECTED: 'rejected',
  SIGNED: 'signed', EXECUTING: 'executing', COMPLETED: 'completed', TERMINATED: 'terminated', EXPIRED: 'expired',
} as const;
export type ContractStatus = (typeof CONTRACT_STATUS)[keyof typeof CONTRACT_STATUS];

export const ORDER_STATUS = {
  DRAFT: 'draft', PENDING_APPROVAL: 'pending_approval', APPROVED: 'approved', CONFIRMED: 'confirmed',
  SHIPPING: 'shipping', DELIVERED: 'delivered', COMPLETED: 'completed', CANCELLED: 'cancelled',
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const RECEIPT_STATUS = { DRAFT: 'draft', CONFIRMED: 'confirmed', VOIDED: 'voided' } as const;
export type ReceiptStatus = (typeof RECEIPT_STATUS)[keyof typeof RECEIPT_STATUS];

export const PAYMENT_PLAN_STATUS = {
  PENDING: 'pending', PARTIAL: 'partial', COMPLETED: 'completed', OVERDUE: 'overdue', CANCELLED: 'cancelled',
} as const;
export type PaymentPlanStatus = (typeof PAYMENT_PLAN_STATUS)[keyof typeof PAYMENT_PLAN_STATUS];

export const PROJECT_STAGE = {
  INITIATION: 'initiation', BLUEPRINT: 'blueprint', DEVELOPMENT: 'development', TESTING: 'testing',
  GO_LIVE: 'go_live', ACCEPTANCE: 'acceptance', MAINTENANCE: 'maintenance', CLOSED: 'closed',
} as const;
export type ProjectStage = (typeof PROJECT_STAGE)[keyof typeof PROJECT_STAGE];

export const MILESTONE_STATUS = {
  PENDING: 'pending', IN_PROGRESS: 'in_progress', COMPLETED: 'completed', DELAYED: 'delayed', CANCELLED: 'cancelled',
} as const;
export type MilestoneStatus = (typeof MILESTONE_STATUS)[keyof typeof MILESTONE_STATUS];

// ===== 错误码 =====
export const ERROR_CODES = {
  // 通用 00xxx
  VALIDATION_ERROR: 1, UNAUTHORIZED: 1001, FORBIDDEN: 3, NOT_FOUND: 5,
  DUPLICATE_ENTRY: 6, BUSINESS_RULE: 7, RATE_LIMITED: 8, INTERNAL: 9,
  // 认证 01xxx
  LOGIN_FAILED: 1001, ACCOUNT_LOCKED: 1002, ACCOUNT_DISABLED: 1003,
  TOKEN_EXPIRED: 1004, TOKEN_INVALID: 1005,
  // 客户 02xxx
  CUSTOMER_DUPLICATE_CREDIT_CODE: 2001, CUSTOMER_DUPLICATE_NAME: 2002,
  CUSTOMER_HAS_ACTIVE_OPP: 2003, CUSTOMER_HAS_ACTIVE_CONTRACT: 2004,
  // 公私海 04xxx
  POOL_PRIVATE_LIMIT: 4001, POOL_DAILY_LIMIT: 4002, POOL_COOLDOWN: 4003,
  POOL_ALREADY_PRIVATE: 4004, POOL_NOT_PUBLIC: 4009,
  // 商机 05xxx
  OPP_STAGE_REQUIRED_FIELDS: 5001, OPP_WIN_NEED_CONTRACT: 5003, OPP_LOSE_NEED_REASON: 5004,
  // 合同 06xxx
  CONTRACT_SUBMIT_INCOMPLETE: 6001, CONTRACT_NO_ITEMS: 6002, CONTRACT_AMOUNT_MISMATCH: 6006,
  // 订单 07xxx
  ORDER_EXCEED_CONTRACT: 7001, ORDER_CREDIT_BLOCKED: 7002, ORDER_DISCOUNT_EXCEED: 7004,
  // 财务 09xxx
  RECEIPT_ALLOCATE_EXCEED: 9001, RECEIPT_PLAN_EXCEED: 9002,
} as const;

// ===== 领域事件名 =====
export const EVENTS = {
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_ASSIGNED: 'customer.assigned',
  POOL_CLAIMED: 'pool.claimed',
  POOL_ASSIGNED: 'pool.assigned',
  POOL_RETURNED: 'pool.returned',
  POOL_RECYCLED: 'pool.recycled',
  LEAD_CONVERTED: 'lead.converted',
  OPP_STAGE_ADVANCED: 'opportunity.stage_advanced',
  OPP_WON: 'opportunity.won',
  OPP_LOST: 'opportunity.lost',
  CONTRACT_SIGNED: 'contract.signed',
  CONTRACT_TERMINATED: 'contract.terminated',
  MILESTONE_COMPLETED: 'milestone.completed',
  ORDER_CONFIRMED: 'order.confirmed',
  RECEIPT_CONFIRMED: 'receipt.confirmed',
  PAYMENT_OVERDUE: 'payment_plan.overdue',
  PROJECT_COMPLETED: 'project.completed',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected',
} as const;

// ===== 通用DTO类型 =====
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
  meta?: PaginationMeta;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}

// ===== 工具函数 =====
export function formatMoney(amount: number | string | null | undefined): string {
  if (amount == null) return '—';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '—';
  return `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatMoneyWan(amount: number | string | null | undefined): string {
  if (amount == null) return '—';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '—';
  if (num >= 10000) return `¥${(num / 10000).toFixed(1)}万`;
  return formatMoney(num);
}

export function daysUntil(date: string | Date | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(date);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 7) return phone || '—';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}
