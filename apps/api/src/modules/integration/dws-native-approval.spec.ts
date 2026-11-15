import {
  DwsNativeApprovals,
  nativeCreationCandidate,
  assertNativeEvidence,
  nativeFormLabels,
  nativeHash,
  nativeTemplate,
  type NativeExpectation,
  type NativeEvidence,
} from './dws-native-approval';
import { bindingHash, type DwsRead } from './dws-directory';
import { nativeFormValues, parseNativePolicy } from './native-approval-policy';
const binding = { profile: 'synthetic', corpId: 'synthetic-corp', userId: 'synthetic-self' };
const values = Object.fromEntries(nativeFormLabels.map((v) => [v, 'Synthetic ' + v]));
const expected: NativeExpectation = {
  tenantId: 1,
  approvalId: 1,
  approvalVersion: '2026-11-15T00:00:00Z',
  nodeIds: [1, 2],
  contractId: 1,
  contractVersion: '2026-11-15T00:00:00Z',
  processCode: 'PROC-SYNTHETIC',
  departmentId: 1,
  originatorId: binding.userId,
  approverIds: ['synthetic-a', 'synthetic-b'],
  formValues: values,
  templateHash: 'synthetic-hash',
  bindingHash: bindingHash(binding),
};
function fixtures() {
  return {
    detail: {
      errcode: 0,
      result: {
        processInstanceId: 'synthetic-instance',
        processCode: expected.processCode,
        originatorUserid: binding.userId,
        originatorDeptId: '1',
        status: 'COMPLETED',
        processInstanceResult: 'agree',
        formValueVOS: Object.entries(values).map(([name, value]) => ({ name, value })),
        tasks: [
          { userId: 'synthetic-a', taskStatus: 'COMPLETED', taskResult: 'AGREE' },
          { userId: 'synthetic-b', taskStatus: 'CANCELED', taskResult: 'NONE' },
        ],
        operationRecords: [
          {
            type: 'EXECUTE_TASK_NORMAL',
            userId: 'synthetic-a',
            result: 'AGREE',
            remark: 'Synthetic decision',
            ccUserIds: [] as string[],
          },
        ],
      },
    },
    records: {
      success: true,
      result: {
        processInstanceId: 'synthetic-instance',
        operationRecords: [
          { operationType: 'EXECUTE_TASK_NORMAL', operationResult: 'AGREE', userId: 'synthetic-a', operationTime: 1 },
        ],
      },
    },
  };
}
async function api(f = fixtures()) {
  const read: DwsRead = async (args) =>
    args[2] === 'get-self'
      ? {
          success: true,
          result: [{ orgEmployeeModel: { corpId: binding.corpId, userId: binding.userId, depts: [{ deptId: 1 }] } }],
        }
      : args[2] === 'detail'
        ? f.detail
        : f.records;
  const client = new DwsNativeApprovals(binding, read);
  await client.verify();
  return client;
}
describe('native approval provider evidence', () => {
  it('rejects a department outside the verified owner identity', async () => {
    await expect((await api()).evidence('synthetic-instance', { ...expected, departmentId: 2 })).rejects.toThrow();
  });

  it('keeps preview fingerprints stable across MySQL JSON key reordering', () =>
    expect(nativeHash({ a: 1, b: { c: 2, d: 3 } })).toBe(nativeHash({ b: { d: 3, c: 2 }, a: 1 })));

  it('binds actual manual OR decision to the full local snapshot', async () => {
    const proof = await (await api()).evidence('synthetic-instance', expected);
    expect(proof.status).toBe('approved');
    expect(proof.decisionUserId).toBe('synthetic-a');
    expect(() => assertNativeEvidence(proof)).not.toThrow();
    expect(Object.isFrozen(proof.expected.approverIds)).toBe(true);
  });
  it('does not accept a JSON body masquerading as provider evidence', () =>
    expect(() => assertNativeEvidence({} as NativeEvidence)).toThrow());
  it('accepts a cancelled virtual peer only with the exact original peer CC evidence', async () => {
    const f = fixtures();
    f.detail.result.tasks[1].userId = 'V00_1234567890';
    f.detail.result.operationRecords.push({
      type: 'PROCESS_CC',
      userId: expected.originatorId,
      result: 'NONE',
      remark: '',
      ccUserIds: ['synthetic-b'],
    });
    const proof = await (await api(f)).evidence('synthetic-instance', expected);
    expect(proof.status).toBe('approved');
    expect(proof.decisionUserId).toBe('synthetic-a');
    expect(proof.decisionAt).toBe('1970-01-01T00:00:00.001Z');
  });
  it.each(['no-cc', 'wrong-cc', 'active-virtual', 'unknown-real', 'pending-workflow'] as const)(
    'rejects unsafe OR placeholder %s',
    async (kind) => {
      const f = fixtures();
      f.detail.result.tasks[1].userId = kind === 'unknown-real' ? 'unexpected-person' : 'V00_1234567890';
      if (kind !== 'no-cc')
        f.detail.result.operationRecords.push({
          type: 'PROCESS_CC',
          userId: expected.originatorId,
          result: 'NONE',
          remark: '',
          ccUserIds: [kind === 'wrong-cc' ? 'unexpected-person' : 'synthetic-b'],
        });
      if (kind === 'active-virtual') f.detail.result.tasks[1].taskStatus = 'RUNNING';
      if (kind === 'pending-workflow') f.detail.result.status = 'RUNNING';
      await expect((await api(f)).evidence('synthetic-instance', expected)).rejects.toThrow();
    },
  );
  it.each(['instance', 'process', 'originator', 'department', 'form', 'task', 'decision'] as const)(
    'rejects mismatched %s',
    async (kind) => {
      const f = fixtures();
      if (kind === 'instance') f.detail.result.processInstanceId = 'other';
      if (kind === 'process') f.detail.result.processCode = 'PROC-OTHER';
      if (kind === 'originator') f.detail.result.originatorUserid = 'other';
      if (kind === 'department') f.detail.result.originatorDeptId = '2';
      if (kind === 'form') f.detail.result.formValueVOS[0].value = 'tampered';
      if (kind === 'task') f.detail.result.tasks[0].userId = 'other';
      if (kind === 'decision') f.records.result.operationRecords = [];
      await expect((await api(f)).evidence('synthetic-instance', expected)).rejects.toThrow();
    },
  );
  it('does not interpret running tasks as an approval', async () => {
    const f = fixtures();
    f.detail.result.status = 'RUNNING';
    expect((await (await api(f)).evidence('synthetic-instance', expected)).status).toBe('pending');
  });
  it('verifies rejection against both tasks and actual manual records', async () => {
    const f = fixtures();
    f.detail.result.processInstanceResult = 'refuse';
    f.detail.result.tasks[0].taskResult = 'REFUSE';
    f.detail.result.operationRecords[0].result = 'REFUSE';
    f.records.result.operationRecords[0].operationResult = 'REFUSE';
    expect((await (await api(f)).evidence('synthetic-instance', expected)).status).toBe('rejected');
  });
  it('requires current own-profile verification before reading a decision', async () => {
    const client = new DwsNativeApprovals(binding, async () => fixtures().detail);
    await expect(client.evidence('synthetic-instance', expected)).rejects.toThrow();
  });
  it('includes full contract clauses in the submitted fingerprint', () => {
    const v = {
      approvalId: 1,
      approvalVersion: 'v1',
      contractId: 1,
      contractVersion: 'v1',
      contractNo: 'Synthetic-1',
      name: 'Synthetic contract',
      customerName: 'Synthetic customer',
      signingCompany: 'Synthetic vendor',
      amount: '0.01',
      applicantName: 'Synthetic applicant',
      paymentTerms: 'Synthetic terms',
      remark: 'Synthetic remarks',
      currency: 'CNY',
      contractType: 'other',
      taxRate: '0',
      approverIds: ['a', 'b'],
    };
    const a = nativeFormValues(v),
      b = nativeFormValues({ ...v, paymentTerms: 'Changed terms' });
    expect(a['说明']).toContain('Synthetic terms');
    expect(a['审核指纹']).not.toBe(b['审核指纹']);
    expect(nativeHash(a)).not.toBe(nativeHash(b));
  });
  it('rejects profile and identity injection in settings', () => {
    const v = {
      enabled: true,
      processCode: 'PROC-SYNTHETIC',
      departmentId: 1,
      flowId: 1,
      fromDate: '2026-11-15',
      autoPoll: true,
    };
    expect(parseNativePolicy(v)).toEqual(v);
    for (const bad of [
      { ...v, profile: 'other' },
      { ...v, fromDate: '2026-02-31' },
      { ...v, departmentId: -1 },
    ])
      expect(() => parseNativePolicy(bad)).toThrow();
  });
  it('only accepts a published fixed manual OR template without applicant auto-approval', () => {
    const schema = {
        items: nativeFormLabels.map((label, i) => ({
          componentName: 'TextField',
          props: { id: 'Synthetic-' + i, label, required: true },
        })),
      },
      flow = {
        type: 'start',
        childNode: {
          type: 'approver',
          properties: {
            activateType: 'ALL',
            agreeAll: false,
            approvalType: 'MANUAL',
            actionerRules: [{ type: 'target_approval', approvals: [{ workNo: 'a' }, { workNo: 'b' }] }],
          },
        },
      };
    const t = {
      processCode: 'PROC-SYNTHETIC',
      name: 'Synthetic',
      status: 'PUBLISHED',
      properties: JSON.stringify({ autoExecuteOriginatorTasks: 'false' }),
      schemaContent: JSON.stringify(schema),
      processConfig: JSON.stringify(flow),
    };
    expect(nativeTemplate({ ok: true, data: { templates: [t] } }, 'PROC-SYNTHETIC').allowedUserIds).toEqual(['a', 'b']);
    expect(() =>
      nativeTemplate(
        { ok: true, data: { templates: [{ ...t, properties: '{"autoExecuteOriginatorTasks":"true"}' }] } },
        'PROC-SYNTHETIC',
      ),
    ).toThrow();
  });
});

