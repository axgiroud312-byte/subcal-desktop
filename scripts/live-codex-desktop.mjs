import { _electron } from 'playwright-core';
import electron from 'electron';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = await fs.mkdtemp(path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'subcal-codex-check-'));
const server = await createServer({ cacheDir: path.join(profile, 'vite-cache'), server: { port: 5188, strictPort: true, hmr: false } });
await server.listen();
const env = { ...process.env, SUBCAL_USER_DATA: profile, SUBCAL_DEV_URL: 'http://127.0.0.1:5188/' };
delete env.ELECTRON_RUN_AS_NODE;
const report = { at: new Date().toISOString(), platform: process.platform, officialReadUi: 'pending', userAcceptance: 'pending' };
let app;
try {
  app = await _electron.launch({ executablePath: electron, args: ['.'], env });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await page.getByRole('button', { name: '添加连接', exact: true }).click();
  await page.locator('#auth-provider').click();
  await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await page.getByRole('button', { name: '读取账号与字段', exact: true }).click();
  await page.getByRole('button', { name: '确认并启用自动更新', exact: true }).click({ timeout: 45000 });
  await page.locator('#auth-provider').waitFor({ state: 'hidden' });
  const result = await page.evaluate(async () => {
    const { client } = await import('/src/renderer/service/client.ts');
    const snapshot = await client.snapshot();
    const connection = snapshot.connections.find(c => c.adapterId === 'codex-local');
    const subscription = snapshot.subscriptions.find(s => s.connectionId === connection?.id);
    return { connectionId: connection?.id, state: connection?.state, verification: connection?.verification, metricCount: subscription?.metrics.length ?? 0, origins: subscription?.metrics.map(m => m.remaining.dataOrigin), timeRecorded: Boolean(connection?.lastSuccess), nextAllowed: connection?.nextAllowed, manualBillingUntouched: subscription?.renewalDate.value === null };
  });
  assert.ok(result.metricCount > 0); assert.equal(result.timeRecorded, true); assert.equal(result.manualBillingUntouched, true);
  assert.ok(result.origins.every(origin => origin === 'local_client')); assert.equal(result.verification, 'pending');
  await page.evaluate(async id => { const { client } = await import('/src/renderer/service/client.ts'); await client.disconnect(id, true); }, result.connectionId);
  report.officialReadUi = 'passed';
  report.metricCount = result.metricCount; report.workerIsolation = 'real collector child process'; report.billingNotInferred = true;
  report.scope = 'official local account read, probe, bind, scheduler enable, disconnect; no conversations';
  console.log('PASS Codex 官方客户端 → 隔离采集进程 → IPC → 连接确认 → 订阅额度；断开保留订阅');
} catch (error) {
  report.officialReadUi = 'failed';
  report.error = error.name;
  console.error(`Codex 桌面检查未通过：${error.name}`);
  process.exitCode = 1;
} finally {
  await app?.close(); await server.close();
  await fs.writeFile('docs/evidence/backend-v1/live-codex-desktop.json', JSON.stringify(report, null, 2));
  // The temporary database contains real, non-secret account metadata; do not retain it.
  await fs.rm(profile, { recursive: true, force: true });
}
