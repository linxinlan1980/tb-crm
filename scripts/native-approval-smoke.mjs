import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url)),
  { PrismaClient } = require('@prisma/client'),
  bcrypt = require('bcrypt');
const db = new PrismaClient(),
  directory = mkdtempSync(join(tmpdir(), 'crm-native-')),
  remoteFile = join(directory, 'remote.json'),
  executable = join(directory, 'fixture-dws');
const labels = [
  '本地审批编号',
  '合同编号',
  '合同名称',
  '客户名称',
  '签约主体',
  '合同金额',
  'CRM申请人',
  '审核指纹',
  '说明',
];
writeFileSync(remoteFile, JSON.stringify({ mode: 'normal', creates: 0, instances: {}, labels }));
writeFileSync(
  executable,
  `#!/usr/bin/env node
const fs=require('fs'),file=${JSON.stringify(remoteFile)},s=JSON.parse(fs.readFileSync(file)),args=process.argv.slice(2),val=k=>args[args.indexOf(k)+1];let out;const schema={title:'Synthetic form',items:s.labels.map((label,i)=>({componentName:'TextField',props:{id:'Synthetic-'+i,label,required:true}}))};const template={processCode:'PROC-SYNTHETIC',name:'Synthetic native approval',status:'PUBLISHED',properties:JSON.stringify({autoExecuteOriginatorTasks:'false'}),schemaContent:JSON.stringify(schema),processConfig:JSON.stringify({type:'start',childNode:{type:'approver',properties:{activateType:'ALL',agreeAll:false,approvalType:'MANUAL',actionerRules:[{type:'target_approval',approvals:[{workNo:'synthetic-a'},{workNo:'synthetic-b'}]}]}}})};
if(args[2]==='get-self')out={success:true,result:[{orgEmployeeModel:{corpId:'synthetic-corp',userId:'synthetic-self',depts:[{deptId:1}]}}]};
else if(args[0]==='contact'&&args[2]==='get')out={success:true,result:val('--ids').split(',').map(id=>({orgEmployeeModel:{orgUserId:id,orgUserName:'Synthetic '+id}}))};
else if(args[2]==='template')out={ok:true,data:{templates:[template]}};
else if(args[2]==='form-schema')out={success:true,result:{content:JSON.stringify(schema)}};
else if(args[2]==='forecast-process')out={success:true,result:{forecastSuccess:true,processCode:'PROC-SYNTHETIC',userId:'synthetic-self',workflowActivityRuleVOs:[{targetSelect:false,workflowActor:{agreeAll:false,actorActivateType:'ALL',approvalType:'MANUAL'},activityActioners:[{emplId:'synthetic-a'},{emplId:'synthetic-b'}]}]}};
else if(args[2]==='create-instance'){if(!args.includes('--yes'))process.exit(2);const request=JSON.parse(val('--request')),id='synthetic-instance-'+(++s.creates);s.instances[id]={request,status:'pending'};out=s.mode.startsWith('uncertain')?{success:false}:{success:true,result:{processInstanceId:id}};}
else if(args[2]==='list-initiated'){out=s.mode==='uncertain-unreadable'?{success:false}:{success:true,result:{hasMore:false,processInstanceList:Object.keys(s.instances).map(processInstanceId=>({processInstanceId,originatorUserid:'synthetic-self'}))}};}
else if(args[2]==='detail'||args[2]==='records'){const id=val('--instance-id'),i=s.instances[id];if(!i)process.exit(2);const approved=i.status==='approved',rejected=i.status==='rejected',resolved=approved||rejected,result=approved?'AGREE':rejected?'REFUSE':'NONE';const records=resolved?[{operationType:'EXECUTE_TASK_NORMAL',operationResult:result,userId:'synthetic-a',operationTime:Date.now()}]:[];if(args[2]==='records')out={success:true,result:{processInstanceId:id,operationRecords:records}};else{out={errcode:0,result:{processInstanceId:id,processCode:'PROC-SYNTHETIC',originatorUserid:'synthetic-self',originatorDeptId:'1',status:resolved?'COMPLETED':'RUNNING',processInstanceResult:approved?'agree':rejected?'refuse':'',formValueVOS:structuredClone(i.request.formComponentValues),tasks:[{userId:'synthetic-a',taskStatus:resolved?'COMPLETED':'RUNNING',taskResult:result},{userId:'synthetic-b',taskStatus:resolved?'CANCELED':'RUNNING',taskResult:'NONE'}],operationRecords:resolved?[{type:'EXECUTE_TASK_NORMAL',result,userId:'synthetic-a',remark:'Synthetic decision'}]:[]}};if(s.mode==='tamper')out.result.formValueVOS[0].value='tampered';}}
else process.exit(2);fs.writeFileSync(file,JSON.stringify(s));console.log(JSON.stringify(out));
`,
  { mode: 0o700 },
);
const password = 'Synthetic-' + randomBytes(12).toString('hex'),
  port = '4143',
  env = {
    ...process.env,
    APP_URL: 'http://127.0.0.1:4143',
    HOST: '127.0.0.1',
    PORT: port,
    DEMO_MODE: 'false',
    TENANT_CODE: 'NATIVETEST',
    TENANT_NAME: 'Synthetic native test',
    ADMIN_USERNAME: 'admin',
    SEED_ADMIN_PASSWORD: password,
    JWT_SECRET: randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    BACKUP_KEY: randomBytes(32).toString('hex'),
    DWS_PROFILE: 'synthetic-oa',
    DWS_EXPECTED_CORP_ID: 'synthetic-corp',
    DWS_EXPECTED_USER_ID: 'synthetic-self',
    DWS_OA_BINARY: executable,
    CRM_ACCOUNT_WORKER: 'true',
    ENABLE_LEGACY_CRON: 'false',
  };
