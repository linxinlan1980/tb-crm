const str = { type: 'string' },
  version = { type: 'string', format: 'date-time' },
  requestKey = { type: 'string', minLength: 1, maxLength: 80 };
export const nativeApprovalCapabilities = [
  {
    id: 'integration.native.state',
    route: 'GET /integrations/dingtalk-native-approval',
    effect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    outputSchema: { type: 'object', required: ['policy', 'bound', 'pending', 'runs', 'transport'] },
  },
  {
    id: 'integration.native.configure',
    route: 'POST /integrations/dingtalk-native-approval/settings',
    effect: 'write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestKey', 'data'],
      properties: {
        requestKey,
        expectedUpdatedAt: version,
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'processCode', 'departmentId', 'flowId', 'fromDate', 'autoPoll'],
          properties: {
            enabled: { type: 'boolean' },
            autoPoll: { type: 'boolean' },
            processCode: str,
            departmentId: { type: 'integer', minimum: 1 },
            flowId: { type: 'integer', minimum: 1 },
            fromDate: { type: 'string', format: 'date' },
          },
        },
      },
    },
    outputSchema: { type: 'object', required: ['updatedAt'] },
  },
  {
    id: 'integration.native.probe',
    route: 'POST /integrations/dingtalk-native-approval/probe',
    effect: 'external-read-and-local-write',
    inputSchema: { type: 'object', additionalProperties: false, required: ['requestKey'], properties: { requestKey } },
    outputSchema: { type: 'object', required: ['templateName', 'people', 'departmentId', 'network'] },
  },
  {
    id: 'integration.native.prepare',
    route: 'POST /integrations/dingtalk-native-approval/prepare',
    effect: 'external-read-and-local-write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestKey', 'approvalId', 'expectedUpdatedAt'],
      properties: { requestKey, approvalId: { type: 'integer', minimum: 1 }, expectedUpdatedAt: version },
    },
    outputSchema: { type: 'object', required: ['runId', 'digest', 'formValues', 'people', 'expiresAt'] },
  },
  {
    id: 'integration.native.dispatch',
    route: 'POST /integrations/dingtalk-native-approval/runs/:id/dispatch',
    effect: 'external-write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestKey', 'expectedUpdatedAt', 'digest', 'confirm'],
      properties: {
        requestKey,
        expectedUpdatedAt: version,
        digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        confirm: { const: true },
      },
    },
    outputSchema: { type: 'object', required: ['runId', 'status', 'summary'] },
  },
  {
    id: 'integration.native.reconcile',
    route: 'POST /integrations/dingtalk-native-approval/runs/:id/reconcile',
    effect: 'external-read-and-local-write',
    inputSchema: { type: 'object', additionalProperties: false, required: ['requestKey'], properties: { requestKey } },
    outputSchema: { type: 'object', required: ['runId', 'status', 'summary'] },
  },
].map((c) => ({
  ...c,
  version: '1.0',
  agentWritesEnabled: false,
  permission:
    c.id.endsWith('configure') || c.id.endsWith('probe')
      ? 'human super_admin'
      : 'current human owner and contract read',
  guards: [
    'live company and own DingTalk binding',
    'same generic local approval flow; single manual any-sign step',
    'actual approvers, full contract form and fingerprint checked',
    'future-only; no historical catch-up, group robot or callback/public ingress',
    'outbound HTTPS and optional60-second result poll',
    'immutable10-minute preview and explicit per-document send confirmation',
    'atomic claim before external create; uncertain write never automatically resent',
    'provider-issued evidence; no fake human session or todo-as-approval',
    'current role, source version, atomic callback, receipt and audit',
  ],
}));
