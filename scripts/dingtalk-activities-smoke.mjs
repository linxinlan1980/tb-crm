import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES,'true');assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/tb_crm_test_[a-z0-9_]+$/);
const require=createRequire(new URL('../packages/database/package.json',import.meta.url));const {PrismaClient}=require('@prisma/client'),bcrypt=require('bcrypt');const db=new PrismaClient();
const directory=mkdtempSync(join(tmpdir(),'crm-activity-')), executable=join(directory,'fixture-dws'), remoteFile=join(directory,'remote.json');
writeFileSync(remoteFile,JSON.stringify({mode:'normal',calendars:{},todos:{},calls:[]}));
writeFileSync(executable,`#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2),f=${JSON.stringify(remoteFile)},s=JSON.parse(fs.readFileSync(f,'utf8'));
const value=k=>args[args.indexOf(k)+1],profile=value('--profile'),who=profile==='fixture-primary'?'fixture-reader':profile==='fixture-secondary'?'fixture-second':'fixture-third';
s.calls.push({command:args.slice(0,3).join(' '),profile});let r,wait=0;const prefix=profile+':';
if(args[2]==='get-self')r={success:true,result:[{orgEmployeeModel:{corpId:s.mode==='wrong-corp'?'other':'fixture-corp',userId:who,orgName:'【测试】接口企业',orgUserName:'【测试】'+who}}]};
else if(args[0]==='calendar'&&args[2]==='create'){const id=prefix+'event-'+(Object.keys(s.calendars).length+1);s.calendars[id]={id,attendees:[{}],summary:value('--title'),description:value('--desc'),start:{dateTime:value('--start')},end:{dateTime:value('--end')},freeBusy:value('--free-busy').toUpperCase(),status:'confirmed'};r={success:true,result:s.calendars[id]};if(s.mode==='fail-after-create'){r={success:false};s.mode='normal';}if(s.mode==='hang-after-create'){wait=10000;s.mode='normal';}}
else if(args[0]==='calendar'&&args[2]==='update'){const event=s.calendars[value('--id')];if(!event||!event.id.startsWith(prefix))r={success:false};else {Object.assign(event,{summary:value('--title'),description:value('--desc'),start:{dateTime:value('--start')},end:{dateTime:value('--end')},freeBusy:value('--free-busy').toUpperCase()});r={success:true};}}
else if(args[0]==='calendar'&&args[2]==='get'){const event=s.calendars[value('--id')];r=event&&event.id.startsWith(prefix)?{success:true,result:structuredClone(event)}:{success:false};if(r.success&&s.mode==='corrupt-read'){r.result.end.dateTime='2030-01-01T00:00:00Z';s.mode='normal';}}
else if(args[0]==='todo'&&args[2]==='create'){if(value('--executors')!==who)r={success:false};else{const taskId=prefix+'todo-'+(Object.keys(s.todos).length+1);s.todos[taskId]={taskId,subject:value('--title'),isDone:false,executorIds:['opaque-'+profile]};r={success:true,result:{taskId}};}}
else if(args[0]==='todo'&&args[2]==='get'){const task=s.todos[value('--task-id')];r=task&&task.taskId.startsWith(prefix)?{success:true,result:{todoDetailModel:task}}:{success:false};}
else if(args[0]==='todo'&&args[2]==='done'){const task=s.todos[value('--task-id')];if(!task||!task.taskId.startsWith(prefix))r={success:false};else{task.isDone=value('--status')==='true';r={success:true};}}
else if(args[0]==='todo'&&args[1]==='+get-my-tasks')r={ok:true,outcome:'success',data:{complete:true,todos:Object.values(s.todos).filter(t=>t.taskId.startsWith(prefix)&&String(t.isDone)===value('--status')).map(t=>({taskId:t.taskId,subject:t.subject}))}};
else r={success:false};fs.writeFileSync(f,JSON.stringify(s));if(wait)setTimeout(()=>console.log(JSON.stringify(r)),wait);else console.log(JSON.stringify(r));
`,{mode:0o700});
const password='Activity-'+randomBytes(14).toString('hex');
const env={...process.env,CRM_ACCOUNT_WORKER:'true',DEMO_MODE:'false',TENANT_CODE:'ACTIVITYTEST',TENANT_NAME:'【测试】钉钉日程与审批',ADMIN_USERNAME:'admin',SEED_ADMIN_PASSWORD:password,APP_URL:'http://localhost:4154',JWT_SECRET:randomBytes(32).toString('hex'),ENCRYPTION_KEY:randomBytes(32).toString('hex'),BACKUP_KEY:randomBytes(32).toString('hex'),DWS_BINARY:executable,DWS_PROFILE:'fixture-primary',DWS_EXPECTED_CORP_ID:'fixture-corp',DWS_EXPECTED_USER_ID:'fixture-reader',DWS_ACTIVITY_BINDINGS:JSON.stringify([{profile:'fixture-secondary',corpId:'fixture-corp',userId:'fixture-second'},{profile:'fixture-third',corpId:'fixture-corp',userId:'fixture-third'}]),HOST:'127.0.0.1',PORT:process.env.ACTIVITY_SMOKE_PORT||'4153'};
const base='http://127.0.0.1:'+env.PORT+'/api/v1',root='/integrations/dingtalk-activities';let checks=0,api,log='';
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert(v,label);checks++;};
const remote=()=>JSON.parse(readFileSync(remoteFile,'utf8')),mode=value=>{const s=remote();s.mode=value;writeFileSync(remoteFile,JSON.stringify(s));};
async function call(path,token,expected=200,body,method){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(expected===null)return{status:r.status,data:j.data};eq(r.status,expected,path+': '+String(j.message||''));return j.data;}
function sql(statement){const url=new URL(env.DATABASE_URL),r=spawnSync(process.env.MYSQL_BIN_DIR?join(process.env.MYSQL_BIN_DIR,'mysql'):'mysql',['--no-defaults','--protocol=TCP','--host='+url.hostname,'--port='+(url.port||3306),'--user='+decodeURIComponent(url.username),url.pathname.slice(1),'--delimiter=//','--execute',statement+'//'],{env:{...process.env,MYSQL_PWD:decodeURIComponent(url.password)},encoding:'utf8'});if(r.status!==0)throw Error('Synthetic SQL injection failed: '+r.stderr);}
async function start(){api=spawn(process.execPath,['apps/api/dist/main.js'],{env,stdio:['ignore','pipe','pipe']});api.stdout.on('data',b=>{log=(log+b).slice(-20000);});api.stderr.on('data',b=>{log=(log+b).slice(-20000);});for(let i=0;i<150;i++){try{if((await fetch(base+'/health/ready')).ok)return;}catch{}await delay(150);}throw Error('API not ready '+log.slice(-1000));}
async function waitJob(jobId,status='sent'){for(let i=0;i<200;i++){const job=await db.activitySyncJob.findUniqueOrThrow({where:{id:jobId}});if(job.status!=='dispatching'){eq(job.status,status,'durable job '+job.error);return job;}await delay(100);}throw Error('job not complete');}
const login=async username=>(await call('/auth/login',undefined,200,{tenantCode:env.TENANT_CODE,username,password})).accessToken;
const data=(title,changes={})=>({title:'【测试】'+title,description:'合成数据，无外部真实发送',location:'测试地点',startsAt:'2026-11-16T04:00:00.000Z',endsAt:'2026-11-16T04:30:00.000Z',freeBusy:'free',status:'scheduled',...changes});
const create=async(title,token,changes={})=>call('/calendar',token,201,{requestKey:randomUUID(),data:data(title,changes)});
const modify=async(entry,token,changes)=>call('/calendar/'+entry.id,token,200,{requestKey:randomUUID(),expectedUpdatedAt:entry.updatedAt,data:{...data('placeholder'),...entry,...changes,id:undefined,tenantId:undefined,ownerId:undefined,revision:undefined,origin:undefined,externalId:undefined,externalSnapshot:undefined,createdAt:undefined,updatedAt:undefined}},'PUT');
async function config(token,changes={}){const state=await call(root,token);return call(root+'/settings',token,201,{requestKey:randomUUID(),...(state.setting?{expectedUpdatedAt:state.setting.updatedAt}:{}),calendarEnabled:true,todoEnabled:true,autoEnabled:false,...changes});}
async function prepare(kind,sourceId,token){const scan=await call(root+'/preview',token),row=scan.items.find(r=>r.kind===kind&&r.sourceId===sourceId);ok(row,'source is included in preview');return(await call(root+'/prepare',token,201,{requestKey:randomUUID(),rows:[{kind,sourceId,sourceVersion:row.sourceVersion}]})).jobs[0];}
async function send(job,token,status='sent'){await call(root+'/jobs/'+job.id+'/dispatch',token,201,{requestKey:randomUUID(),expectedUpdatedAt:job.updatedAt});return waitJob(job.id,status);}
try{
  await initializeProduction(db,env);const tenant=await db.tenant.findUniqueOrThrow({where:{code:env.TENANT_CODE}}),tid=tenant.id;
  const admin=await db.user.findFirstOrThrow({where:{tenantId:tid,username:'admin'}}),dept=await db.department.findFirstOrThrow({where:{tenantId:tid}}),hash=await bcrypt.hash(password,10);
  async function user(username,code){const role=await db.role.findFirstOrThrow({where:{tenantId:tid,code}});return db.user.create({data:{tenantId:tid,username,name:'【测试】'+username,passwordHash:hash,deptId:dept.id,roles:{create:{tenantId:tid,roleId:role.id}}}});}
  const second=await user('second','sales_manager'),third=await user('third','sales_manager'),applicant=await user('applicant','sales'),boss=await user('boss','gm');
  const b={profile:env.DWS_PROFILE,corpId:env.DWS_EXPECTED_CORP_ID,userId:env.DWS_EXPECTED_USER_ID};
  for(const [u,externalId]of[[admin,'fixture-reader'],[second,'fixture-second'],[third,'fixture-third']])await db.integrationMapping.create({data:{tenantId:tid,provider:'dws-dingtalk',bindingHash:createHash('sha256').update(JSON.stringify(b)).digest('hex'),kind:'user',externalId,localId:u.id,externalName:'【测试】'+u.username}});
  await start();let token=await login('admin'),st=await login('second'),tt=await login('third'),at=await login('applicant'),bt=await login('boss');
  await call(root,undefined,401);eq((await call(root,at)).bound,false,'unmapped account cannot borrow administrator authorization');
  await call(root+'/settings',at,400,{requestKey:randomUUID(),calendarEnabled:true,todoEnabled:false,autoEnabled:false});
  eq((await call(root,st)).bound,true,'separate per-person server profile available');
  await config(token);await config(st);await config(tt);
  await call(root+'/settings',token,400,{requestKey:randomUUID(),tenantId:99,calendarEnabled:true,todoEnabled:true,autoEnabled:false});
  const settings=(await call(root,token)).setting;await call(root+'/settings',token,409,{requestKey:randomUUID(),expectedUpdatedAt:'2000-01-01T00:00:00.000Z',calendarEnabled:true,todoEnabled:true,autoEnabled:false});
  const c=await create('本人首个日程',token),other=await create('另一人员日程',st);
  const foreign=await db.tenant.create({data:{code:'ACTIVITYFOREIGN',name:'【测试】独立其他公司',status:'active'}}),foreignRole=await db.role.create({data:{tenantId:foreign.id,code:'super_admin',name:'【测试】管理员',permissions:['*'],dataScope:'all'}});
  await db.user.create({data:{tenantId:foreign.id,username:'foreign',name:'【测试】其他公司人员',passwordHash:hash,roles:{create:{tenantId:foreign.id,roleId:foreignRole.id}}}});
  const foreignToken=(await call('/auth/login',undefined,200,{tenantCode:foreign.code,username:'foreign',password})).accessToken;
  const foreignState=await call(root,foreignToken);eq(foreignState.jobs.length,0,'other company cannot see queue');eq(foreignState.links.length,0,'other company cannot see mappings');eq(foreignState.bound,false,'other company cannot inherit DWS binding');
  await call('/calendar/'+c.id,foreignToken,404,{requestKey:randomUUID(),expectedUpdatedAt:c.updatedAt,data:data('其他公司越权')},'PUT');
  await call('/calendar',token,400,{requestKey:randomUUID(),data:{...data('伪造归属'),ownerId:second.id}});
  await call('/calendar',token,400,{requestKey:randomUUID(),data:data('无效日期',{startsAt:'2026-02-30T12:00:00Z'})});
  await call('/calendar',bt,403,{requestKey:randomUUID(),data:data('老板只读')});
  const from='2026-11-01T00:00:00Z',until='2026-12-01T00:00:00Z';
  const list=await call('/calendar?from='+from+'&until='+until,token);eq(list.items.map(r=>r.id),[c.id],'even administrator only reads own personal calendar');
  await call('/calendar?from='+from+'&until=2027-12-01T00:00:00Z',token,400);
  await call('/calendar/'+other.id,token,404,{requestKey:randomUUID(),expectedUpdatedAt:other.updatedAt,data:data('越权改期')},'PUT');
  await call('/calendar/0',token,400,{requestKey:randomUUID(),data:data('无效零编号')},'PUT');
  const raceEntry=await create('并发改期',token);
  const races=await Promise.all(['A','B'].map(title=>call('/calendar/'+raceEntry.id,token,null,{requestKey:randomUUID(),expectedUpdatedAt:raceEntry.updatedAt,data:data('并发改期'+title)},'PUT')));
  eq(races.map(r=>r.status).sort(),[200,409],'parallel calendar edits have exactly one version winner');eq((await db.calendarEntry.findUniqueOrThrow({where:{id:raceEntry.id}})).revision,2,'lost update cannot bypass monotonic calendar version');
  const originalJobs=await db.activitySyncJob.count();const scan=await call(root+'/preview',token),r=scan.items.find(p=>p.sourceId===c.id&&p.kind==='calendar');
  eq(await db.activitySyncJob.count(),originalJobs,'preview creates no local outbox or remote records');eq(Object.keys(remote().calendars).length,0,'preview makes no remote writes');
  await call(root+'/prepare',token,404,{requestKey:randomUUID(),rows:[{kind:'calendar',sourceId:c.id,sourceVersion:r.sourceVersion},{kind:'calendar',sourceId:other.id,sourceVersion:r.sourceVersion}]});
  eq(await db.activitySyncJob.count(),originalJobs,'batch failure rolls back all prepared jobs');
  const prepared={requestKey:randomUUID(),rows:[{kind:'calendar',sourceId:c.id,sourceVersion:r.sourceVersion}]};const job=(await call(root+'/prepare',token,201,prepared)).jobs[0];eq((await call(root+'/prepare',token,201,prepared)).jobs[0].id,job.id,'prepare idempotency');
  await call(root+'/jobs/'+job.id+'/dispatch',st,404,{requestKey:randomUUID(),expectedUpdatedAt:job.updatedAt});
  const dispatch={requestKey:randomUUID(),expectedUpdatedAt:job.updatedAt};const results=await Promise.all([call(root+'/jobs/'+job.id+'/dispatch',token,201,dispatch),call(root+'/jobs/'+job.id+'/dispatch',token,201,dispatch)]);eq(results.filter(r=>r.status==='dispatching').length,1,'one receipt owner launches external effect');
  const sent=await waitJob(job.id);eq(Object.values(remote().calendars).filter(e=>e.summary.includes(job.payload.marker)).length,1,'concurrent same receipt creates exactly one event');
  await call(root+'/jobs/'+job.id+'/dispatch',token,201,dispatch);eq(Object.keys(remote().calendars).length,1,'replay never sends a fresh create');
  ok(!(await call(root+'/preview',token)).items.some(r=>r.kind==='calendar'&&r.sourceId===c.id),'JSON storage key order does not cause repeated export');
  eq((await db.activitySyncLink.findFirstOrThrow({where:{sourceId:c.id,kind:'calendar'}})).externalId,sent.externalId,'durable crosswalk recorded');
  const liveLink=await db.activitySyncLink.findFirstOrThrow({where:{tenantId:tid,ownerId:admin.id,kind:'calendar',sourceId:c.id}});
  await call(root+'/links/'+liveLink.id+'/archive',token,409,{requestKey:randomUUID(),expectedUpdatedAt:liveLink.updatedAt.toISOString()});
  let c2=await modify(c,token,{title:'【测试】本人日程改期',startsAt:'2026-11-16T05:00:00Z',endsAt:'2026-11-16T05:20:00Z'});const updated=await send(await prepare('calendar',c.id,token),token);eq(updated.externalId,sent.externalId,'reschedule keeps stable remote ID');
  c2=await modify(c2,token,{status:'cancelled'});await send(await prepare('calendar',c.id,token),token);ok(remote().calendars[sent.externalId].summary.startsWith('【已取消】'),'cancel marks existing external event');eq(remote().calendars[sent.externalId].freeBusy,'FREE','cancel releases busy time without deleting event');
  const cancelledLink=await db.activitySyncLink.findFirstOrThrow({where:{tenantId:tid,ownerId:admin.id,kind:'calendar',sourceId:c.id}});
  await config(token,{calendarEnabled:false});
  const archiveBody={requestKey:randomUUID(),expectedUpdatedAt:cancelledLink.updatedAt.toISOString()};
  await call(root+'/links/'+cancelledLink.id+'/archive',st,404,archiveBody);await call(root+'/links/'+cancelledLink.id+'/archive',token,201,archiveBody);await call(root+'/links/'+cancelledLink.id+'/archive',token,201,archiveBody);
  ok(!(await call(root,token)).links.some(l=>l.id===cancelledLink.id),'archived link hidden from active tracker but retained in DB');ok((await db.activitySyncLink.findUniqueOrThrow({where:{id:cancelledLink.id}})).archivedAt,'archive retains historical mapping');
  await config(token,{calendarEnabled:true});
  c2=await modify(c2,token,{status:'scheduled'});const resumed=await send(await prepare('calendar',c.id,token),token);eq(resumed.externalId,sent.externalId,'rescheduling archived calendar reactivates same remote ID');eq((await db.activitySyncLink.findUniqueOrThrow({where:{id:cancelledLink.id}})).archivedAt,null,'reactivated mapping is tracked again');
  const editRemote=remote();editRemote.calendars[sent.externalId].summary='【测试】在钉钉修改的主题';writeFileSync(remoteFile,JSON.stringify(editRemote));
  c2=await modify(c2,token,{title:'【测试】在CRM修改的主题'});const conflict=await send(await prepare('calendar',c.id,token),token,'rejected');eq(remote().calendars[sent.externalId].summary,'【测试】在钉钉修改的主题','remote edits are not silently overwritten');ok(conflict.evidence.canOverwrite,'conflict records explicit user resolution option');
  await call(root+'/jobs/'+conflict.id+'/dispatch',token,409,{requestKey:randomUUID(),expectedUpdatedAt:conflict.updatedAt});
  await call(root+'/jobs/'+conflict.id+'/dispatch',token,201,{requestKey:randomUUID(),expectedUpdatedAt:conflict.updatedAt,forceOverwrite:true});const overridden=await waitJob(conflict.id);eq(overridden.forceOverwrite,true,'explicit overwrite decision retained');eq(remote().calendars[sent.externalId].summary,conflict.payload.calendar.title,'explicit authorized resolution applies current CRM fields');
  const stale=await create('源版本冲突',token);const staleJob=await prepare('calendar',stale.id,token);await modify(stale,token,{title:'【测试】发送前源变化'});await call(root+'/jobs/'+staleJob.id+'/dispatch',token,409,{requestKey:randomUUID(),expectedUpdatedAt:staleJob.updatedAt});await call(root+'/jobs/'+staleJob.id+'/cancel',token,201,{requestKey:randomUUID(),expectedUpdatedAt:staleJob.updatedAt});
  const unknown=await create('写后结果丢失',token);const unknownJob=await prepare('calendar',unknown.id,token);mode('fail-after-create');let uncertain=await send(unknownJob,token,'uncertain');eq(uncertain.externalId,null,'lost creation reply retains unknown remote ID');
  await call(root+'/jobs/'+uncertain.id+'/dispatch',token,409,{requestKey:randomUUID(),expectedUpdatedAt:uncertain.updatedAt});
  await modify(unknown,token,{title:'【测试】不确定期间继续修改来源'});
  const stoppedJob=await call(root+'/jobs/'+uncertain.id+'/stop',token,201,{requestKey:randomUUID(),expectedUpdatedAt:uncertain.updatedAt});eq(stoppedJob.status,'stopped','unknown result can be safely stopped without claiming success');
  const blockedRow=(await call(root+'/preview',token)).items.find(r=>r.kind==='calendar'&&r.sourceId===unknown.id);
  await call(root+'/prepare',token,409,{requestKey:randomUUID(),rows:[{kind:'calendar',sourceId:unknown.id,sourceVersion:blockedRow.sourceVersion}]});
  uncertain=await call(root+'/jobs/'+uncertain.id+'/resume',token,201,{requestKey:randomUUID(),expectedUpdatedAt:stoppedJob.updatedAt});eq(uncertain.status,'uncertain','resume is read-only reconciliation, never fresh create');
  const actual=Object.values(remote().calendars).find(e=>e.summary.includes(unknownJob.payload.marker));ok(actual,'remote write did happen before reported failure');
  await call(root+'/jobs/'+uncertain.id+'/reconcile',token,409,{requestKey:randomUUID(),expectedUpdatedAt:uncertain.updatedAt,externalId:sent.externalId});
  const reconcile={requestKey:randomUUID(),expectedUpdatedAt:uncertain.updatedAt,externalId:actual.id};await call(root+'/jobs/'+uncertain.id+'/reconcile',token,201,reconcile);await call(root+'/jobs/'+uncertain.id+'/reconcile',token,201,reconcile);eq(Object.values(remote().calendars).filter(e=>e.summary.includes(unknownJob.payload.marker)).length,1,'reconciliation never recreates');
  const subsequent=await send(await prepare('calendar',unknown.id,token),token);eq(subsequent.externalId,actual.id,'reconcile old snapshot then update current source without duplicate event');
  const wrong=await create('授权拒绝前置检查',token),wrongJob=await prepare('calendar',wrong.id,token),count=Object.keys(remote().calendars).length;mode('wrong-corp');const rejected=await send(wrongJob,token,'rejected');eq(Object.keys(remote().calendars).length,count,'identity mismatch performs no external write');mode('normal');await call(root+'/jobs/'+rejected.id+'/cancel',token,201,{requestKey:randomUUID(),expectedUpdatedAt:rejected.updatedAt});
  const mismatch=await create('写后字段不符',token);mode('corrupt-read');const mismatchJob=await send(await prepare('calendar',mismatch.id,token),token,'uncertain');ok(mismatchJob.externalId,'stable ID survives failed readback');await call(root+'/jobs/'+mismatchJob.id+'/reconcile',token,201,{requestKey:randomUUID(),expectedUpdatedAt:mismatchJob.updatedAt});
  const auditFaultEntry=await create('外部成功后审计故障',token),auditFaultJob=await prepare('calendar',auditFaultEntry.id,token);
  let auditFault;
  sql("CREATE TRIGGER fixture_activity_result BEFORE INSERT ON audit_logs FOR EACH ROW BEGIN IF NEW.action = 'integration.activity.result' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic result audit fault'; END IF; END");
  try{auditFault=await send(auditFaultJob,token,'uncertain');ok(auditFault.externalId,'external ID retained when result transaction rolls back');eq(await db.activitySyncLink.count({where:{tenantId:tid,kind:'calendar',sourceId:auditFaultEntry.id}}),0,'failed result audit rolls back successful link');}
  finally{sql('DROP TRIGGER fixture_activity_result');}
  await call(root+'/jobs/'+auditFault.id+'/reconcile',token,201,{requestKey:randomUUID(),expectedUpdatedAt:auditFault.updatedAt});eq(Object.values(remote().calendars).filter(e=>e.summary.includes(auditFaultJob.payload.marker)).length,1,'result-transaction recovery does not repeat external create');
  // Real approval APIs: countersign, partial vote, transfer, final decision and withdrawal.
  const flow=await call('/approvals/flows',token,201,{requestKey:randomUUID(),name:'【测试】待办会签',bizType:'general',priority:1000,fields:[],nodes:[{name:'【测试】会签',approverType:'users_all',approverValue:[admin.id,second.id].join(','),condition:'always'}]});await call('/approvals/flows/'+flow.id+'/publish',token,201,{requestKey:randomUUID(),expectedUpdatedAt:flow.updatedAt});
  const approval=await call('/approvals',at,201,{requestKey:randomUUID(),flowId:flow.id,title:'【测试】日程集成会签',form:{}});const detail=await call('/approvals/'+approval.id,token),n=detail.nodes.find(n=>n.approverId===admin.id),n2=detail.nodes.find(n=>n.approverId===second.id);
  const activeFlow=(await call('/approvals/flows',token)).find(f=>f.id===flow.id);
  await call('/approvals/flows/'+flow.id+'/deactivate',st,403,{requestKey:randomUUID(),expectedUpdatedAt:activeFlow.updatedAt});
  await call('/approvals/flows/'+flow.id+'/deactivate',token,409,{requestKey:randomUUID(),expectedUpdatedAt:'2000-01-01T00:00:00.000Z'});
  const deactivation={requestKey:randomUUID(),expectedUpdatedAt:activeFlow.updatedAt};
  const disabledFlow=await call('/approvals/flows/'+flow.id+'/deactivate',token,201,deactivation);await call('/approvals/flows/'+flow.id+'/deactivate',token,201,deactivation);
  await call('/approvals',at,400,{requestKey:randomUUID(),flowId:flow.id,title:'【测试】停用后拒绝新申请',form:{}});
  const reminder=await send(await prepare('approval',n.id,token),token),reminder2=await send(await prepare('approval',n2.id,st),st);eq(remote().todos[reminder.externalId].isDone,false,'both countersign voters receive their own pending reminder');
  const remoteState=remote();remoteState.todos[reminder.externalId].isDone=true;writeFileSync(remoteFile,JSON.stringify(remoteState));eq((await db.approval.findUniqueOrThrow({where:{id:approval.id}})).status,'pending','external todo completion never approves CRM');
  await call('/approvals/'+approval.id+'/nodes/'+n.id+'/approve',token,201,{requestKey:randomUUID(),comment:'【测试】第一票'});await send(await prepare('approval',n.id,token),token);eq((await db.approval.findUniqueOrThrow({where:{id:approval.id}})).status,'pending','first countersign vote does not finish approval');
  const current=await call('/approvals/'+approval.id,st);await call('/approvals/'+approval.id+'/nodes/'+n2.id+'/transfer',st,201,{requestKey:randomUUID(),expectedUpdatedAt:current.updatedAt,targetUserId:third.id,reason:'【测试】转审'});await send(await prepare('approval',n2.id,st),st);eq(remote().todos[reminder2.externalId].isDone,true,'transfer closes old voter reminder');
  const transferred=(await call('/approvals/'+approval.id,tt)).nodes.find(node=>node.approverId===third.id&&node.action==='pending');const reminder3=await send(await prepare('approval',transferred.id,tt),tt);
  await call('/approvals/'+approval.id+'/nodes/'+transferred.id+'/approve',tt,201,{requestKey:randomUUID(),comment:'【测试】完成会签'});await send(await prepare('approval',transferred.id,tt),tt);eq(remote().todos[reminder3.externalId].isDone,true,'final approval closes final reminder');
  await call('/approvals/flows/'+flow.id+'/publish',token,201,{requestKey:randomUUID(),expectedUpdatedAt:disabledFlow.updatedAt});
  const withdrawn=await call('/approvals',at,201,{requestKey:randomUUID(),flowId:flow.id,title:'【测试】待办撤回',form:{}});const wn=(await call('/approvals/'+withdrawn.id,token)).nodes.find(n=>n.approverId===admin.id);const wr=await send(await prepare('approval',wn.id,token),token);await call('/approvals/'+withdrawn.id+'/withdraw',at,201,{requestKey:randomUUID(),reason:'【测试】撤回'});await send(await prepare('approval',wn.id,token),token);eq(remote().todos[wr.externalId].isDone,true,'withdrawal closes reminder');
  // Restart after a provider accepted a nonidempotent create but before the API got its reply.
  const interruptedEntry=await create('进程中断',token),interruptedJob=await prepare('calendar',interruptedEntry.id,token);mode('hang-after-create');await call(root+'/jobs/'+interruptedJob.id+'/dispatch',token,201,{requestKey:randomUUID(),expectedUpdatedAt:interruptedJob.updatedAt});
  let interruptedRemote;for(let i=0;i<100;i++){interruptedRemote=Object.values(remote().calendars).find(e=>e.summary.includes(interruptedJob.payload.marker));if(interruptedRemote)break;await delay(100);}ok(interruptedRemote,'provider accepted create before process termination');api.kill('SIGKILL');await new Promise(resolve=>api.once('exit',resolve));await start();token=await login('admin');st=await login('second');tt=await login('third');at=await login('applicant');
  eq((await call(root+'/preview',token)).items.filter(r=>r.kind==='approval').length,0,'new login and unchanged closed reminders cause no phantom exports');
  const interruptedRow=await db.activitySyncJob.findUniqueOrThrow({where:{id:interruptedJob.id}});eq(interruptedRow.status,'uncertain','restart converts sending into uncertain, never blindly resumes');await call(root+'/jobs/'+interruptedRow.id+'/reconcile',token,201,{requestKey:randomUUID(),expectedUpdatedAt:interruptedRow.updatedAt,externalId:interruptedRemote.id});eq(Object.values(remote().calendars).filter(e=>e.summary.includes(interruptedJob.payload.marker)).length,1,'restart and reconcile preserve unique external event');
  const ownJobs=(await call(root,token)).jobs;ok(!ownJobs.some(j=>j.payload.todo?.title.includes(reminder2.payload?.marker||'NONEXISTENT')),'personal queue excludes another user data');await call(root+'/jobs/'+reminder2.id+'/cancel',token,404,{requestKey:randomUUID(),expectedUpdatedAt:reminder2.updatedAt});
  await send(await prepare('calendar',other.id,st),st);
  // Automatic tick: one active owner succeeds, an inactive owner must never send.
  const now=new Date(),end=new Date(now.getTime()+1800000);const auto=await create('自动同步日程',st,{startsAt:now.toISOString(),endsAt:end.toISOString()}),stopped=await create('停用后不发送',tt,{startsAt:now.toISOString(),endsAt:end.toISOString()});await config(st,{autoEnabled:true});await config(tt,{autoEnabled:true});
  const thirdRow=await call('/system/users/'+third.id,token);await call('/system/users/'+third.id,token,200,{requestKey:randomUUID(),expectedUpdatedAt:thirdRow.updatedAt,data:{status:'inactive'}},'PUT');
  await call(root,tt,401);
  let autoLink;for(let i=0;i<100;i++){autoLink=await db.activitySyncLink.findFirst({where:{tenantId:tid,ownerId:second.id,kind:'calendar',sourceId:auto.id}});if(autoLink)break;await delay(1000);}ok(autoLink,'consent-based background tick exports real source to its own profile');
  eq(Object.values(remote().calendars).filter(e=>e.summary.includes(':'+stopped.id+']')).length,0,'inactive owner sends nothing');ok((await db.activitySyncSetting.findUniqueOrThrow({where:{tenantId_ownerId:{tenantId:tid,ownerId:third.id}}})).lastError,'automatic failure is visible in persistent settings');
  await config(st,{autoEnabled:false});
  const revokedEntry=await create('撤权前入队',st),revokedJob=await prepare('calendar',revokedEntry.id,st);
  const policy=(await call('/system/access-policy',token)).roles.find(r=>r.code==='sales_manager');
  await call('/system/access-policy/roles/'+policy.id,token,201,{requestKey:randomUUID(),expectedUpdatedAt:policy.updatedAt,dataScope:policy.dataScope,permissions:policy.configuredPoints.filter(p=>!p.startsWith('action:'))});
  await call(root,st,401);st=await login('second');
  await call('/calendar?from='+from+'&until='+until,st,403);
  ok(!(await call(root,st)).jobs.some(j=>j.kind==='calendar'),'revoked calendar module hides old job payloads');
  await call(root+'/jobs/'+revokedJob.id+'/dispatch',st,403,{requestKey:randomUUID(),expectedUpdatedAt:revokedJob.updatedAt});
  await call(root+'/jobs/'+revokedJob.id+'/cancel',st,403,{requestKey:randomUUID(),expectedUpdatedAt:revokedJob.updatedAt});
  eq((await db.activitySyncJob.findUniqueOrThrow({where:{id:revokedJob.id}})).status,'prepared','revoked identity cannot mutate queued work');
  const changedPolicy=(await call('/system/access-policy',token)).roles.find(r=>r.id===policy.id);
  await call('/system/access-policy/roles/'+policy.id,token,201,{requestKey:randomUUID(),expectedUpdatedAt:changedPolicy.updatedAt,dataScope:policy.dataScope,permissions:policy.configuredPoints});st=await login('second');
  // Synthetic capacity fixture proves existing queued rows are not double-counted during re-prepare.
  await db.calendarEntry.createMany({data:Array.from({length:100},(_,i)=>({tenantId:tid,ownerId:admin.id,title:'【测试】队列容量'+i,description:'',location:'',startsAt:new Date('2026-11-16T06:00:00Z'),endsAt:new Date('2026-11-16T06:10:00Z'),freeBusy:'free'}))});
  const capacityIds=(await db.calendarEntry.findMany({where:{tenantId:tid,ownerId:admin.id,title:{startsWith:'【测试】队列容量'}},select:{id:true}})).map(r=>r.id);
  const capacityRows=(await call(root+'/preview',token)).items.filter(r=>capacityIds.includes(r.sourceId)&&r.kind==='calendar').map(({kind,sourceId,sourceVersion})=>({kind,sourceId,sourceVersion}));eq(capacityRows.length,100,'all capacity fixture sources present');
  const capacityJobs=[];for(const rows of [capacityRows.slice(0,50),capacityRows.slice(50)])capacityJobs.push(...(await call(root+'/prepare',token,201,{requestKey:randomUUID(),rows})).jobs);
  eq((await call(root+'/prepare',token,201,{requestKey:randomUUID(),rows:capacityRows.slice(0,50)})).jobs.length,50,'100 existing jobs can be safely re-prepared without deadlocking capacity');
  const extra=await create('第101条容量',token),extraRow=(await call(root+'/preview',token)).items.find(r=>r.kind==='calendar'&&r.sourceId===extra.id);
  await call(root+'/prepare',token,400,{requestKey:randomUUID(),rows:[{kind:'calendar',sourceId:extra.id,sourceVersion:extraRow.sourceVersion}]});
  await db.activitySyncJob.updateMany({where:{id:{in:capacityJobs.map(j=>j.id)}},data:{status:'cancelled',error:'Synthetic capacity fixture cleanup; never sent'}});
  await db.calendarEntry.updateMany({where:{id:{in:[...capacityIds,extra.id]}},data:{status:'cancelled'}});
  const limitedEntry=await create('对应容量守卫',token),limitedJob=await prepare('calendar',limitedEntry.id,token);
  const activeLinkCount=await db.activitySyncLink.count({where:{tenantId:tid,ownerId:admin.id,archivedAt:null}}),fillerCount=500-activeLinkCount;
  // Synthetic capacity-only links; these provider IDs are never dispatched or presented as real integration evidence.
  await db.calendarEntry.createMany({data:Array.from({length:fillerCount},(_,i)=>({tenantId:tid,ownerId:admin.id,title:'【测试】对应容量夹具'+i,description:'',location:'',startsAt:new Date('2020-01-01T00:00:00Z'),endsAt:new Date('2020-01-01T00:10:00Z'),status:'cancelled',freeBusy:'free'}))});
  const fillerEntries=await db.calendarEntry.findMany({where:{tenantId:tid,ownerId:admin.id,title:{startsWith:'【测试】对应容量夹具'}}});
  await db.activitySyncLink.createMany({data:fillerEntries.map(e=>({tenantId:tid,ownerId:admin.id,kind:'calendar',sourceId:e.id,bindingHash:settings.bindingHash,externalId:'capacity-only-'+e.id,sourceVersion:'0'.repeat(64),payload:{fixture:true}}))});
  const countBeforeCapacity=Object.keys(remote().calendars).length;await call(root+'/jobs/'+limitedJob.id+'/dispatch',token,409,{requestKey:randomUUID(),expectedUpdatedAt:limitedJob.updatedAt});eq(Object.keys(remote().calendars).length,countBeforeCapacity,'500 active mappings are enforced before external effect');
  await db.activitySyncLink.updateMany({where:{tenantId:tid,ownerId:admin.id,sourceId:{in:fillerEntries.map(e=>e.id)},kind:'calendar'},data:{archivedAt:new Date()}});
  await call(root+'/jobs/'+limitedJob.id+'/cancel',token,201,{requestKey:randomUUID(),expectedUpdatedAt:limitedJob.updatedAt});
  const historical=[];let cursor;
  do{const page=await call(root+'/history'+(cursor?'?before='+cursor:''),token);historical.push(...page.items.map(j=>j.id));cursor=page.nextCursor;}while(cursor);
  eq(new Set(historical).size,historical.length,'history cursor pages never duplicate jobs');eq(historical.length,await db.activitySyncJob.count({where:{tenantId:tid,ownerId:admin.id}}),'all own history remains available beyond100');
  await call(root+'/history?before='+reminder2.id,token,404);eq((await call(root+'/history',foreignToken)).items.length,0,'foreign tenant history empty');
  const restorePending=await prepare('calendar',(await create('恢复待发队列',token)).id,token);
  const restoreInterrupted=await prepare('calendar',(await create('恢复中断队列',token)).id,token);
  // Explicit synthetic interrupted-state fixture; no provider call is launched from this DB write.
  await db.activitySyncJob.update({where:{id:restoreInterrupted.id},data:{status:'dispatching',leaseToken:randomUUID()}});
  // Restore includes nonempty calendars, jobs, mappings, and intentionally disables external consent.
  const file=join(directory,'activity.crmbackup'),restoreName='tb_crm_restore_activity_'+Date.now(),backupEnv={...env,DB_TRANSPORT:'native',MYSQL_BIN_DIR:process.env.MYSQL_BIN_DIR||''};
  for(const args of [['backup',file],['restore',file,restoreName]]){const r=spawnSync(process.execPath,['deploy/data.mjs',...args],{env:backupEnv,encoding:'utf8'});ok(r.status===0,'encrypted nonempty activity recovery '+r.stderr);}
  const cloneURL=new URL(env.DATABASE_URL);cloneURL.pathname='/'+restoreName;const clone=new PrismaClient({datasourceUrl:cloneURL.href});try{eq(await clone.calendarEntry.count(),await db.calendarEntry.count(),'restored calendars retained');eq(await clone.activitySyncLink.count(),await db.activitySyncLink.count(),'restored external links retained');eq(await clone.activitySyncJob.count(),await db.activitySyncJob.count(),'restored job evidence retained');eq(await clone.activitySyncSetting.count({where:{OR:[{calendarEnabled:true},{todoEnabled:true},{autoEnabled:true}]}}),0,'restored copy cannot automatically send external messages');eq(await clone.authSession.count({where:{revokedAt:null}}),0,'restored sessions revoked');eq((await clone.activitySyncJob.findUniqueOrThrow({where:{id:restorePending.id}})).status,'cancelled','restored pending queue requires fresh consent');eq((await clone.activitySyncJob.findUniqueOrThrow({where:{id:restoreInterrupted.id}})).status,'uncertain','restored interrupted queue requires reconciliation');}finally{await clone.$disconnect();}
  ok(await db.auditLog.count({where:{tenantId:tid,source:'system',action:'integration.activity.result'}})>0,'external receipts recorded by bounded trusted system principal');
  if(process.env.SAVE_ACTIVITY_UI==='true'){writeFileSync('.local/activity-ui-context.json',JSON.stringify({env,fixtureDirectory:directory,password}),{mode:0o600});}
  console.log(JSON.stringify({result:'PASS',checks,externalProtocol:'synthetic CLI only',durableQueue:true,approvalLifecycle:true,automaticConsent:true,encryptedRecovery:true}));
}catch(error){console.error(log.slice(-1400));throw error;}finally{api?.kill('SIGTERM');await db.$disconnect();}
