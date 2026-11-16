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
const isoDate = { type: 'string', format: 'date-time' };
const runResult = {
  ...objectResult,
  required: ['id', 'status', 'kind', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', maxLength: 36 },
    kind: { const: 'directory' },
    status: { enum: ['reading', 'ready', 'partial', 'failed', 'interrupted', 'applied'] },
    createdAt: isoDate,
    updatedAt: isoDate,
    summary: { anyOf: [{ type: 'object' }, { type: 'null' }] },
    snapshot: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          required: [
            'bindingHash',
            'companyName',
            'readerName',
            'capturedAt',
            'departments',
            'people',
            'complete',
            'hasMore',
            'stopReason',
            'failures',
          ],
          properties: {
            bindingHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            companyName: { type: 'string' },
            readerName: { type: 'string' },
            capturedAt: isoDate,
            departments: {
              type: 'array',
              maxItems: 200,
              items: {
                type: 'object',
                required: ['externalId', 'parentExternalId', 'name', 'depth'],
                properties: {
                  externalId: { type: 'string' },
                  parentExternalId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  name: { type: 'string' },
                  depth: { type: 'integer', minimum: 0 },
                },
              },
            },
            people: {
              type: 'array',
              maxItems: 500,
              items: {
                type: 'object',
                required: ['externalId', 'name', 'departmentIds', 'position'],
                properties: {
                  externalId: { type: 'string' },
                  name: { type: 'string' },
                  departmentIds: { type: 'array', items: { type: 'string' } },
                  position: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
              },
            },
            complete: { type: 'boolean' },
            hasMore: { type: 'boolean' },
            stopReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            failures: { type: 'array', items: { type: 'string' } },
          },
        },
      ],
    },
  },
};
const connectionResult = {
  ...objectResult,
  required: ['id', 'enabled', 'updatedAt'],
  properties: { id: { type: 'integer' }, enabled: { type: 'boolean' }, updatedAt: isoDate },
};
export const directoryCapabilities = [
  {
    id: 'integration.dingtalk.state',
    version: '1.0',
    effect: 'read',
    route: 'GET /integrations/dingtalk-bridge',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: {
      ...objectResult,
      required: ['bound', 'bindingHash', 'connection', 'mappings', 'runs', 'departments', 'users'],
      properties: {
        bound: { type: 'boolean' },
        bindingHash: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        connection: { anyOf: [connectionResult, { type: 'null' }] },
        mappings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['kind', 'externalId', 'externalName', 'localId', 'bindingHash'],
            properties: {
              kind: { enum: ['department', 'user'] },
              externalId: { type: 'string' },
              externalName: { type: 'string' },
              localId: { type: 'integer', minimum: 1 },
              bindingHash: { type: 'string' },
            },
          },
        },
        runs: { type: 'array', maxItems: 20, items: runResult },
        departments: {
          type: 'array',
          maxItems: 2000,
          items: { type: 'object', required: ['id', 'name', 'parentId', 'status'] },
        },
        users: {
          type: 'array',
          maxItems: 500,
          items: { type: 'object', required: ['id', 'name', 'username', 'deptId', 'status'] },
        },
      },
    },
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
    outputSchema: connectionResult,
  },
  {
    id: 'integration.dingtalk.directory.preview',
    version: '1.0',
    effect: 'external-read/local-write',
    route: 'POST /integrations/dingtalk-bridge/directory/preview',
    inputSchema: { type: 'object', additionalProperties: false, required: ['requestKey'], properties: { requestKey } },
    outputSchema: runResult,
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
    outputSchema: {
      ...objectResult,
      required: [
        'runId',
        'createdDepartments',
        'createdPeople',
        'linkedDepartments',
        'linkedPeople',
        'skipped',
        'newPeopleStatus',
        'existingPermissionsPreserved',
      ],
      properties: {
        runId: { type: 'string' },
        ...Object.fromEntries(
          ['createdDepartments', 'createdPeople', 'linkedDepartments', 'linkedPeople', 'skipped'].map((name) => [
            name,
            { type: 'integer', minimum: 0 },
          ]),
        ),
        newPeopleStatus: { const: 'inactive' },
        existingPermissionsPreserved: { const: true },
      },
    },
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
