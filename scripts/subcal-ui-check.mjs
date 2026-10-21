import { buildElectron } from './build-electron.mjs';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real Windows Electron verification for the green workbench and ledger.
const evidenceArg = process.argv.indexOf('--evidence');
const evidence = path.resolve(evidenceArg >= 0 ? process.argv[evidenceArg + 1] : 'docs/evidence/subcal-ui');
const temp = path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode');
await fs.mkdir(evidence, { recursive: true });
await buildElectron();
const profile = await fs.mkdtemp(path.join(temp, 'subcal-ui-check-'));
const server = await createServer({ cacheDir: path.join(profile, 'vite-cache'), server: { port: 0, strictPort: false, hmr: false } });
await server.listen();
const env = { ...process.env, SUBCAL_USER_DATA: profile, SUBCAL_DEV_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SUBCAL_PREVIEW;

const checks = [];
const errors = [];
const screenshots = [];
let app;
let page;

async function launch() {
  app = await _electron.launch({ executablePath: electron, args: ['.'], env });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().waitFor({ timeout: 30000 });
}
async function state() {
  return page.evaluate(async () => (await import('/src/renderer/service/client.ts')).client.snapshot());
}
async function nav(label) {
  await page.locator('.sc-sidebar').getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
  await page.waitForTimeout(220);
}
async function shot(name) {
  const file = path.join(evidence, name);
  await page.screenshot({ path: file, animations: 'disabled' });
  screenshots.push(name);
}
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}
function day(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const today = day(0);
const renewal = day(4);
const nextRenewal = day(35);
const prevMonth = today.slice(0, 7) === '2026-01' ? '2025-12' : `${today.slice(0, 4)}-${String(Number(today.slice(5, 7)) - 1).padStart(2, '0')}`;

try {
  await launch();

  await check('空库默认仪表盘，七入口可达且无演示账单', async () => {
    const s = await state();
    assert.equal(s.subscriptions.length, 0);
    assert.equal(s.payments.length, 0);
    assert.match(await page.locator('.sc-crumbs').innerText(), /仪表盘/);
    for (const label of ['仪表盘', '订阅管理', '消费管理', '订阅日历', '账号管理', '偏好设置', '产品首页']) {
      await nav(label);
      assert.match(await page.locator('.sc-crumbs').innerText(), new RegExp(label.replace('订阅', '订阅')));
    }
    await nav('仪表盘');
    await shot('01-dashboard-empty.png');
  });

  await check('手动添加订阅并保留 Magpie 表格展示', async () => {
    await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
    await page.getByRole('button', { name: '手动记录其他订阅', exact: true }).click();
    await page.locator('#sub-product').fill('Claude Pro');
    await page.locator('#sub-price').fill('20.00');
    await page.locator('#sub-renewal-date').fill(renewal);
    await page.getByRole('button', { name: '保存手动记录', exact: true }).click();
    await page.getByRole('button', { name: '编辑记录', exact: true }).waitFor();
    const s = await state();
    assert.equal(s.subscriptions.length, 1);
    assert.equal(s.subscriptions[0].price.value, '20.00');
    assert.equal(s.subscriptions[0].renewalDate.value, renewal);
    await shot('02-detail-magpie.png');
    await page.keyboard.press('Escape');
    await page.getByLabel('统计币种').selectOption('USD');
    await page.waitForTimeout(300);
  });

  await check('记录付款并顺延一期：金额、计划关联与下一期正确', async () => {
    const before = await state();
    assert.equal(before.subscriptions[0].renewalDate.value, renewal);
    // The dashboard quick action carries the planned occurrence date.
    await page.getByRole('button', { name: '记录付款', exact: true }).last().click();
    await page.getByLabel('关联订阅（可选）').selectOption({ index: 1 });
    await page.getByLabel('实付金额').fill('18.00');
    await page.getByLabel('实际支付日').fill(today);
    await page.getByLabel(/记录后顺延一期/).check();
    await page.getByRole('button', { name: '记录并顺延', exact: true }).click();
    await page.waitForTimeout(900);
    const s = await state();
    assert.equal(s.payments.length, 1);
    assert.equal(s.payments[0].amount, '18.00');
    assert.equal(s.payments[0].planDate, renewal);
    assert.ok(s.payments[0].planOccurrenceId);
    assert.equal(s.subscriptions[0].renewalDate.value, nextRenewal);
    assert.equal(s.subscriptions[0].anchorDate, renewal);
    assert.match(await page.locator('.sc-page:not([hidden])').innerText(), /18\.00/);
    await shot('03-dashboard-payment.png');
  });

  await check('补付、幂等键与版本冲突：一笔请求只落一笔', async () => {
    const result = await page.evaluate(async ({ today }) => {
      const { client } = await import('/src/renderer/service/client.ts');
      const s = await client.snapshot();
      const sub = s.subscriptions[0];
      const key = `idem-${crypto.randomUUID()}`;
      const base = {
        subscriptionId: sub.id, billingGroupId: sub.billingGroupId || sub.id, name: sub.product,
        category: sub.category || '其他', amount: '2.00', currency: sub.currency, paidOn: today,
        planDate: null, planOccurrenceId: null, note: '补付', source: 'manual',
      };
      const a = await client.createPayment(base, key, false);
      const b = await client.createPayment(base, key, false);
      const after = await client.snapshot();
      let conflict = false;
      try { await client.updatePayment(a, 99, { amount: '3.00' }); } catch (e) { conflict = e.code === 'REVISION_CONFLICT'; }
      await client.updatePayment(a, 1, { amount: '2.50' });
      return { same: a === b, count: after.payments.length, conflict, amount: (await client.snapshot()).payments.find((p) => p.id === a)?.amount };
    }, { today });
    assert.equal(result.same, true);
    assert.equal(result.count, 2);
    assert.equal(result.conflict, true);
    assert.equal(result.amount, '2.50');
    const s = await state();
    assert.equal(s.payments.reduce((sum, p) => sum + Number(p.amount), 0), 20.5);
  });

  await check('消费页与仪表盘同一账本，编辑/删除/撤销同步', async () => {
    await nav('消费管理');
    const panel = page.locator('.sc-page:not([hidden])');
    assert.match(await panel.innerText(), /18\.00/);
    assert.match(await panel.innerText(), /2\.50/);
    await shot('04-expenses.png');

    const before = await state();
    const target = before.payments.find((p) => p.amount === '2.50');
    await page.getByRole('button', { name: `编辑 ${target.name} 的付款` }).first().click();
    await page.getByLabel('实付金额').fill('2.75');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal((await state()).payments.find((p) => p.id === target.id)?.amount, '2.75');

    await page.getByRole('button', { name: `删除 ${target.name} 的付款` }).first().click();
    await page.waitForTimeout(500);
    assert.equal((await state()).payments.some((p) => p.id === target.id), false);
    await page.getByRole('button', { name: '撤销删除' }).click();
    await page.waitForTimeout(700);
    assert.equal((await state()).payments.some((p) => p.id === target.id && p.amount === '2.75'), true);
    await shot('05-expenses-after-undo.png');
  });

  await check('日历标记付款、季度周期与月末锚点', async () => {
    await nav('订阅日历');
    const panel = page.locator('.sc-page:not([hidden])');
    const dayCell = page.locator(`.cal-cell[data-date="${renewal}"]`);
    if (await dayCell.count()) {
      await dayCell.click();
      await page.waitForTimeout(400);
      assert.match(await panel.innerText(), /已记录 1 笔付款/);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    await shot('06-calendar.png');
    const quarter = await page.evaluate(async () => {
      const { anchoredDate } = await import('/src/shared/rules');
      return { q: [0, 1, 2].map((i) => anchoredDate('2027-01-31', 'quarterly', i)), monthEnd: [0, 1, 2].map((i) => anchoredDate('2027-01-31', 'monthly', i)) };
    });
    assert.deepEqual(quarter.q, ['2027-01-31', '2027-04-30', '2027-07-31']);
    assert.deepEqual(quarter.monthEnd, ['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  await check('分币种独立统计，未知不会变成零', async () => {
    const result = await page.evaluate(async ({ today, prevMonth }) => {
      const { client } = await import('/src/renderer/service/client.ts');
      const s = await client.snapshot();
      await client.createPayment({
        subscriptionId: null, billingGroupId: null, name: '独立人民币支出', category: '其他',
        amount: '100.00', currency: 'CNY', paidOn: today, planDate: null, planOccurrenceId: null,
        note: '', source: 'manual',
      }, crypto.randomUUID(), false);
      const after = await client.snapshot();
      await client.setPreferences({ statisticsCurrency: 'CNY', monthlyBudgets: { CNY: '0', USD: '50' } });
      return {
        usd: after.payments.filter((p) => p.currency === 'USD').length,
        cny: after.payments.filter((p) => p.currency === 'CNY').length,
        budgets: (await client.snapshot()).preferences.monthlyBudgets,
        prevMonth,
      };
    }, { today, prevMonth });
    assert.equal(result.usd, 2);
    assert.equal(result.cny, 1);
    assert.equal(result.budgets.CNY, '0');
    assert.equal(result.budgets.USD, '50');
    await page.waitForTimeout(400);
    await nav('消费管理');
    const panel = page.locator('.sc-page:not([hidden])');
    assert.match(await panel.innerText(), /100\.00/);
    assert.doesNotMatch(await panel.innerText(), /18\.00 USD/);
    await shot('07-expenses-cny-budget.png');
  });

  await check('预算在设置页保存、跨页生效并重启保留', async () => {
    await nav('偏好设置');
    await page.getByRole('button', { name: '工作区与统计', exact: true }).click();
    await page.getByLabel('USD 每月预算').fill('60');
    await page.getByRole('button', { name: '保存设置', exact: true }).first().click();
    await page.waitForTimeout(600);
    const prefs = (await state()).preferences;
    assert.equal(prefs.monthlyBudgets.USD, '60');
    assert.equal(prefs.monthlyBudgets.CNY, '0');
    await shot('08-settings.png');
  });

  await check('搜索、页面状态与滚动位置保留', async () => {
    await nav('仪表盘');
    const dashboard = page.locator('.sc-page:not([hidden])');
    await dashboard.evaluate((el) => { el.scrollTop = 260; });
    const dashboardScroll = await dashboard.evaluate((el) => el.scrollTop);
    assert.ok(dashboardScroll > 0, '仪表盘应可滚动');

    await nav('订阅管理');
    const subSearch = page.getByRole('searchbox', { name: '搜索订阅' });
    await subSearch.fill('Claude');
    await page.keyboard.press('Control+k');
    const search = page.getByRole('dialog');
    await search.getByRole('textbox', { name: '搜索', exact: true }).fill('Claude');
    await search.getByRole('option').first().click();
    await page.getByRole('button', { name: '编辑记录', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await nav('仪表盘');
    assert.equal(await dashboard.evaluate((el) => el.scrollTop), dashboardScroll);
    await nav('订阅管理');
    assert.equal(await subSearch.inputValue(), 'Claude');
    await subSearch.fill('');
    await page.getByRole('button', { name: '卡片', exact: true }).click();
    assert.ok(await page.locator('.sc-page:not([hidden]) .sub-card').first().isVisible(), '卡片视图仍可到达');
    await nav('仪表盘');
    await nav('订阅管理');
    assert.ok(await page.locator('.sc-page:not([hidden]) .sub-card').first().isVisible(), '视图选择在切页后保留');
    const cardMetrics = await page.locator('.sc-page:not([hidden]) .sub-card').first().evaluate((el) => {
      const style = getComputedStyle(el);
      return { padding: style.paddingTop, radius: style.borderRadius, font: style.fontFamily };
    });
    assert.equal(cardMetrics.padding, '12px');
    assert.equal(cardMetrics.radius, '10px');
    assert.doesNotMatch(cardMetrics.font, /Nunito/);
    await shot('09b-subscription-cards.png');
    const secondId = await page.evaluate(async ({ renewalDate }) => {
      const { client } = await import('/src/renderer/service/client.ts');
      const source = (await client.snapshot()).subscriptions[0];
      const { id, revision, history, ...rest } = source;
      return client.create({
        ...rest,
        product: 'Kimi Code',
        brand: 'Kimi',
        price: { ...source.price, value: '49.00' },
        currency: 'CNY',
        category: '其他',
        renewalDate: { ...source.renewalDate, value: renewalDate },
        anchorDate: renewalDate,
      }, crypto.randomUUID());
    }, { renewalDate: day(10) });
    await page.waitForTimeout(600);
    const visibleCards = page.locator('.sc-page:not([hidden]) .sub-card');
    assert.equal(await visibleCards.count(), 2, '加入第二项后卡片视图完整');
    await page.locator('.sc-page:not([hidden]) .sub-card-title-btn').first().focus();
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForTimeout(600);
    const order = (await state()).preferences.order;
    const rendered = await visibleCards.evaluateAll((els) => els.map((el) => el.getAttribute('data-card-id')));
    assert.equal(rendered[0], order[0], 'Alt+方向键排序写入 preferences.order 并立即反映');
    await page.evaluate(async (id) => {
      const { client } = await import('/src/renderer/service/client.ts');
      await client.remove(id, false);
    }, secondId);
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.sc-page:not([hidden]) .sub-card').count(), 1);
    await page.getByRole('button', { name: '表格', exact: true }).click();
    await shot('09-search-state.png');
  });

  await check('主题切换、system 解析与订阅展示隔离', async () => {
    await page.getByRole('button', { name: '切换深浅色主题' }).click();
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
    const colors = await page.evaluate(() => {
      const shell = getComputedStyle(document.querySelector('.sc-shell'));
      return { bg: shell.getPropertyValue('--background').trim(), font: shell.getPropertyValue('--font-sans').trim() };
    });
    assert.equal(colors.bg, '#131f24');
    assert.match(colors.font, /SubCal Nunito/);
    await nav('仪表盘');
    await shot('10-dashboard-dark.png');
    const magpie = await page.locator('.sub-card').first().evaluate((el) => {
      const card = getComputedStyle(el);
      const grid = el.parentElement ? getComputedStyle(el.parentElement) : null;
      return {
        background: card.backgroundColor,
        padding: card.paddingTop,
        radius: card.borderRadius,
        gap: card.rowGap,
        font: card.fontFamily,
        gridGap: grid?.gap ?? '',
        gridColumns: grid?.gridTemplateColumns ?? '',
        minWidth: grid?.getPropertyValue('--card-min-width') ?? '',
      };
    });
    assert.equal(magpie.padding, '12px', '订阅卡片内边距保持 12px');
    assert.equal(magpie.radius, '10px', '订阅卡片圆角保持 10px');
    assert.equal(magpie.gap, '8px', '订阅卡片内容间距保持 8px');
    assert.equal(magpie.gridGap, '8px', '订阅网格间距保持 8px');
    assert.match(magpie.minWidth.trim(), /^16\.25rem$/, '订阅网格最小列宽保持 260px');
    assert.equal(magpie.gridColumns.split(' ').every((size) => Number.parseFloat(size) >= 260), true, '实际列宽不小于 260px');
    assert.doesNotMatch(magpie.font, /Nunito/, '旧订阅展示不继承新页面 Nunito');
    assert.equal(magpie.background, 'rgb(34, 34, 38)', '深色下沿用旧订阅卡片底色');
  });

  await check('960×640 七页无整页横向溢出', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
    await page.waitForTimeout(400);
    for (const label of ['仪表盘', '订阅管理', '消费管理', '订阅日历', '账号管理', '偏好设置', '产品首页']) {
      await nav(label);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} overflow`);
      await shot(`11-${label}-960.png`);
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820));
    await page.waitForTimeout(300);
  });

  await check('删除订阅保留历史付款；备份包含账本且不含凭据', async () => {
    const result = await page.evaluate(async () => {
      const { client } = await import('/src/renderer/service/client.ts');
      const s = await client.snapshot();
      const sub = s.subscriptions[0];
      const token = await client.remove(sub.id, false);
      const afterRemove = await client.snapshot();
      await client.undo(token);
      const backup = await client.exportData();
      const parsed = JSON.parse(backup);
      const preview = await client.importPreview(backup);
      await client.importCommit(preview.id, backup);
      const restored = await client.snapshot();
      const legacy = JSON.stringify({ schemaVersion: 2, format: 'subcal-backup', subscriptions: s.subscriptions, preferences: s.preferences });
      const legacyPreview = await client.importPreview(legacy);
      await client.importCommit(legacyPreview.id, legacy);
      const afterLegacy = await client.snapshot();
      // Restore the current v3 backup so later checks keep the ledger.
      const again = await client.importPreview(backup);
      await client.importCommit(again.id, backup);
      return {
        kept: afterRemove.payments.length,
        subscriptions: afterRemove.subscriptions.length,
        schemaVersion: parsed.schemaVersion,
        payments: parsed.payments.length,
        previewPayments: preview.paymentCount,
        restored: restored.payments.length,
        legacyPayments: legacyPreview.paymentCount,
        legacyRemoved: legacyPreview.removedPayments,
        afterLegacy: afterLegacy.payments.length,
        finalPayments: (await client.snapshot()).payments.length,
        credentials: /"secret"\s*:|"apiKey"\s*:|"access_token"\s*:/.test(backup),
      };
    });
    assert.equal(result.kept, 3);
    assert.equal(result.subscriptions, 0);
    assert.equal(result.schemaVersion, 3);
    assert.equal(result.payments, 3);
    assert.equal(result.previewPayments, 3);
    assert.equal(result.restored, 3);
    assert.equal(result.legacyPayments, 0);
    assert.equal(result.legacyRemoved, 3);
    assert.equal(result.afterLegacy, 0);
    assert.equal(result.finalPayments, 3);
    assert.equal(result.credentials, false);
    assert.equal((await state()).subscriptions.length, 1);
  });

  await check('真实重启后订阅、付款、预算与主题仍在', async () => {
    await app.close();
    app = null;
    await launch();
    const s = await state();
    assert.equal(s.subscriptions.length, 1);
    assert.equal(s.payments.length, 3);
    assert.equal(s.preferences.monthlyBudgets.USD, '60');
    assert.equal(s.preferences.theme, 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await shot('12-restart.png');
  });

  await check('账号页与添加账号入口显示真实空态与流程', async () => {
    await nav('账号管理');
    const panel = page.locator('.sc-page:not([hidden])');
    assert.match(await panel.innerText(), /尚未添加账号|未连接/);
    await page.getByRole('button', { name: '添加账号', exact: true }).first().click();
    await page.getByRole('combobox', { name: '选择服务', exact: true }).click();
    await page.getByRole('option', { name: 'DeepSeek API', exact: true }).click();
    assert.equal(await page.locator('#account-key').getAttribute('type'), 'password');
    await shot('13-accounts.png');
    await page.keyboard.press('Escape');
  });

  assert.deepEqual(errors, []);
  console.log(`\n${checks.length} checks passed`);
} catch (error) {
  console.error('FAILED:', error);
  await shot('99-failure.png').catch(() => {});
  console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  await app?.close();
  await server.close();
  await fs.writeFile(
    path.join(evidence, 'desktop-report.json'),
    JSON.stringify({
      at: new Date().toISOString(),
      platform: process.platform,
      electron: '44.7.0',
      checks,
      screenshots,
      pageErrors: errors,
      profile,
      userAcceptance: 'pending',
      limitations: [
        '未使用真实供应商账号验证本轮页面（仅检查账号流程入口）',
        '外部 Google / iCloud / EventKit 日历仍未接通',
        '系统通知“已提交”与实际送达需人工核对',
        'system 主题随系统变化的视觉检查受当前 Windows 主题限制',
      ],
    }, null, 2),
  );
  if (errors.length === 0 && process.exitCode !== 1) await fs.rm(profile, { recursive: true, force: true });
}
