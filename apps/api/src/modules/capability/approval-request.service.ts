import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../common/types/actor';
import { ApprovalService } from '../approval/approval.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { hasPermission } from '../workspace/access';
const requestKey=z.string().min(1).max(80);
export const approvalRequestInput=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('form'),requestKey,flowId:z.number().int().positive(),title:z.string().min(1).max(200),amount:z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).default('0'),form:z.record(z.string(),z.unknown()).default({})}).strict(),
  z.object({kind:z.enum(['contracts','orders','projects']),requestKey,recordId:z.number().int().positive(),expectedUpdatedAt:z.string().datetime(),form:z.record(z.string(),z.unknown()).default({})}).strict(),
]);
@Injectable()
export class ApprovalRequestService{
  constructor(private readonly workspace:WorkspaceService,private readonly approvals:ApprovalService){}
  async request(a:Actor,input:unknown){
    const parsed=approvalRequestInput.safeParse(input);
    if(!parsed.success)throw new BadRequestException('审批申请参数无效，请按契约提供单据版本或通用流程及表单');
    const v=parsed.data;
    if(v.kind==='form'){
      if(!hasPermission(a,'approval:create'))throw new ForbiddenException('无权发起通用审批');
      const{kind:_,...body}=v;void _;
      return this.approvals.create(a,body);
    }
    return this.workspace.command(a,v.kind,v.recordId,'submit',{requestKey:v.requestKey,expectedUpdatedAt:v.expectedUpdatedAt,form:v.form});
  }
}
