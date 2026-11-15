import { createHash } from 'node:crypto';
import { DwsActivities } from './dws-activities';
import { bindingHash, record, type DwsBinding, type DwsRead } from './dws-directory';
export const nativeFormLabels = [
  '本地审批编号',
  '合同编号',
  '合同名称',
  '客户名称',
  '签约主体',
  '合同金额',
  'CRM申请人',
  '审核指纹',
  '说明',
] as const;
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const nativeHash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export interface NativeExpectation {
  tenantId: number;
  approvalId: number;
  approvalVersion: string;
  nodeIds: number[];
  contractId: number;
  contractVersion: string;
  processCode: string;
  departmentId: number;
  originatorId: string;
  approverIds: string[];
  formValues: Record<string, string>;
  templateHash: string;
  bindingHash: string;
}
export interface NativeTemplate {
  processCode: string;
  name: string;
  templateHash: string;
  fieldSchemaHash: string;
  allowedUserIds: string[];
}
export interface NativeEvidence {
  readonly instanceId: string;
  readonly expected: NativeExpectation;
  readonly status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  readonly decisionUserId: string | null;
  readonly note: string;
  readonly digest: string;
  readonly observed: unknown;
}
const issued = new WeakSet<object>();
export function assertNativeEvidence(value: NativeEvidence) {
  if (!issued.has(value)) throw Error('审批证据并非来自本机钉钉读取');
}
function parse(value: unknown) {
  return record(typeof value === 'string' ? JSON.parse(value) : value);
}
function array(value: unknown) {
  if (!Array.isArray(value)) throw Error('钉钉审批列表未完整返回');
  return value.map(record);
}
function exactStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v)) throw Error('审批人员编号无效');
  return value as string[];
}
const sameIds = (a: string[], b: string[]) =>
  JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
