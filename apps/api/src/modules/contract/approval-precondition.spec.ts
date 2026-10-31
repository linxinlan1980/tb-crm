import { ContractService } from './contract.service';
import { OrderService } from '../order/order.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../system/audit-logs/audit-log.service';
import { MilestoneService } from './milestone/milestone.service';

describe('Approval prerequisites', () => {
  it.each(['draft', 'pending_approval', 'rejected', 'signed', 'terminated'])('rejects contract signing from %s', async (status) => {
    const update = jest.fn();
    const prisma = { forTenant: () => ({ contract: { findFirst: async () => ({ id: 1, status }), update } }) };
    const service = new ContractService(prisma as unknown as PrismaService, {} as AuditLogService, {} as MilestoneService);
    await expect(service.sign(1, 1, 1, { signDate: '2026-10-31' })).rejects.toThrow('只有审批通过的合同可签约');
    expect(update).not.toHaveBeenCalled();
  });
  it.each(['draft', 'pending_approval', 'cancelled', 'confirmed'])('rejects order confirmation from %s', async (status) => {
    const update = jest.fn();
    const prisma = { forTenant: () => ({ order: { findFirst: async () => ({ id: 1, status }), update } }) };
    const service = new OrderService(prisma as unknown as PrismaService, {} as AuditLogService);
    await expect(service.confirm(1, 1, 1)).rejects.toThrow('只有审批通过的订单可确认');
    expect(update).not.toHaveBeenCalled();
  });
});
