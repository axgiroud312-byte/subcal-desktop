import { _electron } from 'playwright-core';
import electron from 'electron';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Run against freshly built Electron entries; use an isolated, initially empty real database.
const evidenceArg = process.argv.indexOf('--evidence');
const evidence = path.resolve(evidenceArg >= 0 ? process.argv[evidenceArg + 1] : 'docs/evidence/BE-012-regression');
const temp = path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode');
const profile = await fs.mkdtemp(path.join(temp, 'subcal-real-check-'));
await fs.mkdir(evidence, { recursive: true });
const server = await createServer({ cacheDir: path.join(profile, 'vite-cache'), server: { port: 0, strictPort: false, hmr: false } });
await server.listen();
const env = { ...process.env, SUBCAL_USER_DATA: profile, SUBCAL_DEV_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SUBCAL_PREVIEW;
const checks = [], errors = [];
let app, page;
async function launch() {
  app = await _electron.launch({ executablePath: electron, args: ['.'], env });
  page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().waitFor({ timeout: 30000 });
}
async function state() { return page.evaluate(async () => (await import('/src/renderer/service/client.ts')).client.snapshot()); }
async function nav(name) { await page.getByRole('button', { name, exact: true }).first().click(); }
async function closeModal() { await page.locator('[role="dialog"]:visible').last().locator('.modal-close').click(); }
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function assertClean() { assert.doesNotMatch(await page.locator('body').innerText(), /组件示例|前端预览|Mira|shadcn/); }
async function shot(file) { await page.screenshot({ path: path.join(evidence, file), animations: 'disabled' }); }
try {
  await launch();
  await check('真实 IPC、空 SQLite 与桌面隔离', async () => {
    const s = await state(); assert.equal(s.subscriptions.length, 0); assert.equal(s.connections.length, 0);
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true); assert.equal(prefs.nodeIntegration, false);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(async () => { try { await window.subcal.openExternal('javascript:alert(1)'); return false; } catch { return true; } }), true);
    await assertClean(); await shot('overview-empty.png');
  });
  await check('真实窗口创建手动订阅', async () => {
    await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
    await shot('add-service.png');
    await page.getByRole('button', { name: '手动记录其他订阅', exact: true }).click();
    assert.doesNotMatch(await page.locator('[role="dialog"]').innerText(), /指标名称|数据可用性状态|unfetched|绑定自动采集连接/);
    await page.locator('#sub-product').fill('本地持久化验证');
    await page.locator('#sub-price').fill('12.50');
    await page.locator('#sub-renewal-date').fill('2026-11-25');
    await page.getByRole('button', { name: '保存手动记录', exact: true }).click();
    await page.getByRole('button', { name: '编辑记录', exact: true }).waitFor();
    const s = await state(); assert.equal(s.subscriptions.length, 1); assert.equal(s.subscriptions[0].price.value, '12.50');
    assert.notEqual(s.subscriptions[0].price.dataOrigin, 'demo');
    await assertClean(); await shot('detail.png'); await closeModal();
  });
  await check('版本冲突、删除撤销、导入导出与偏好', async () => {
    const result = await page.evaluate(async () => {
      const { client } = await import('/src/renderer/service/client.ts');
      const s = (await client.snapshot()).subscriptions[0];
      await client.update(s.id, s.revision, { notes: '持久化与冲突检查' });
      let conflict = false;
      try { await client.update(s.id, s.revision, { notes: '不应覆盖' }); } catch { conflict = true; }
      const token = await client.remove(s.id, false); await client.undo(token);
      await client.setPreferences({ theme: 'dark', density: 'compact', order: [s.id] });
      const backup = await client.exportData(); const preview = await client.importPreview(backup);
      await client.importCommit(preview.id, backup);
      return { conflict, snapshot: await client.snapshot(), backup };
    });
    assert.equal(result.conflict, true); assert.equal(result.snapshot.subscriptions[0].notes, '持久化与冲突检查');
    assert.equal(result.snapshot.preferences.theme, 'dark');
    assert.doesNotMatch(result.backup, /"secret"\s*:|"apiKey"\s*:|"access_token"\s*:/);
  });
  await check('系统加密凭据、IPC拒绝无效输入、备份无秘密', async () => {
    const secret = `subcal-security-check-${crypto.randomUUID()}`;
    const result = await page.evaluate(async secret => {
      const { client } = await import('/src/renderer/service/client.ts');
      const auth = await client.beginAuth('deepseek-balance');
      const saved = await client.saveCredential(auth.connectionId, secret);
      const snapshot = JSON.stringify(await client.snapshot());
      const backup = await client.exportData(); const diagnosis = await client.diagnose();
      let invalidRejected = false;
      try {
        const reply = await window.subcal.invoke({ version: 999, requestId: 'invalid', method: 'subscriptions.snapshot', params: {} });
        invalidRejected = !reply.ok;
      } catch { invalidRejected = true; }
      return { connectionId: auth.connectionId, saved, snapshot, backup, diagnosis, invalidRejected };
    }, secret);
    assert.equal(result.invalidRejected, true);
    for (const value of [result.snapshot, result.backup, result.diagnosis, JSON.stringify(result.saved)]) assert.equal(value.includes(secret), false);
    const files = await fs.readdir(profile, { recursive: true, withFileTypes: true });
    for (const item of files) {
      if (!item.isFile() || !/\.(?:db|sqlite|json|log)(?:-wal|-shm)?$/.test(item.name)) continue;
      assert.equal((await fs.readFile(path.join(item.parentPath, item.name))).includes(Buffer.from(secret)), false, `secret leaked to ${item.name}`);
    }
    await page.evaluate(async id => { const { client } = await import('/src/renderer/service/client.ts'); await client.disconnect(id, true); }, result.connectionId);
  });
  await check('四页、连接步骤、设置与最小窗口', async () => {
    for (const [width, height] of [[1280, 820], [960, 640]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      for (const name of ['仪表盘', '订阅管理', '订阅日历', '账号管理']) {
        await nav(name); await assertClean();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} overflow`);
        await shot(`${name}-${width}.png`);
      }
    }
    await page.getByRole('button', { name: '添加账号', exact: true }).first().click();
    await assertClean();
    await page.getByRole('combobox', { name: '选择服务', exact: true }).click();
    await page.getByRole('option', { name: 'DeepSeek API', exact: true }).click();
    assert.equal(await page.locator('#account-key').getAttribute('type'), 'password');
    assert.equal(await page.locator('form').getByRole('button', { name: '加入', exact: true }).isDisabled(), true);
    await shot('connection-auth.png');
    await page.getByRole('combobox', { name: '选择服务', exact: true }).click();
    await page.getByRole('option', { name: '中转站余额 / Key 预算', exact: true }).click();
    await page.getByLabel('确认远端 HTTPS 站点').fill('https://panel.example.test');
    await page.getByRole('combobox', { name: '站点面板类型', exact: true }).click();
    await page.getByRole('option', { name: 'New API · 账号余额', exact: true }).click();
    assert.equal(await page.getByLabel('面板用户 ID').getAttribute('required'), '');
    await shot('relay-auth.png');
    await page.getByRole('combobox', { name: '选择服务', exact: true }).click();
    await page.getByRole('option', { name: '腾讯企业套餐广州', exact: true }).click();
    assert.equal(await page.getByLabel('团队 ID（可选）').getAttribute('required'), null);
    await shot('tencent-auth.png'); await closeModal();
    await nav('订阅管理');
    await page.getByRole('searchbox', { name: '搜索订阅' }).fill('本地持久化验证');
    await page.waitForTimeout(200);
    await shot('subscriptions-search.png');
    await page.getByRole('searchbox', { name: '搜索订阅' }).fill('');
    await page.locator('.sc-sidebar').getByRole('button', { name: '偏好设置', exact: true }).click();
    await assertClean(); await shot('settings.png');
    await page.getByRole('checkbox', { name: '减少动效' }).check();
    await page.getByRole('button', { name: '保存设置', exact: true }).first().click();
    await page.waitForTimeout(300);
  });
  await check('完整退出后重新打开仍有记录与偏好', async () => {
    await app.close(); app = null; await launch();
    const s = await state(); assert.equal(s.subscriptions.length, 1); assert.equal(s.subscriptions[0].notes, '持久化与冲突检查');
    assert.equal(s.preferences.theme, 'dark'); await assertClean();
  });
  assert.deepEqual(errors, []);
} finally {
  await app?.close(); await server.close();
  await fs.writeFile(path.join(evidence, 'desktop-report.json'), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, checks, errors, profile, userAcceptance: 'pending', limitations: ['未使用真实账号查询供应商', 'macOS 未实测', '通知到达与休眠恢复需实机人工核对'] }, null, 2));
  if (checks.length === 6 && errors.length === 0) await fs.rm(profile, { recursive: true, force: true });
}