export function nativeTemplate(value: unknown, processCode: string): NativeTemplate {
  const response = record(value);
  if (response.ok !== true) throw Error('钉钉模板读取失败');
  const templates = array(record(response.data).templates);
  if (templates.length !== 1 || templates[0].processCode !== processCode) throw Error('钉钉模板编号不唯一');
  const t = templates[0],
    schema = parse(t.schemaContent),
    process = parse(t.processConfig),
    node = record(process.childNode),
    props = record(node.properties),
    rules = array(props.actionerRules);
  const properties = parse(t.properties);
  if (
    t.status !== 'PUBLISHED' ||
    process.type !== 'start' ||
    node.type !== 'approver' ||
    node.childNode ||
    props.activateType !== 'ALL' ||
    props.agreeAll !== false ||
    props.approvalType !== 'MANUAL' ||
    rules.length !== 1 ||
    rules[0].type !== 'target_approval' ||
    properties.autoExecuteOriginatorTasks !== 'false'
  )
    throw Error('模板必须为单步人工固定人员或签，且禁止申请人自动审批');
  const fields = array(schema.items);
  if (fields.length !== nativeFormLabels.length) throw Error('模板字段数量不匹配，不能遗漏其他字段');
  for (const label of nativeFormLabels) {
    const matches = fields.filter((f) => record(f.props).label === label);
    if (matches.length !== 1 || matches[0].componentName !== 'TextField' || record(matches[0].props).required !== true)
      throw Error('模板缺少必填文本字段：' + label);
  }
  const allowed = array(rules[0].approvals).map((p) => String(p.workNo ?? ''));
  if (allowed.some((v) => !v) || new Set(allowed).size !== allowed.length) throw Error('模板人员范围无效');
  return {
    processCode,
    name: String(t.name),
    templateHash: nativeHash({ schema, process, properties }),
    fieldSchemaHash: nativeHash(
      fields.map((f) => ({
        componentName: f.componentName,
        id: record(f.props).id,
        label: record(f.props).label,
        required: record(f.props).required,
      })),
    ),
    allowedUserIds: allowed,
  };
}
/** Only server-selected commands and the caller's operator-bound profile. No body-supplied CLI or result evidence. */
export class DwsNativeApprovals {
  private verifiedAt = 0;
  private departments: number[] = [];
  constructor(
    private readonly binding: DwsBinding,
    private readonly read: DwsRead,
  ) {}
  async verify() {
    const self = await new DwsActivities(this.binding, this.read).verifyIdentity();
    if (!Array.isArray(self.depts)) throw Error('本人所属部门未完整返回');
    this.departments = self.depts.map((v) => Number(record(v).deptId));
    this.verifiedAt = Date.now();
  }
  private identity(expected: NativeExpectation) {
    if (
      !this.verifiedAt ||
      Date.now() - this.verifiedAt > 300000 ||
      expected.bindingHash !== bindingHash(this.binding) ||
      expected.originatorId !== this.binding.userId ||
      !this.departments.includes(expected.departmentId)
    )
      throw Error('当前审批本人授权未核验或已过期');
  }
  async template(code: string) {
    return nativeTemplate(await this.read(['oa', 'approval', 'template', 'detail', '--process-code', code]), code);
  }
  async freshForm(code: string, template: NativeTemplate) {
    const r = record(await this.read(['oa', 'approval', 'form-schema', '--process-code', code]));
    if (r.success !== true) throw Error('钉钉表单Schema未读取成功');
    const schema = parse(record(r.result).content),
      fields = array(schema.items);
    const digest = nativeHash(
      fields.map((f) => ({
        componentName: f.componentName,
        id: record(f.props).id,
        label: record(f.props).label,
        required: record(f.props).required,
      })),
    );
    if (digest !== template.fieldSchemaHash) throw Error('发起表单与模板字段定义不一致');
  }
  async forecast(expected: NativeExpectation, template: NativeTemplate) {
    this.identity(expected);
    if (!sameIds(expected.approverIds, template.allowedUserIds) || expected.approverIds.includes(expected.originatorId))
      throw Error('钉钉审批人员不在模板范围，或包含申请人');
    const request = {
      processCode: expected.processCode,
      deptId: expected.departmentId,
      formComponentValues: [Object.entries(expected.formValues).map(([name, value]) => ({ name, value }))],
    };
    return this.read(['oa', 'approval', 'forecast-process', '--request', JSON.stringify(request)]);
  }
  async create(expected: NativeExpectation, template: NativeTemplate) {
    this.identity(expected);
    if (template.templateHash !== expected.templateHash || !sameIds(template.allowedUserIds, expected.approverIds))
      throw Error('审批模板或人员与已确认内容不一致');
    const request = {
      processCode: expected.processCode,
      deptId: expected.departmentId,
      formComponentValues: Object.entries(expected.formValues).map(([name, value]) => ({ name, value })),
    };
    // The application calls this only after the user confirms this immutable preview.
    const result = record(
      await this.read(['oa', 'approval', 'create-instance', '--request', JSON.stringify(request), '--yes']),
    );
    if (result.success !== true) throw Error('钉钉审批创建未核定成功，不可直接重发');
    const value = record(result.result),
      id = value.processInstanceId;
    if (typeof id !== 'string' || !id || id.length > 100) throw Error('钉钉未返回确定的审批编号，不可直接重发');
    return id;
  }
  async evidence(instanceId: string, expected: NativeExpectation): Promise<NativeEvidence> {
    this.identity(expected);
    const detailResponse = record(await this.read(['oa', 'approval', 'detail', '--instance-id', instanceId]));
    if (detailResponse.errcode !== 0) throw Error('钉钉审批详情未成功');
    const d = record(detailResponse.result);
    const recordsResponse = record(await this.read(['oa', 'approval', 'records', '--instance-id', instanceId]));
    if (recordsResponse.success !== true) throw Error('钉钉审批记录未成功');
    const records = record(recordsResponse.result);
    if (
      d.processInstanceId !== instanceId ||
      records.processInstanceId !== instanceId ||
      d.processCode !== expected.processCode ||
      d.originatorUserid !== expected.originatorId ||
      String(d.originatorDeptId) !== String(expected.departmentId)
    )
      throw Error('钉钉审批身份、流程或部门不匹配');
    const fields = array(d.formValueVOS);
    for (const [label, value] of Object.entries(expected.formValues)) {
      const matches = fields.filter((f) => f.name === label);
      if (matches.length !== 1 || matches[0].value !== value) throw Error('钉钉表单与已确认的合同快照不一致：' + label);
    }
    if (fields.length !== nativeFormLabels.length) throw Error('钉钉审批存在未核验的额外字段');
    const tasks = array(d.tasks);
    const taskUsers = tasks.map((t) => String(t.userId ?? ''));
    if (!sameIds(taskUsers, expected.approverIds)) throw Error('钉钉实际审批人集合与CRM不一致；不回写');
    let status: NativeEvidence['status'] = 'pending',
      winner: string | null = null,
      note = '';
    if (d.status === 'COMPLETED') {
      const result = String(d.processInstanceResult).toLowerCase();
      const success = result === 'agree';
      if (!success && !['refuse', 'reject'].includes(result)) throw Error('钉钉审批结果不支持，未回写');
      const accepted = success ? ['AGREE'] : ['REFUSE', 'REJECT'];
      const actions = array(records.operationRecords).filter(
        (r) =>
          r.operationType === 'EXECUTE_TASK_NORMAL' &&
          accepted.includes(String(r.operationResult)) &&
          expected.approverIds.includes(String(r.userId)),
      );
      const resolved = actions.filter((r) =>
        tasks.some(
          (t) => t.userId === r.userId && t.taskStatus === 'COMPLETED' && accepted.includes(String(t.taskResult)),
        ),
      );
      if (!resolved.length) throw Error('未找到实际审批人完成的决定，不能以待办完成或系统自动通过代替');
      resolved.sort((a, b) => Number(a.operationTime) - Number(b.operationTime));
      winner = String(resolved[0].userId);
      status = success ? 'approved' : 'rejected';
      const source = array(d.operationRecords).find(
        (r) => r.type === 'EXECUTE_TASK_NORMAL' && r.userId === winner && accepted.includes(String(r.result)),
      );
      if (!source) throw Error('钉钉详情和处理记录不一致');
      note = typeof source.remark === 'string' ? source.remark : '';
    } else if (d.status === 'TERMINATED') status = 'cancelled';
    else if (!['RUNNING', 'NEW'].includes(String(d.status))) throw Error('钉钉状态未知，未回写');
    const observed = { detail: detailResponse, records: recordsResponse },
      proof = Object.freeze({
        instanceId,
        expected: Object.freeze({
          ...expected,
          nodeIds: Object.freeze([...expected.nodeIds]) as unknown as number[],
          approverIds: Object.freeze([...expected.approverIds]) as unknown as string[],
          formValues: Object.freeze({ ...expected.formValues }),
        }),
        status,
        decisionUserId: winner,
        note,
        digest: nativeHash(observed),
        observed,
      });
    issued.add(proof);
    return proof;
  }
}
export function nativeUserIds(value: unknown) {
  const response = record(value);
  if (response.success !== true) throw Error('审批人员详情未读取成功');
  return array(response.result).map((v) => {
    const p = record(v.orgEmployeeModel);
    if (typeof p.orgUserId !== 'string' || typeof p.orgUserName !== 'string') throw Error('审批人员缺少真实身份');
    return { id: p.orgUserId, name: p.orgUserName };
  });
}
export function expectedNativeIds(value: unknown) {
  return exactStrings(value);
}
