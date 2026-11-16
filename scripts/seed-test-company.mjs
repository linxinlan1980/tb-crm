// Explicit, persistent TEST company fixtures. Never resets, deletes, or seeds a business account.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient, Prisma } = require('@prisma/client');
const businessDate = (offset = 0) => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
export async function populateTestCompany({
  dir = join(project, '.local/accounts'),
  url = 'http://127.0.0.1:3000',
  code = 'TEST',
} = {}) {
  assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true', 'Explicit test-write authorization required');
  assert.equal(code, 'TEST', 'This fixture workflow is restricted to company TEST');
  const registry = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
  const account = registry.accounts.find((a) => a.code === code && a.status === 'ready');
  assert.equal(account?.purpose, 'test', 'Business accounts cannot be populated');
  const config = JSON.parse(readFileSync(account.configFile, 'utf8'));
  assert.equal(config.ACCOUNT_PURPOSE, 'test');
  assert.equal(config.TENANT_CODE, code);
  assert.match(new URL(config.DATABASE_URL).pathname, /^\/tbcrm_(c|test)_[a-f0-9]{16}$/);
  const target = new URL(url);
  assert(['localhost', '127.0.0.1'].includes(target.hostname), 'Fixtures use the local gateway only');
  const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  const manifestFile = join(dir, 'TEST-fixtures-v1.json');
  let state;
  if (existsSync(manifestFile)) state = JSON.parse(readFileSync(manifestFile, 'utf8'));
  else {
    assert.equal(await db.customer.count(), 0, 'Nonempty test data is preserved; initialization will not overwrite it');
    assert.equal(await db.user.count(), 1, 'Initialize a fresh test company only');
    state = {
      version: 1,
      database: account.database,
      password: 'TestA7' + randomBytes(12).toString('hex'),
      requests: {},
      results: {},
      startedAt: new Date().toISOString(),
    };
    writeFileSync(manifestFile, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  }
  assert.equal(state.database, account.database);
  assert.equal(state.version, 1);
  let checks = 0;
  const save = () => writeFileSync(manifestFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  const tokens = {},
    users = {},
    owners = [];
  async function call(path, who = 'admin', method = 'GET', body, expected = 200) {
    const r = await fetch(target.origin + '/api/v1' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Company-Code': code,
        ...(tokens[who] ? { Authorization: 'Bearer ' + tokens[who] } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const result = await r.json();
    assert.equal(r.status, expected, `${method} ${path}: ${result.message || r.status}`);
    checks++;
    return result.data;
  }
  async function mutate(label, path, who, body, method = 'POST') {
    if (state.results[label]) return state.results[label];
    const prepared = (state.requests[label] ??= {
      path,
      body: {
        requestKey: createHash('sha256')
          .update('test-fixtures-v1:' + label)
          .digest('hex'),
        ...body,
      },
      method,
      who,
    });
    save();
    const result = await call(
      prepared.path,
      prepared.who,
      prepared.method,
      prepared.body,
      method === 'PUT' ? 200 : 201,
    );
    state.results[label] = result;
    save();
    return result;
  }
  const create = (label, kind, data, who = 'admin') => mutate(label, '/workspace/' + kind, who, { data });
  const detail = (kind, row, who = 'admin') => call('/workspace/' + kind + '/' + (row.id ?? row), who);
  const cmd = async (label, kind, row, action, who = 'admin', extra = {}) => {
    const latest = await detail(kind, row, who);
    return mutate(label, `/workspace/${kind}/${latest.id}/${action}`, who, {
      expectedUpdatedAt: latest.updatedAt,
      ...extra,
    });
  };
  const login = async (who) => {
    const result = await call('/auth/login', who, 'POST', {
      tenantCode: code,
      username: who,
      password: who === 'admin' ? config.SEED_ADMIN_PASSWORD : state.password,
    });
    tokens[who] = result.accessToken;
    users[who] = result.user;
    assert.equal(result.user.company.purpose, 'test');
    return result;
  };
  async function approveAll(label, approvalId) {
    for (let round = 0; round < 5; round++) {
      const record = await call('/approvals/' + approvalId);
      if (record.status !== 'pending') {
        assert.equal(record.status, 'approved');
        return;
      }
      let count = 0;
      for (const who of ['manager', 'manager_south', 'boss', 'admin2']) {
        const pending = (await call('/approvals/pending', who)).filter((n) => n.approval.id === approvalId);
        for (const node of pending) {
          await mutate(`${label}-node-${node.nodeId}`, `/approvals/${approvalId}/nodes/${node.nodeId}/approve`, who, {
            comment: '测试数据：核对合同、权限与业务依据后通过',
          });
          count++;
        }
      }
      assert(count, 'Pending approval must have an eligible approver');
    }
    throw Error('Approval progression did not finish');
  }
  try {
    if (state.completedAt)
      return {
        result: 'ALREADY_INITIALIZED',
        company: code,
        counts: state.counts,
        originalChecks: state.checks,
        syntheticOnly: true,
      };
    await login('admin');
    const roles = await call('/system/roles');
    const depts = {};
    for (const [key, name, parent] of [
      ['center', '销售中心', null],
      ['east', '华东销售部', 'center'],
      ['south', '华南销售部', 'center'],
      ['delivery', '项目交付部', null],
    ]) {
      depts[key] = await mutate('dept-' + key, '/system/departments', 'admin', {
        data: { name, code: key.toUpperCase(), parentId: parent ? depts[parent].id : null },
      });
    }
    const definitions = [
      ['admin2', '测试复核管理员', 'super_admin', null],
      ['manager', '测试华东主管', 'sales_manager', 'east'],
      ['manager_south', '测试华南主管', 'sales_manager', 'south'],
      ['sales', '测试销售一号', 'sales', 'east'],
      ['sales02', '测试销售二号', 'sales', 'east'],
      ['sales03', '测试销售三号', 'sales', 'south'],
      ['boss', '测试总经理', 'gm', null],
      ['delivery', '测试交付人员', 'sales', 'delivery'],
    ];
    for (const [username, name, role, department] of definitions) {
      await mutate('user-' + username, '/system/users', 'admin', {
        data: {
          username,
          name,
          password: state.password,
          deptId: department ? depts[department].id : null,
          roleIds: [roles.find((r) => r.code === role).id],
        },
      });
      await login(username);
    }
    for (const [key, who] of [
      ['east', 'manager'],
      ['south', 'manager_south'],
    ]) {
      const current = (await call('/system/departments/tree')).find((d) => d.id === depts[key].id);
      await mutate(
        'dept-leader-' + key,
        '/system/departments/' + current.id,
        'admin',
        { expectedUpdatedAt: current.updatedAt, data: { leaderId: users[who].id } },
        'PUT',
      );
    }
    const flowIds = {};
    for (const [type, name, nodes] of [
      [
        'contract',
        '合同审批：销售主管→老板',
        [
          ['user', users.manager.id, '销售主管核对'],
          ['user', users.boss.id, '老板核准'],
        ],
      ],
      ['order', '订单审批：老板核准', [['user', users.boss.id, '订单核准']]],
      ['project_initiation', '项目立项：独立管理员核对', [['user', users.admin2.id, '立项核对']]],
      ['general', '通用事项：主管与老板会签', [['users_all', users.manager.id + ',' + users.boss.id, '两人会签']]],
    ]) {
      const flow = await mutate('flow-' + type, '/approvals/flows', 'admin', {
        name: '[测试] ' + name,
        bizType: type,
        priority: 100,
        condition: 'always',
        nodes: nodes.map(([approverType, approverValue, name]) => ({
          name,
          approverType,
          approverValue: String(approverValue),
          condition: 'always',
        })),
        fields: [],
      });
      await mutate('publish-' + type, '/approvals/flows/' + flow.id + '/publish', 'admin', {
        expectedUpdatedAt: flow.updatedAt,
      });
      flowIds[type] = flow.id;
    }
    const products = [];
    for (let i = 0; i < 6; i++)
      products.push(
        await create('product-' + i, 'products', {
          code: 'TEST-P-' + i,
          name: '[测试] ' + ['软件订阅', '实施服务', 'AI应用服务', '运维服务', '培训服务', '数据整理'][i],
          unit: '项',
          listPrice: String(1000 + i * 500),
          taxRate: 6,
        }),
      );
    const customers = [];
    for (let i = 0; i < 30; i++) {
      const who = i < 24 ? ['sales', 'sales02', 'sales03'][i % 3] : 'admin';
      owners.push(who);
      const customer = await create(
        'customer-' + i,
        'customers',
        {
          name: `[测试] ${['星河制造', '青禾商贸', '云帆科技', '松林食品', '远山物流', '新辰服务'][i % 6]}${String(i + 1).padStart(2, '0')}有限公司`,
          shortName: '测试客户' + (i + 1),
          creditCode: '91999999' + String(i + 1).padStart(9, '0') + 'A',
          industry: ['制造', '零售', '科技', '食品', '物流', '服务'][i % 6],
          level: i % 4 === 0 ? '重点客户' : '普通客户',
          region: i % 3 === 2 ? '广东' : '上海',
          companyPhone: '021-0000-' + String(4000 + i),
          website: `https://customer-${i}.example.invalid`,
          address: '测试地址，不对应实际经营场所' + (i + 1),
          legalPerson: '测试人员' + (i + 1),
          remark: '纯合成测试资料，不是真实企业或工商登记。',
        },
        who,
      );
      customers.push(customer);
      assert.equal(
        (await detail('customers', customer, 'admin')).ownerId,
        users[i === 21 && state.results['sales-handover'] ? 'sales02' : who].id,
      );
      checks++;
      if (i >= 24) await cmd('return-' + i, 'customers', customer, 'return');
      else {
        await create(
          'contact-' + i,
          'contacts',
          {
            customerId: customer.id,
            name: '测试联系人' + (i + 1),
            title: '测试负责人',
            phone: '0000000' + String(i + 1).padStart(4, '0'),
            email: `contact${i}@example.invalid`,
          },
          who,
        );
        await create(
          'followup-' + i,
          'followups',
          {
            customerId: customer.id,
            content: '测试跟进：已核对需求、预算和下一步，本记录为合成。',
            nextAction: '安排方案沟通',
            nextFollowAt: businessDate(i - 6),
          },
          who,
        );
        const action = await create(
          'action-' + i,
          'actions',
          {
            title: '[测试] ' + ['需求访谈', '报价回访', '合同核对', '催收跟进'][i % 4],
            targetId: customer.id,
            dueDate: businessDate(i - 10),
            content: '仅用于验证待办与权限',
          },
          who,
        );
        if (i % 4 === 0) await cmd('complete-action-' + i, 'actions', action, 'complete', who);
      }
    }
    // Customer allocation is exercised through the same commands as the UI.
    await cmd('public-claim', 'customers', customers[24], 'claim', 'sales');
    await cmd('public-return', 'customers', customers[24], 'return', 'sales');
    await cmd('manager-assignment', 'customers', customers[24], 'assign', 'manager', { userId: users.sales02.id });
    const candidates = await call(`/workspace/customers/${customers[25].id}/assignment-people`, 'manager');
    assert(candidates.some((u) => u.id === users.sales.id) && !candidates.some((u) => u.id === users.sales03.id));
    checks++;
    await call(`/workspace/customers/${customers[2].id}`, 'sales', 'GET', undefined, 404);
    await call(`/workspace/customers/${customers[2].id}`, 'manager', 'GET', undefined, 404);
    await call('/system/users', 'sales', 'GET', undefined, 403);
    await call(
      '/workspace/customers',
      'boss',
      'POST',
      { requestKey: 'test-denied-boss', data: { name: '禁止老板写入的测试' } },
      403,
    );
    const duplicate = await call(
      '/workspace/customers/duplicate-check',
      'sales',
      'POST',
      { creditCode: '91999999000000003A' },
      201,
    );
    assert(duplicate.hardDuplicate && duplicate.restrictedMatch && !duplicate.matches.length);
    checks++;
    await call(
      '/workspace/customers',
      'sales',
      'POST',
      {
        requestKey: 'test-duplicate-license',
        data: { name: '同证照不同名称不得重复', creditCode: '91999999000000003A' },
      },
      409,
    );
    for (let i = 0; i < 12; i++) {
      const who = ['sales', 'sales02', 'sales03'][i % 3];
      const lead = await create(
        'lead-' + i,
        'leads',
        {
          companyName: '[测试] 待转化线索' + (i + 1),
          contactName: '测试线索联系人' + (i + 1),
          source: ['website', 'referral', 'exhibition', 'partner'][i % 4],
          industry: '测试行业',
          demand: '合成线索需求，用于验证来源和转化链路',
        },
        who,
      );
      if (i < 3) await cmd('convert-lead-' + i, 'leads', lead, 'convert', who);
    }
    const opportunities = [],
      contracts = [];
    for (let i = 0; i < 24; i++) {
      const who = owners[i],
        opp = await create(
          'opportunity-' + i,
          'opportunities',
          {
            name: `[测试] 客户${i + 1}销售机会`,
            customerId: customers[i].id,
            amount: String(20000 + i * 3500),
            expectedCloseDate: `${new Date(Date.now() + 8 * 3600000).getUTCFullYear()}-${String((i % 12) + 1).padStart(2, '0')}-20`,
            demandSummary: '测试业务需求：系统建设、数据整理与持续服务',
            nextAction: '核对方案与采购计划',
          },
          who,
        );
      opportunities.push(opp);
      for (let j = 0; j < i % 4; j++) await cmd(`advance-${i}-${j}`, 'opportunities', opp, 'advance', who);
      if (i < 12)
        await cmd('quote-' + i, 'opportunities', opp, 'quote', who, {
          items: [{ productId: products[i % 6].id, quantity: 2, unitPrice: String(10000 + i * 1000) }],
        });
      if (i >= 18 && i < 21)
        await cmd('lose-' + i, 'opportunities', opp, 'lose', who, { reason: '测试输单：预算或时机不匹配' });
      if (i >= 12) continue;
      const latest = await detail('opportunities', opp, who);
      const c = await create(
        'contract-' + i,
        'contracts',
        {
          name: `[测试] 客户${i + 1}服务合同`,
          customerId: customers[i].id,
          opportunityId: opp.id,
          contractType: ['implementation', 'saas_sub', 'ai_fde'][i % 3],
          amount: String(latest.amount),
          taxRate: 6,
          paymentTerms: '测试：三期付款，按明确日期核对，不代表真实交易',
        },
        who,
      );
      contracts.push(c);
      if (i === 11) continue;
      await cmd('submit-contract-' + i, 'contracts', c, 'submit', who);
      if (i === 9) continue;
      if (i === 10) {
        const p = (await call('/approvals/pending', 'manager')).find(
          (n) => n.approval.id === (state.results['submit-contract-' + i]?.approvalId ?? 0),
        );
        const current = await detail('contracts', c, who);
        const pending = (await call('/approvals/pending', 'manager')).find((n) => n.approval.id === current.approvalId);
        assert(pending);
        await mutate(
          'reject-contract-' + i,
          `/approvals/${current.approvalId}/nodes/${pending.nodeId}/reject`,
          'manager',
          { comment: '测试驳回：请补充付款条件依据' },
        );
        continue;
      }
      await approveAll('contract-' + i, (await detail('contracts', c, who)).approvalId);
      if (i === 8) continue;
      const total = new Prisma.Decimal(String(latest.amount)),
        a = total.mul('0.3').toDecimalPlaces(2),
        b = total.mul('0.4').toDecimalPlaces(2);
      const date = businessDate;
      await cmd('sign-contract-' + i, 'contracts', c, 'sign', who, {
        paymentSchedule: [
          { amount: a.toFixed(2), dueDate: date(-120 + i * 25), condition: '测试首期：历史补录条款核对' },
          { amount: b.toFixed(2), dueDate: date(30 + i * 7), condition: '测试阶段交付' },
          { amount: total.sub(a).sub(b).toFixed(2), dueDate: date(100 + i * 7), condition: '测试最终验收' },
        ],
      });
    }
    for (let i = 0; i < 6; i++) {
      const who = owners[i],
        c = contracts[i];
      const order = await cmd('order-' + i, 'contracts', c, 'order', who);
      if (i < 5) {
        await cmd('submit-order-' + i, 'orders', order, 'submit', who);
        if (i < 4) {
          await approveAll('order-' + i, (await detail('orders', order, who)).approvalId);
          await cmd('confirm-order-' + i, 'orders', order, 'confirm', who);
          if (i < 2) await cmd('deliver-order-' + i, 'orders', order, 'deliver', who);
        }
      }
      const p = await cmd('project-' + i, 'contracts', c, 'project', who);
      await cmd('submit-project-' + i, 'projects', p, 'submit', who);
      if (i === 5) continue;
      await approveAll('project-' + i, (await detail('projects', p, who)).approvalId);
      await cmd('start-project-' + i, 'projects', p, 'start', who);
      const projectDetail = await detail('projects', p, who),
        tasks = [];
      for (let j = 0; j < 3; j++) {
        const task = await create(
          `task-${i}-${j}`,
          'tasks',
          {
            title: `[测试] ${['需求确认', '配置实施', '验证培训'][j]}`,
            projectId: p.id,
            milestoneId: projectDetail.related.milestones[j].id,
            dueDate: businessDate((j + 1) * 7),
            description: '合成任务，用于验证执行状态与交付证据',
          },
          who,
        );
        tasks.push(task);
        if (i < 3 || (i === 3 && j < 2)) {
          await cmd(`start-task-${i}-${j}`, 'tasks', task, 'start_task', who, { note: '测试：开始执行并核对任务范围' });
          if (i < 3 || j === 0)
            await cmd(`complete-task-${i}-${j}`, 'tasks', task, 'complete', who, {
              note: '测试证据：步骤已验证，结果符合预期',
              actualHours: String(2 + j) + '.0',
            });
        }
      }
      if (i < 3) {
        for (let j = 0; j < 4; j++)
          await cmd(`milestone-${i}-${j}`, 'projects', p, 'advance', who, { note: '测试里程碑依据已核对' });
        await cmd('request-accept-' + i, 'projects', p, 'request_acceptance', who, {
          note: '测试：交付记录及全部任务完成，请独立复核',
        });
        await cmd('accept-' + i, 'projects', p, i === 2 ? 'reject_acceptance' : 'accept', 'admin2', {
          note: i === 2 ? '测试拒收：补充培训及整改证据' : '测试独立验收：依据齐全',
        });
        if (i === 2)
          await cmd('remediation-task', 'tasks', tasks[0], 'reopen_task', who, {
            note: '测试整改：按拒收意见重新执行',
          });
      }
      if (i < 2) {
        const ticket = await mutate('ticket-' + i, '/service-tickets', who, {
          projectId: p.id,
          title: '[测试] ' + ['配置问题复核', '操作指引补充'][i],
          description: '合成售后问题，验证指派、处理、复核与留痕',
          priority: i ? 'medium' : 'high',
        });
        const ticketCmd = async (label, action, person, extra = {}) => {
          const latest = await call('/service-tickets/' + ticket.id, person);
          return mutate(label, `/service-tickets/${ticket.id}/${action}`, person, {
            expectedUpdatedAt: latest.updatedAt,
            note: '测试工单处理与证据说明',
            ...extra,
          });
        };
        await ticketCmd('assign-ticket-' + i, 'assign', 'admin', { userId: users[who].id });
        await ticketCmd('start-ticket-' + i, 'start', who);
        if (i === 0) {
          await ticketCmd('resolve-ticket', 'resolve', who);
          await ticketCmd('close-ticket', 'close', 'admin2');
        }
      }
    }
    for (let i = 0; i < 8; i++) {
      const plans = await db.paymentPlan.findMany({
          where: { contractId: contracts[i].id },
          orderBy: { dueDate: 'asc' },
        }),
        amount = plans[0].amount;
      const receipt = await mutate('receipt-' + i, '/finance-ledger/receipts', 'admin', {
        customerId: customers[i].id,
        contractId: contracts[i].id,
        amount: amount.toFixed(2),
        receiptDate: businessDate(),
        reference: 'TEST-CASH-' + i,
        note: '合成到账凭据；非真实银行交易',
      });
      if (i < 6) {
        const r = await call('/finance-ledger/receipts/' + receipt.id);
        await mutate('confirm-receipt-' + i, `/finance-ledger/receipts/${r.id}/confirm`, 'admin2', {
          expectedUpdatedAt: r.updatedAt,
          note: '测试独立复核',
        });
        if (i < 4) {
          const current = await call('/finance-ledger/receipts/' + r.id);
          await mutate('allocate-receipt-' + i, `/finance-ledger/receipts/${r.id}/allocate`, 'admin', {
            expectedUpdatedAt: current.updatedAt,
            paymentPlanId: plans[0].id,
            expectedPlanUpdatedAt: plans[0].updatedAt.toISOString(),
            amount: (i % 2 ? amount.mul('0.5') : amount).toFixed(2),
            note: '测试精确核销，余款保持未分配',
          });
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      const a = await mutate('general-' + i, '/approvals', 'sales', {
        flowId: flowIds.general,
        title: '[测试] ' + ['两人会签已完成', '会签等待另一人', '尚未处理的会签'][i],
        form: {},
      });
      if (i === 0) await approveAll('general-' + i, a.id);
      if (i === 1) {
        const p = (await call('/approvals/pending', 'manager')).find((n) => n.approval.id === a.id);
        await mutate('partial-general', `/approvals/${a.id}/nodes/${p.nodeId}/approve`, 'manager', {
          comment: '测试：主管已确认，等待老板意见',
        });
      }
    }
    // Exercise complete sales transfer on a customer with linked business, not only a bare owner field.
    const transfer = await call(
      `/commercial/customers/${customers[21].id}/handover/preview`,
      'manager',
      'POST',
      { userId: users.sales02.id },
      201,
    );
    await mutate('sales-handover', `/commercial/customers/${customers[21].id}/handover`, 'manager', {
      expectedUpdatedAt: transfer.expectedUpdatedAt,
      digest: transfer.digest,
      userId: users.sales02.id,
      reason: '测试销售整体交接：客户、联系人、跟进、商机和行动同步归属',
    });
    await call(`/workspace/customers/${customers[21].id}`, 'sales', 'GET', undefined, 404);
    await call(`/workspace/customers/${customers[21].id}`, 'sales02');
    for (const who of ['admin', 'manager', 'sales', 'boss', 'sales03']) {
      await call('/workspace/overview', who);
      await call('/analytics/forecast', who);
      await call('/analytics/collections', who);
    }
    const counts = {};
    for (const model of [
      'customer',
      'contact',
      'lead',
      'opportunity',
      'contract',
      'order',
      'project',
      'projectTask',
      'paymentPlan',
      'receipt',
      'approval',
      'approvalFlow',
      'serviceTicket',
      'followUp',
      'actionPlan',
      'user',
      'department',
    ])
      counts[model] = await db[model].count();
    state.completedAt = new Date().toISOString();
    state.counts = counts;
    state.checks = checks;
    save();
    writeFileSync(
      join(dir, 'TEST-测试人员账号.txt'),
      `测试帐套（TEST）\n管理员：admin，初始密码见TEST-账号说明.txt。\n下列合成人员共用本机测试口令：${state.password}\n${definitions.map(([u, n]) => u + '：' + n).join('\n')}\n所有业务资料均为合成，不得导入正式公司。\n`,
      { mode: 0o600 },
    );
    return { result: 'PASS', company: code, checks, counts, syntheticOnly: true };
  } finally {
    await db.$disconnect();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(await populateTestCompany({ url: process.env.CRM_LOCAL_URL || 'http://127.0.0.1:3000' })));
