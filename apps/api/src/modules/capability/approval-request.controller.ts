import{Body,Controller,Post}from'@nestjs/common';
import{CurrentUser}from'../../common/decorators/current-user.decorator';
import type{Actor}from'../../common/types/actor';
import{ApprovalRequestService}from'./approval-request.service';
@Controller('capabilities/approval.request')
export class ApprovalRequestController{
  constructor(private readonly requests:ApprovalRequestService){}
  @Post('invoke')invoke(@CurrentUser()a:Actor,@Body()body:unknown){return this.requests.request(a,body);}
}
