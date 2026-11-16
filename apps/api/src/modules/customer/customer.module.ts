import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  controllers: [CustomerController, ContactController],
  providers: [CustomerService, ContactService],
  exports: [CustomerService],
})
export class CustomerModule {}
