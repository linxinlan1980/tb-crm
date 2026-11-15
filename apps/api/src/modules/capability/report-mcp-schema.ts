import { z } from 'zod';
export const reportMcpInput = z.object({
  year: z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(0).max(12).optional(),
  ownerId: z.number().int().min(1).max(2147483647).optional(),
  deptId: z.number().int().min(1).max(2147483647).optional(),
  contractId: z.number().int().min(1).max(2147483647).optional(),
  page: z.number().int().min(1).max(1000000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  source: z.enum(['managed', 'legacy']).optional(),
  detail: z.enum(['contracts', 'plans', 'receipts', 'balances', 'overdue']).optional(),
  bucket: z.enum(['open', 'won', 'lost', 'closed', 'undated']).optional(),
}).strict();
