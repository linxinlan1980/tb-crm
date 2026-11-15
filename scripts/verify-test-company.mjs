// Read-only business verification against the explicit TEST company; no resets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const project = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient, Prisma } = require('@prisma/client');
export async function verifyTestCompany({
  dir = join(project, '.local/accounts'),
  url = 'http://127.0.0.1:3000',
  allowMarkedFormalTests = false,
  adminPassword,
} = {}) {
  const registry = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
  const entry = registry.accounts.find((a) => a.code === 'TEST' && a.status === 'ready' && a.purpose === 'test');
  assert(entry, 'Only explicit TEST account can be verified');
  const config = JSON.parse(readFileSync(entry.configFile, 'utf8'));
  assert.equal(config.ACCOUNT_PURPOSE, 'test');
  assert.equal(config.TENANT_CODE, 'TEST');
  const target = new URL(url);
  assert(['127.0.0.1', 'localhost'].includes(target.hostname));
  const manifest = JSON.parse(readFileSync(join(dir, 'TEST-fixtures-v1.json'), 'utf8'));
  assert(manifest.completedAt, 'Fixture setup must complete first');
  const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  let checks = 0;
  const eq = (a, b, label) => {
    assert.deepEqual(a, b, label);
    checks++;
  };
  const tokens = {};
  async function call(path, who = 'admin', body, expected = 200, company = 'TEST') {
    const r = await fetch(target.origin + '/api/v1' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Company-Code': company,
        ...(tokens[who] ? { Authorization: 'Bearer ' + tokens[who] } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    eq(r.status, expected, path);
    return j.data;
  }
  const sum = (rows, field) => rows.reduce((n, r) => n.add(r[field]), new Prisma.Decimal(0)).toFixed(2);
  try {
    for (const who of ['admin', 'manager', 'manager_south', 'sales', 'sales02', 'sales03', 'boss', 'delivery']) {
      const result = await call('/auth/login', who, {
        tenantCode: 'TEST',
        username: who,
        password: who === 'admin' ? (adminPassword ?? config.SEED_ADMIN_PASSWORD) : manifest.password,
      });
      tokens[who] = result.accessToken;
      eq(result.user.company.purpose, 'test', 'explicit test marker');
    }
    const [customers, plans, receipts, allocations, contracts, projects, tasks, allUsers, stages] = await Promise.all([
      db.customer.findMany(),
      db.paymentPlan.findMany(),
      db.receipt.findMany(),
      db.receiptAllocation.findMany({ where: { active: true } }),
      db.contract.findMany(),
      db.project.findMany(),
      db.projectTask.findMany(),
      db.user.findMany(),
      db.opportunityStage.findMany({ where: { isActive: true } }),
    ]);
    eq(customers.length, 33, 'rich customer baseline');
    eq(allUsers.length, 9, 'personnel baseline');
    eq(await db.approvalFlow.count({ where: { isActive: true } }), 4, 'published approval flows');
    for (const plan of plans) {
      eq(
        new Prisma.Decimal(plan.amount).toFixed(2),
        new Prisma.Decimal(plan.receivedAmount).add(plan.outstandingAmount).toFixed(2),
        'plan balance',
      );
      eq(
        sum(
          allocations.filter((a) => a.paymentPlanId === plan.id),
          'amount',
        ),
        plan.receivedAmount.toFixed(2),
        'plan equals active allocations',
      );
    }
    for (const receipt of receipts) {
      eq(
        receipt.amount.toFixed(2),
        receipt.allocatedAmount.add(receipt.unallocatedAmount).toFixed(2),
        'receipt balance',
      );
      eq(
        sum(
          allocations.filter((a) => a.receiptId === receipt.id),
          'amount',
        ),
        receipt.allocatedAmount.toFixed(2),
        'receipt equals active allocations',
      );
    }
    for (const contract of contracts) {
      const own = plans.filter((p) => p.contractId === contract.id);
      if (['signed', 'executing', 'completed'].includes(contract.status))
        eq(sum(own, 'amount'), contract.amount.toFixed(2), 'contract installments sum');
      else eq(own.length, 0, 'unsigned contract has no artificial receivables');
    }
    for (const p of projects.filter((p) => p.status === 'completed')) {
      eq(p.progress, 100, 'accepted project progress');
      eq(p.acceptanceState, 'accepted', 'independent accepted evidence');
      eq(
        tasks.filter((t) => t.projectId === p.id && t.status !== 'done').length,
        0,
        'no unfinished work in completed projects',
      );
    }
    const year = new Date(Date.now() + 8 * 3600000).getUTCFullYear();
    const forecast = await call('/analytics/forecast?personRange=company&year=' + year),
      cash = await call('/analytics/collections?personRange=company&year=' + year),
      overview = await call('/workspace/overview?personRange=company');
    eq(forecast.summary.open, '871500.00', 'open pipeline');
    eq(forecast.summary.weighted, '284100.00', 'exact weighted forecast');
    eq(forecast.summary.won, '216000.00', 'signed won business');
    eq(forecast.summary.lostCount, 3, 'closed lost opportunities');
    eq(cash.summary.received, '45000.00', 'confirmed receipts only');
    eq(cash.summary.currentAllocatedOfReceipts, '20400.00', 'current allocated receipts');
    eq(cash.summary.currentUnallocatedOfReceipts, '24600.00', 'unallocated cash separated');
    eq(cash.summary.currentOutstanding, '195600.00', 'all-term current outstanding');
    eq(cash.summary.currentOverdue, '15600.00', 'Shanghai-day overdue');
    const known = new Set(stages.map((s) => s.code));
    const open = await db.opportunity.findMany({ where: { status: 'open' } });
    eq(
      overview.funnel.reduce((n, r) => n + r.count, 0),
      open.filter((o) => known.has(o.stage)).length,
      'dashboard funnel excludes won/lost',
    );
    eq(
      new Prisma.Decimal(overview.overdue).toFixed(2),
      cash.summary.currentOverdue,
      'dashboard and analytical overdue agree',
    );
    for (const who of ['manager', 'manager_south', 'sales', 'sales02', 'sales03', 'boss', 'delivery']) {
      const user = allUsers.find((u) => u.username === who),
        team = allUsers.filter((u) => u.deptId === user.deptId).map((u) => u.id);
      const expected = customers.filter(
        (c) =>
          who === 'boss' ||
          c.poolType === 'public' ||
          (who.startsWith('manager') ? team.includes(c.ownerId) : c.ownerId === user.id),
      );
      const response = await call('/workspace/customers?pageSize=100', who);
      eq(response.meta.total, expected.length, who + ' customer scope');
      eq(
        response.items.map((r) => r.id).sort((a, b) => a - b),
        expected.map((r) => r.id).sort((a, b) => a - b),
        who + ' visible customer ids',
      );
    }
    const privateSouth = customers.find((c) => c.ownerId === allUsers.find((u) => u.username === 'sales03').id),
      publicCustomer = customers.find((c) => c.poolType === 'public');
    await call('/workspace/customers/' + privateSouth.id, 'manager', undefined, 404);
    await call('/workspace/customers/' + privateSouth.id, 'sales', undefined, 404);
    const southId = allUsers.find((u) => u.username === 'sales03').id;
    await call(
      `/workspace/customers/${publicCustomer.id}/assign`,
      'manager',
      {
        requestKey: 'verify-cross-department-denied',
        expectedUpdatedAt: publicCustomer.updatedAt.toISOString(),
        userId: southId,
      },
      400,
    );
    await call(
      `/workspace/customers/${publicCustomer.id}/assign`,
      'sales',
      {
        requestKey: 'verify-sales-assignment-denied',
        expectedUpdatedAt: publicCustomer.updatedAt.toISOString(),
        userId: southId,
      },
      403,
    );
    await call(
      '/workspace/customers',
      'boss',
      { requestKey: 'verify-boss-write-denied', data: { name: 'Must never be created' } },
      403,
    );
    const restricted = await call(
      '/workspace/customers/duplicate-check',
      'sales',
      { creditCode: privateSouth.creditCode },
      201,
    );
    eq(restricted.matches, [], 'restricted identity details hidden');
    eq(restricted.restrictedMatch, true, 'restricted duplicate warning');
    const formalEntry = registry.accounts.find((a) => a.code === 'TINGMENG' && a.status === 'ready');
    let formalBusinessEmpty;
    let formalOnlyMarkedTests;
    if (formalEntry) {
      const formalConfig = JSON.parse(readFileSync(formalEntry.configFile, 'utf8'));
      const formal = new PrismaClient({ datasourceUrl: formalConfig.DATABASE_URL });
      try {
        for (const model of [
          'customer',
          'contact',
          'lead',
          'followUp',
          'actionPlan',
          'opportunity',
          'contract',
          'order',
          'project',
          'projectTask',
          'paymentPlan',
          'receipt',
          'invoice',
          'approval',
          'approvalFlow',
          'serviceTicket',
        ]) {
          if (allowMarkedFormalTests && ['approval', 'approvalFlow'].includes(model)) continue;
          eq(await formal[model].count(), 0, 'formal account remains empty: ' + model);
        }
        if (allowMarkedFormalTests) {
          eq(await formal.approval.count({ where: { OR: [
            { title: { not: { startsWith: '【测试】' } } }, { bizType: { not: 'general' } },
            { status: { notIn: ['approved', 'rejected', 'withdrawn'] } },
          ] } }), 0, 'formal approvals only completed marked tests');
          eq(await formal.approvalFlow.count({ where: { OR: [
            { name: { not: { startsWith: '【测试】' } } }, { isActive: true },
          ] } }), 0, 'formal flows only inactive marked tests');
          eq(await formal.calendarEntry.count({ where: { OR: [
            { title: { not: { startsWith: '【测试】' } } }, { status: { not: 'cancelled' } },
          ] } }), 0, 'formal calendars only cancelled marked tests');
          eq(await formal.activitySyncJob.count({ where: { status: { in: ['prepared', 'dispatching', 'uncertain'] } } }), 0, 'formal test outbox settled');
          eq(await formal.activitySyncSetting.count({ where: { OR: [
            { calendarEnabled: true }, { todoEnabled: true }, { autoEnabled: true },
          ] } }), 0, 'formal sync consent disabled after testing');
          formalBusinessEmpty = false;
          formalOnlyMarkedTests = true;
        } else formalBusinessEmpty = true;
        await assert.rejects(db.$queryRawUnsafe('SELECT COUNT(*) FROM `' + formalEntry.database + '`.customers'));
        checks++;
        await assert.rejects(formal.$queryRawUnsafe('SELECT COUNT(*) FROM `' + entry.database + '`.customers'));
        checks++;
        await call('/workspace/overview', 'admin', undefined, 401, 'TINGMENG');
      } finally {
        await formal.$disconnect();
      }
    }
    return {
      result: 'PASS',
      checks,
      financialBalances: true,
      recordScopes: true,
      creatorAndAssignment: true,
      approvalAndDeliveryStates: true,
      formalBusinessEmpty: formalBusinessEmpty ?? 'no formal account in isolated CI fixture',
      ...(formalOnlyMarkedTests ? { formalOnlyMarkedTests } : {}),
      golden: {
        pipeline: '871500.00',
        weighted: '284100.00',
        confirmedReceipts: '45000.00',
        outstanding: '195600.00',
        overdue: '15600.00',
      },
    };
  } finally {
    await db.$disconnect();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(await verifyTestCompany({ url: process.env.CRM_LOCAL_URL || 'http://127.0.0.1:3000', allowMarkedFormalTests: process.env.ALLOW_MARKED_FORMAL_TESTS === 'true' })));
