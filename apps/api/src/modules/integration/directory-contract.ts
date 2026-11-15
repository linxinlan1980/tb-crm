const requestKey = { type: 'string', minLength: 1, maxLength: 80 };
const choice = (people: boolean) => ({
  type: 'array',
  maxItems: people ? 500 : 199,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'localId', ...(people ? ['departmentExternalId'] : [])],
    properties: {
      externalId: { type: 'string', minLength: 1, maxLength: 100 },
      localId: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }, { const: 'skip' }] },
      ...(people
        ? { departmentExternalId: { anyOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'null' }] } }
        : {}),
    },
  },
});
const objectResult = {
  type: 'object',
  description: 'Company-scoped durable run/configuration receipt. No password or external authorization credential.',
};
export const directoryCapabilities = [
  {
    id: 'integration.dingtalk.state',
    version: '1.0',
    effect: 'read',
    route: 'GET /integrations/dingtalk-bridge',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: objectResult,
  },
  {
    id: 'integration.dingtalk.configure',
    version: '1.0',
    effect: 'write',
    route: 'POST /integrations/dingtalk-bridge/settings',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestKey', 'enabled'],
      properties: {
        requestKey,
        enabled: { type: 'boolean' },
        expectedUpdatedAt: { type: 'string', format: 'date-time' },
      },
    },
    outputSchema: objectResult,
  },
  {
    id: 'integration.dingtalk.directory.preview',
    version: '1.0',
    effect: 'external-read/local-write',
    route: 'POST /integrations/dingtalk-bridge/directory/preview',
    inputSchema: { type: 'object', additionalProperties: false, required: ['requestKey'], properties: { requestKey } },
    outputSchema: objectResult,
  },
  {
    id: 'integration.dingtalk.directory.apply',
    version: '1.0',
    effect: 'local-write',
    route: 'POST /integrations/dingtalk-bridge/directory/apply',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestKey', 'runId', 'departments', 'people'],
      properties: {
        requestKey,
        runId: { type: 'string', maxLength: 36 },
        departments: choice(false),
        people: choice(true),
      },
    },
    outputSchema: objectResult,
  },
].map((capability) => ({
  ...capability,
  permission: 'system:integration AND super_admin',
  agentWriteEnabled: false,
  guards: [
    'live authenticated actor',
    'operator-bound profile/corporation/reader',
    'complete preview <=30 minutes',
    'explicit one-to-one crosswalk',
    'existing personnel permissions unchanged',
    'new personnel inactive sales',
    'same command runner / serializable transaction / idempotency / audit',
  ],
  evidence: ['IntegrationRun', 'IntegrationMapping', 'CommandExecution', 'AuditLog'],
}));
