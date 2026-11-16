import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class InvoiceService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: number, query: { page?: number; pageSize?: number; contractId?: number; customerId?: number; status?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, contractId, customerId, status } = query;
    const where: any = { deletedAt: null };
    if (contractId) where.contractId = contractId;
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      db.invoice.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { contract: { select: { contractNo: true, name: true } } } }),
      db.invoice.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async create(tenantId: number, userId: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    const invoiceNo = await this.generateNo(db);
    const amount = Number(data.amount);
    const taxRate = Number(data.taxRate || 13);
    const amountExclTax = Number((amount / (1 + taxRate / 100)).toFixed(2));
    const taxAmount = Number((amount - amountExclTax).toFixed(2));

    return db.invoice.create({
      data: { tenantId, invoiceNo, contractId: data.contractId, orderId: data.orderId, milestoneId: data.milestoneId, customerId: data.customerId, invoiceType: data.invoiceType || 'special', direction: 'output', amount, amountExclTax, taxRate, taxAmount, invoiceTitle: data.invoiceTitle, taxNo: data.taxNo, bankName: data.bankName, bankAccount: data.bankAccount, address: data.address, phone: data.phone, content: data.content, status: 'pending', createdBy: userId },
    });
  }

  async issue(tenantId: number, userId: number, id: number, data: { realInvoiceNo: string; realInvoiceCode?: string; invoiceDate: string }) {
    const db = this.prisma.forTenant(tenantId);
    const invoice = await db.invoice.update({ where: { id }, data: { status: 'invoiced', realInvoiceNo: data.realInvoiceNo, realInvoiceCode: data.realInvoiceCode, invoiceDate: new Date(data.invoiceDate) } });
    // 更新合同已开票金额
    const allInvoices = await db.invoice.findMany({ where: { contractId: invoice.contractId, status: { notIn: ['voided', 'red_flushed'] } } });
    const totalInvoiced = allInvoices.reduce((sum, i) => sum + Number(i.amount), 0);
    await db.contract.update({ where: { id: invoice.contractId }, data: { totalInvoiced } });
    return invoice;
  }

  private async generateNo(db: any): Promise<string> {
    const now = new Date();
    const prefix = `FP${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.invoice.findFirst({ where: { invoiceNo: { startsWith: prefix } }, orderBy: { invoiceNo: 'desc' }, select: { invoiceNo: true } });
    const seq = last ? parseInt(last.invoiceNo.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
