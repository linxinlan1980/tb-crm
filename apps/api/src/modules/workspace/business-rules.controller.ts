import { businessRulesCapabilities } from './business-rules.contract';
import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { PrismaService } from '../../database/prisma.service';
import { businessPolicyKey, parseBusinessPolicy, policyDigest } from './business-policy';
import { checkVersion, object, runCommand, validateActor } from './command-runner';
function administrator(a:Actor){if(!a.roles.includes('super_admin'))throw new ForbiddenException('仅管理员可配置内部业务规则');}
@Controller('business-rules')
export class BusinessRulesController {
  constructor(private readonly prisma:PrismaService){}
  @Get('schema') schema(@CurrentUser() a:Actor){administrator(a);return businessRulesCapabilities;}
  @Get() async state(@CurrentUser() a:Actor){
    administrator(a);
    return this.prisma.system.$transaction(async tx=>{
      await validateActor(tx,a);
      const row=await tx.systemSetting.findUnique({where:{tenantId_settingKey:{tenantId:a.tenantId,settingKey:businessPolicyKey}}});
      const users=await tx.user.findMany({where:{tenantId:a.tenantId,status:'active',deletedAt:null,roles:{some:{role:{code:'super_admin'}}}},select:{id:true,name:true}});
      const flows=await tx.approvalFlow.findMany({where:{tenantId:a.tenantId,bizType:'contract',isActive:true},select:{id:true,name:true}});
      return{configured:process.env.CRM_BUSINESS_RULES_ENABLED==='true',policy:row?parseBusinessPolicy(JSON.parse(row.settingValue)as unknown):null,updatedAt:row?.updatedAt??null,users,flows};
    });
  }
  @Post() async save(@CurrentUser() a:Actor,@Body() input:Record<string,unknown>){
    administrator(a);object(input);
    if(Object.keys(input).some(k=>!['requestKey','expectedUpdatedAt','data'].includes(k)))throw new ForbiddenException('业务规则参数无效');
    const policy=parseBusinessPolicy(input.data);
    return runCommand(this.prisma,a,'business.rules.configure@1.0',{requestKey:input.requestKey,expectedUpdatedAt:input.expectedUpdatedAt,data:policy},async tx=>{
      const people=await tx.user.count({where:{tenantId:a.tenantId,id:{in:policy.notifyUserIds},status:'active',deletedAt:null,roles:{some:{role:{code:'super_admin'}}}}});
      const flow=await tx.approvalFlow.findFirst({where:{tenantId:a.tenantId,id:policy.contractFlowId,isActive:true,bizType:'contract'}});
      if(people!==policy.notifyUserIds.length||!flow)throw new ForbiddenException('通知人员或合同审批流未在当前公司启用');
      const where={tenantId_settingKey:{tenantId:a.tenantId,settingKey:businessPolicyKey}};const prior=await tx.systemSetting.findUnique({where});
      if(prior)checkVersion(prior,input.expectedUpdatedAt);
      const data={settingValue:JSON.stringify(policy),settingGroup:'business-notifications',valueType:'json' as const,description:'新商机通知与新合同自动审批；历史补录不外发'};
      const row=prior?await tx.systemSetting.update({where:{id:prior.id},data}):await tx.systemSetting.create({data:{tenantId:a.tenantId,settingKey:businessPolicyKey,...data}});
      return{policyHash:policyDigest(policy),updatedAt:row.updatedAt};
    });
  }
}
