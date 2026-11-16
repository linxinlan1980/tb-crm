import { Module } from '@nestjs/common';
import { ReceiptController } from './receipt/receipt.controller';
import { ReceiptService } from './receipt/receipt.service';
import { PaymentPlanController } from './payment-plan/payment-plan.controller';
import { PaymentPlanService } from './payment-plan/payment-plan.service';
import { InvoiceController } from './invoice/invoice.controller';
import { InvoiceService } from './invoice/invoice.service';
import { AgingService } from './aging/aging.service';

@Module({
  controllers: [ReceiptController, PaymentPlanController, InvoiceController],
  providers: [ReceiptService, PaymentPlanService, InvoiceService, AgingService],
  exports: [ReceiptService, PaymentPlanService, InvoiceService, AgingService],
})
export class FinanceModule {}