let api,
  checks = 0,
  log = '';
const eq = (a, b, m) => {
  assert.deepEqual(a, b, m);
  checks++;
};
const root = '/integrations/dingtalk-native-approval',
  url = 'http://127.0.0.1:' + port + '/api/v1';
const remote = () => JSON.parse(readFileSync(remoteFile)),
  mutate = (fn) => {
    const s = remote();
    fn(s);
    writeFileSync(remoteFile, JSON.stringify(s));
  };
async function call(path, token, body, expected = 200) {
  const r = await fetch(url + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  eq(r.status, expected, path + ' ' + String(j.message ?? ''));
  return j.data;
}
try {
  await initializeProduction(db, env);
  const tenant = await db.tenant.findFirstOrThrow(),
    owner = await db.user.findFirstOrThrow(),
    role = await db.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'super_admin' } }),
    hash = await bcrypt.hash(password, 10);
  const users = [];
  for (const name of ['synthetic-a', 'synthetic-b'])
    users.push(
      await db.user.create({
        data: {
          tenantId: tenant.id,
          username: name,
          name,
          deptId: owner.deptId,
          passwordHash: hash,
          roles: { create: { tenantId: tenant.id, roleId: role.id } },
        },
      }),
    );
  const binding = { profile: env.DWS_PROFILE, corpId: env.DWS_EXPECTED_CORP_ID, userId: env.DWS_EXPECTED_USER_ID },
    bindingHash = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
  for (const [id, externalId] of [[owner.id, 'synthetic-self'], ...users.map((u) => [u.id, u.name])])
    await db.integrationMapping.create({
      data: {
        tenantId: tenant.id,
        provider: 'dws-dingtalk',
        kind: 'user',
        localId: id,
        externalId,
        externalName: externalId,
        bindingHash,
      },
    });
  api = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stdout.on('data', (d) => (log += d));
  api.stderr.on('data', (d) => (log += d));
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url + '/health/ready')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert(ready, 'API boot');
  const login = await call('/auth/login', null, { tenantCode: env.TENANT_CODE, username: 'admin', password }, 200),
    token = login.accessToken,
    other = (
      await call('/auth/login', null, { tenantCode: env.TENANT_CODE, username: users[0].username, password }, 200)
    ).accessToken;
  const flow = await call(
    '/approvals/flows',
    token,
    {
      requestKey: randomUUID(),
      name: 'Synthetic native OR',
      bizType: 'contract',
      priority: 999,
      nodes: [
        {
          name: 'Synthetic group',
          approverType: 'users_any',
          approverValue: [owner.id, ...users.map((u) => u.id)].join(','),
        },
      ],
    },
    201,
  );
  await call(
    '/approvals/flows/' + flow.id + '/publish',
    token,
    { requestKey: randomUUID(), expectedUpdatedAt: flow.updatedAt },
    201,
  );
  const policy = {
    enabled: true,
    processCode: 'PROC-SYNTHETIC',
    departmentId: 1,
    flowId: flow.id,
    fromDate: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
    autoPoll: false,
  };
  await call(root + '/settings', token, { requestKey: randomUUID(), data: policy }, 201);
  await call(root + '/probe', token, { requestKey: randomUUID() }, 201);
  const customer = await call(
    '/workspace/customers',
    token,
    { requestKey: randomUUID(), data: { name: 'Synthetic native customer' } },
    201,
  );
  async function document() {
    let c = await call(
      '/workspace/contracts',
      token,
      {
        requestKey: randomUUID(),
        data: {
          name: 'Synthetic native contract ' + randomUUID().slice(0, 6),
          customerId: customer.id,
          contractType: 'other',
          amount: '0.01',
          signingCompany: 'Synthetic vendor',
          paymentTerms: 'Synthetic terms',
        },
      },
      201,
    );
    c = await call(
      '/workspace/contracts/' + c.id + '/submit',
      token,
      { requestKey: randomUUID(), expectedUpdatedAt: c.updatedAt },
      201,
    );
    const saved = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
    return db.approval.findUniqueOrThrow({ where: { id: saved.approvalId } });
  }
  async function preview(a) {
    return call(
      root + '/prepare',
      token,
      { requestKey: randomUUID(), approvalId: a.id, expectedUpdatedAt: a.updatedAt },
      201,
    );
  }
  async function send(p, status = 201) {
    const row = await db.integrationRun.findUniqueOrThrow({ where: { id: p.runId } });
    return call(
      root + '/runs/' + p.runId + '/dispatch',
      token,
      { requestKey: randomUUID(), expectedUpdatedAt: row.updatedAt, digest: p.digest, confirm: true },
      status,
    );
  }
  const a = await document(),
    p = await preview(a);
  eq(remote().creates, 0, 'preview never writes externally');
  await call(
    root + '/runs/' + p.runId + '/dispatch',
    token,
    {
      requestKey: randomUUID(),
      expectedUpdatedAt: (await db.integrationRun.findUniqueOrThrow({ where: { id: p.runId } })).updatedAt,
      digest: p.digest,
      confirm: false,
    },
    400,
  );
  await send(p);
  eq(remote().creates, 1, 'one external instance');
  await send(p);
  eq(remote().creates, 1, 'repeat cannot create twice');
  const link = await db.integrationMapping.findFirstOrThrow({ where: { provider: 'dws-oa', localId: a.id } });
  const node = await db.approvalNode.findFirstOrThrow({ where: { approvalId: a.id, approverId: users[0].id } });
  await call('/approvals/' + a.id + '/nodes/' + node.id + '/approve', other, { requestKey: randomUUID() }, 403);
  eq(
    (await db.approval.findUniqueOrThrow({ where: { id: a.id } })).status,
    'pending',
    'local approval blocked while native active',
  );
  await call(root + '/runs/' + p.runId + '/reconcile', other, { requestKey: randomUUID() }, 400);
  mutate((s) => {
    s.instances[link.externalId].status = 'approved';
    s.mode = 'tamper';
  });
  await call(root + '/runs/' + p.runId + '/reconcile', token, { requestKey: randomUUID() }, 400);
  eq(
    (await db.approval.findUniqueOrThrow({ where: { id: a.id } })).status,
    'pending',
    'tampered native form never applied',
  );
  mutate((s) => (s.mode = 'normal'));
  await call(root + '/runs/' + p.runId + '/reconcile', token, { requestKey: randomUUID() }, 201);
  eq(
    (await db.approval.findUniqueOrThrow({ where: { id: a.id } })).status,
    'approved',
    'actual provider decision uses generic approval',
  );
  eq(await db.approvalNode.count({ where: { approvalId: a.id, action: 'skipped' } }), 1, 'remaining OR voter skipped');
  eq(
    (await db.contract.findUniqueOrThrow({ where: { id: a.bizId } })).status,
    'approved',
    'same atomic business callback',
  );
  eq(await db.approvalEvent.count({ where: { approvalId: a.id, action: 'approved' } }), 1, 'one completion event');
  eq(await db.receipt.count(), 0, 'approval does not invent receipts');
  const b = await document(),
    bp = await preview(b);
  mutate((s) => (s.mode = 'uncertain-unreadable'));
  await send(bp, 409);
  eq(remote().creates, 2, 'uncertain write attempted only once');
  await send(bp, 409);
  eq(remote().creates, 2, 'uncertain write never retried');
  eq(
    (await db.integrationRun.findUniqueOrThrow({ where: { id: bp.runId } })).status,
    'uncertain',
    'uncertain state durable',
  );
  mutate((s) => (s.mode = 'normal'));
  const recoverRow = await db.integrationRun.findUniqueOrThrow({where:{id:bp.runId}});
  await call(root+'/runs/'+bp.runId+'/recover',other,{requestKey:randomUUID(),expectedUpdatedAt:recoverRow.updatedAt},400);
  await call(root+'/runs/'+bp.runId+'/recover',token,{requestKey:randomUUID(),expectedUpdatedAt:recoverRow.updatedAt},201);
  eq(remote().creates,2,'manual read-only recovery never creates another instance');
  const recovered = await db.integrationRun.findUniqueOrThrow({where:{id:bp.runId}});
  eq(recovered.status,'sent');eq(recovered.summary.externalId,'synthetic-instance-2');
  eq(recovered.snapshot.providerWriteReceipt.response.success,false,'private failed write receipt retained');
  const recoverable = await document(), recoverablePreview = await preview(recoverable);
  mutate(s=>s.mode='uncertain');
  await send(recoverablePreview);
  eq(remote().creates,3,'automatic recovery after ambiguous receipt creates only once');
  eq((await db.integrationRun.findUniqueOrThrow({where:{id:recoverablePreview.runId}})).summary.readbackVerified,true);
  mutate(s=>s.mode='normal');
  const stale = await document(),
    sp = await preview(stale);
  await db.contract.update({ where: { id: stale.bizId }, data: { remark: 'Concurrent change' } });
  await send(sp, 409);
  eq(remote().creates, 3, 'changed source cannot be sent');
  const reject = await document(),
    rp = await preview(reject);
  await send(rp);
  const rl = await db.integrationMapping.findFirstOrThrow({ where: { provider: 'dws-oa', localId: reject.id } });
  mutate((s) => (s.instances[rl.externalId].status = 'rejected'));
  await call(root + '/runs/' + rp.runId + '/reconcile', token, { requestKey: randomUUID() }, 201);
  eq(
    (await db.approval.findUniqueOrThrow({ where: { id: reject.id } })).status,
    'rejected',
    'native rejection recorded',
  );
  eq(
    (await db.contract.findUniqueOrThrow({ where: { id: reject.bizId } })).status,
    'rejected',
    'native rejection callback',
  );
  eq(
    await db.approvalEvent.count({ where: { approvalId: a.id, actorId: users[0].id, action: 'approved' } }),
    1,
    'actual actor preserved without human session forgery',
  );
  const setting = await call(root, token);
  await call(
    root + '/settings',
    token,
    { requestKey: randomUUID(), expectedUpdatedAt: setting.updatedAt, data: { ...policy, autoPoll: true } },
    201,
  );
  const automatic = await document(),
    automaticPreview = await preview(automatic);
  await send(automaticPreview);
  const automaticLink = await db.integrationMapping.findFirstOrThrow({
    where: { provider: 'dws-oa', localId: automatic.id },
  });
  mutate((s) => {
    s.instances[automaticLink.externalId].status = 'approved';
  });
  let completed = false;
  for (let i = 0; i < 700; i++) {
    if ((await db.approval.findUniqueOrThrow({ where: { id: automatic.id } })).status === 'approved') {
      completed = true;
      break;
    }
    await delay(100);
  }
  eq(completed, true, 'background outbound poll applies the actual decision without a human JWT');
  eq(
    (await db.systemCommandExecution.count({
      where: { jobName: 'dingtalk_approval', command: 'approval.native.result' },
    })) > 0,
    true,
    'bounded system principal receipt',
  );
  const retained = await db.integrationRun.findUniqueOrThrow({ where: { id: automaticPreview.runId } });
  eq(!!retained.snapshot.providerEvidence, true, 'raw provider evidence retained privately with fingerprint');
  console.log(
    JSON.stringify({
      status: 'PASS',
      checks,
      syntheticOnly: true,
      realMySql: true,
      nativeNetwork: 'fixture',
      nativeHumanAcceptance: false,
    }),
  );
} catch (e) {
  writeFileSync(join(directory, 'api.log'), log, { mode: 0o600 });
  throw e;
} finally {
  if (api) {
    api.kill('SIGTERM');
    await delay(200);
  }
  await db.$disconnect();
}
