const properties = {
  records: {
    type: 'array',
    minItems: 1,
    maxItems: 50,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'expectedUpdatedAt'],
      properties: { id: { type: 'integer', minimum: 1 }, expectedUpdatedAt: { type: 'string', format: 'date-time' } },
    },
  },
  userId: { type: 'integer', minimum: 1 },
  reason: { type: 'string', minLength: 1, maxLength: 500 },
};
export const allocationContracts = [false, true].map((write) => ({
  id: write ? 'customer.allocation.batch' : 'customer.allocation.preview',
  version: '1.0',
  route: `POST /customer-allocation/${write ? 'commit' : 'preview'}`,
  effect: write ? 'write' : 'read',
  permission: 'customer:read + customer:update + customer:assign AND admin/sales_manager',
  agentWriteEnabled: false,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: [...Object.keys(properties), ...(write ? ['requestKey'] : [])],
    properties: { ...properties, ...(write ? { requestKey: { type: 'string', minLength: 1, maxLength: 80 } } : {}) },
  },
  outputSchema: {
    type: 'object',
    required: ['items', 'count', 'reason'],
    properties: {
      count: { type: 'integer', minimum: 1, maximum: 50 },
      reason: { type: 'string' },
      items: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          required: ['id', 'name', 'fromUserId', 'toUserId', 'toName'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            fromUserId: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            toUserId: { type: 'integer' },
            toName: { type: 'string' },
          },
        },
      },
    },
  },
  guards: [
    'current authenticated actor',
    'customer read and mutation scope',
    'same-company eligible active sales with active department and customer read/update',
    'manager recipient restricted to own department',
    'no downstream graph; otherwise complete handover',
    'expected version for each customer',
    '1..50 unique customer ids',
    ...(write
      ? ['all-or-nothing serializable command', 'idempotency/audit']
      : ['RepeatableRead preview; commit revalidates versions']),
  ],
  evidence: ['Customer', 'PrivateHolding', ...(write ? ['CommandExecution', 'AuditLog'] : [])],
}));