describe('native receipt recovery', () => {
  const id = 'synthetic-instance-123';
  it.each([
    id,
    { processInstanceId: id },
    { success: true, result: { processInstanceId: id } },
    { data: { process_instance_id: id } },
    { result: id },
    { result: JSON.stringify({ processInstanceId: id }) },
  ])('treats a receipt as a candidate only', (v) => {
    expect(nativeCreationCandidate(v)).toBe(id);
  });
  it.each([
    { success: false, result: id },
    { errcode: 500, result: id },
    { ok: false, data: { processInstanceId: id } },
    { processInstanceId: id, data: { processInstanceId: 'another-instance-123' } },
    {},
    'too-short',
  ])('rejects failures and ambiguous receipts', (v) => {
    expect(() => nativeCreationCandidate(v)).toThrow();
  });
  async function recover(ids: string[], hasMore = false, tamper = false) {
    const calls: string[][] = [];
    const read: DwsRead = async (args) => {
      calls.push(args);
      if (args[2] === 'get-self')
        return {
          success: true,
          result: [{ orgEmployeeModel: { corpId: binding.corpId, userId: binding.userId, depts: [{ deptId: 1 }] } }],
        };
      if (args[2] === 'list-initiated')
        return {
          success: true,
          result: {
            hasMore,
            nextCursor: hasMore ? '1' : null,
            processInstanceList: ids.map((processInstanceId) => ({
              processInstanceId,
              originatorUserid: binding.userId,
            })),
          },
        };
      const f = fixtures(),
        current = args[args.indexOf('--instance-id') + 1];
      f.detail.result.processInstanceId = current;
      f.records.result.processInstanceId = current;
      if (tamper) f.detail.result.formValueVOS[0].value = 'tampered';
      return args[2] === 'detail' ? f.detail : f.records;
    };
    const api = new DwsNativeApprovals(binding, read);
    await api.verify();
    return { api, calls };
  }
  it('recovers one exact original, preserving sealed evidence without calling create', async () => {
    const { api, calls } = await recover([id]);
    const found = await api.recoverOwn(expected, '2026-11-15T00:00:00Z', '2026-11-15T00:10:00Z');
    expect(found.evidence.instanceId).toBe(id);
    expect(() => assertNativeEvidence(found.evidence)).not.toThrow();
    expect(calls.some((a) => a[2] === 'create-instance')).toBe(false);
  });
  it.each([
    ['no matches', [], false, false],
    ['duplicates', [id, 'another-instance-123'], false, false],
    ['incomplete pages', [id], true, false],
    ['tampered fields', [id], false, true],
  ] as const)('fails closed on %s', async (_label, ids, more, tamper) => {
    const { api, calls } = await recover([...ids], more, tamper);
    await expect(api.recoverOwn(expected, '2026-11-15T00:00:00Z', '2026-11-15T00:10:00Z')).rejects.toThrow();
    expect(calls.some((a) => a[2] === 'create-instance')).toBe(false);
  });
});
