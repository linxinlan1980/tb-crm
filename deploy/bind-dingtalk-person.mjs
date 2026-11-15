// Local operator only. This binds an already authorized profile; it never logs in as another user.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [code,username,selector,apply]=process.argv.slice(2);
if(!/^[A-Z][A-Z0-9_-]{1,29}$/.test(code||'')||!/^[A-Za-z0-9_-]{2,40}$/.test(username||'')||!selector||selector.length>200|| (apply!==undefined&&apply!=='--apply')||process.argv.length>6)
  throw new Error('用法：node deploy/bind-dingtalk-person.mjs 公司编码 CRM账号 精确profile [--apply]；默认仅检查');
const registry=JSON.parse(readFileSync(join(project,'.local/accounts/registry.json'),'utf8'));
const account=registry.accounts.find(a=>a.code===code&&a.status==='ready');if(!account)throw new Error('公司帐套不存在');
const configuration=JSON.parse(readFileSync(account.configFile,'utf8'));
if(!configuration.DWS_EXPECTED_CORP_ID)throw new Error('先完成公司的组织同步绑定');
const binary=configuration.DWS_BINARY||process.env.DWS_BINARY||'dws';
const profiles=JSON.parse(execFileSync(binary,['profile','list','--format','json'],{encoding:'utf8',timeout:30000}));
if(profiles.success!==true||!Array.isArray(profiles.profiles))throw new Error('无法读取已授权profile');
const matches=profiles.profiles.filter(p=>p.profile===selector&&p.corpId===configuration.DWS_EXPECTED_CORP_ID);
if(matches.length!==1)throw new Error('该公司没有唯一匹配的精确profile；不按名称或第一条猜测');
const selected=matches[0],identity=JSON.parse(execFileSync(binary,['contact','user','get-self','--profile',selected.profile,'--format','json'],{encoding:'utf8',timeout:45000}));
const entries=Array.isArray(identity.result)?identity.result:Object.values(identity.result||{}),self=entries[0]?.orgEmployeeModel;
if(identity.success!==true||entries.length!==1||self?.corpId!==selected.corpId||self?.userId!==selected.userId)throw new Error('profile当前身份不符');
const require=createRequire(new URL('../packages/database/package.json',import.meta.url));const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({datasourceUrl:configuration.DATABASE_URL});
try{
  const tenant=await db.tenant.findUniqueOrThrow({where:{code}}),user=await db.user.findUnique({where:{tenantId_username:{tenantId:tenant.id,username}}});
  if(!user||user.status!=='active'||user.deletedAt)throw new Error('CRM人员不存在或尚未启用');
  const mapping=await db.integrationMapping.findFirst({where:{tenantId:tenant.id,provider:'dws-dingtalk',kind:'user',localId:user.id,externalId:selected.userId}});
  if(!mapping)throw new Error('组织同步对照表未证明此CRM账号与钉钉员工对应；禁止按同名绑定');
  const extras=JSON.parse(configuration.DWS_ACTIVITY_BINDINGS||'[]');if(!Array.isArray(extras)||extras.length>=500)throw new Error('人员授权配置超出范围');
  const existing=extras.find(p=>p.userId===selected.userId);
  if(existing&&(existing.profile!==selected.profile||existing.corpId!==selected.corpId))throw new Error('已有不同人员授权，不允许静默替换');
  const primary=selected.userId===configuration.DWS_EXPECTED_USER_ID;
  if(primary&&selected.profile!==configuration.DWS_PROFILE)throw new Error('主授权profile不符，不允许静默更改组织读取人');
  const alreadyBound=primary||!!existing;
  if(apply==='--apply'&&!alreadyBound){extras.push({profile:selected.profile,corpId:selected.corpId,userId:selected.userId});configuration.DWS_ACTIVITY_BINDINGS=JSON.stringify(extras);const temp=account.configFile+'.person.tmp';writeFileSync(temp,JSON.stringify(configuration,null,2),{flag:'wx',mode:0o600});renameSync(temp,account.configFile);}
  console.log(JSON.stringify({company:code,person:user.name,crmUsername:username,validated:true,alreadyBound,saved:apply==='--apply'&&!alreadyBound,message:apply==='--apply'?'重启公司服务后，由本人在网页核对并开启同步；未发送任何内容。':'仅核对；追加 --apply 才保存。未更改账号、角色、客户或外部内容。'}));
}finally{await db.$disconnect();}
