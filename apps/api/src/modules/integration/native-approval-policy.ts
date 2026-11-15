import { BadRequestException } from '@nestjs/common';
import { nativeHash, type NativeExpectation } from './dws-native-approval';
import { record } from './dws-directory';
export const nativeApprovalKey = 'crm.dingtalk-native-approval.v1';
export interface NativeApprovalPolicy {
  enabled: boolean;
  processCode: string;
  departmentId: number;
  flowId: number;
  fromDate: string;
  autoPoll: boolean;
}
export function parseNativePolicy(input: unknown): NativeApprovalPolicy {
  const p = record(input);
  if (
    Object.keys(p).some(
      (k) => !['enabled', 'processCode', 'departmentId', 'flowId', 'fromDate', 'autoPoll'].includes(k),
    ) ||
    typeof p.enabled !== 'boolean' ||
    typeof p.autoPoll !== 'boolean' ||
    typeof p.processCode !== 'string' ||
    !/^PROC-[A-Z0-9-]{8,90}$/.test(p.processCode) ||
    !Number.isSafeInteger(p.departmentId) ||
    Number(p.departmentId) < 1 ||
    !Number.isSafeInteger(p.flowId) ||
    Number(p.flowId) < 1 ||
    typeof p.fromDate !== 'string' ||
    p.fromDate < '2010-01-01' ||
    p.fromDate > '2060-12-31' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(p.fromDate) ||
    !Number.isFinite(Date.parse(p.fromDate)) ||
    new Date(p.fromDate).toISOString().slice(0, 10) !== p.fromDate
  )
    throw new BadRequestException('钉钉原生审批设置无效');
  return p as unknown as NativeApprovalPolicy;
}
export function nativeFormValues(value: {
  approvalId: number;
  approvalVersion: string;
  contractId: number;
  contractVersion: string;
  contractNo: string;
  name: string;
  customerName: string;
  signingCompany: string | null;
  amount: string;
  applicantName: string;
  paymentTerms: string | null;
  remark: string | null;
  currency: string;
  contractType: string;
  taxRate: string;
  approverIds: string[];
}): Record<string, string> {
  const fingerprint = nativeHash(value);
  const detail = `合同类型：${value.contractType}；币种：${value.currency}；税率：${value.taxRate}%\n付款约定：${value.paymentTerms ?? '未填写'}\n备注：${value.remark ?? '未填写'}\n由CRM真实申请人的本人授权提交，审批决定由钉钉实际审批人作出。`;
  if (detail.length > 4000) throw new BadRequestException('合同条款过长，当前钉钉表单不能完整承载，请使用本地审批');
  return {
    本地审批编号: String(value.approvalId),
    合同编号: value.contractNo,
    合同名称: value.name,
    客户名称: value.customerName,
    签约主体: value.signingCompany ?? '未填写',
    合同金额: value.amount + ' ' + value.currency,
    CRM申请人: value.applicantName,
    审核指纹: fingerprint,
    说明: detail,
  };
}
export function nativeSnapshot(value: unknown): {
  expected: NativeExpectation;
  template: import('./dws-native-approval').NativeTemplate;
  settingsVersion: string;
  expiresAt: string;
} {
  return value as ReturnType<typeof nativeSnapshot>;
}
