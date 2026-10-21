import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';
import { balanceAmount, entitlementDate, isAutomatic, latestObservation, uniqueWindows } from '../src/renderer/lib/entitlements';
import { entitlementFixture, observed } from './entitlements-fixture';

test('date-only source stays date-only; unknown never becomes a reset-derived expiry', () => {
  assert.equal(entitlementDate(observed({ precision: 'day', value: '2026-10-22' })), '2026-10-22');
  assert.equal(entitlementDate(entitlementFixture().entitlements?.membershipExpiresAt), '暂未提供');
});

test('credit balances stay credits rather than becoming an invented currency', () => {
  assert.equal(balanceAmount('42.5', 'credits'), '42.5 积分');
  assert.ok(balanceAmount('0', 'USD').includes('0.00'));
});

test('explicit manual management wins over legacy automatic hints', () => {
  const sub = entitlementFixture();
  assert.equal(isAutomatic(sub), true);
  assert.equal(isAutomatic({ ...sub, management: 'manual' }), false);
  assert.equal(isAutomatic({ ...sub, management: undefined }), true);
});

test('shared model pools merge only identical windows, without mutating observations', () => {
  const first = entitlementFixture().metrics[0];
  const second = { ...first, id: 'other-model', models: ['模型丙'] };
  const weekly = { ...first, id: 'weekly', windowMinutes: 10080 };
  const result = uniqueWindows([first, second, weekly]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].models, ['模型甲', '模型乙', '模型丙']);
  assert.deepEqual(first.models, ['模型甲', '模型乙']);
});

test('last observation includes balances and does not borrow manual billing timestamps', () => {
  const sub = entitlementFixture();
  sub.price.observedAt = '2027-01-01T00:00:00Z';
  sub.balances![0].amount.observedAt = '2026-10-22T08:00:00Z';
  assert.equal(latestObservation(sub), '2026-10-22T08:00:00Z');
});

test('rendered card separates membership dates, dynamic windows, account money, key budget and observations', async () => {
  const result = await build({ stdin: { contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { SubscriptionCard } from './src/renderer/components/SubscriptionCard'; import { entitlementFixture } from './tests/entitlements-fixture'; export function render() { return renderToStaticMarkup(<SubscriptionCard subscription={entitlementFixture()} allSubscriptions={[]} connections={[]} now="2026-10-21T08:01:00Z" preferences={{reducedMotion:true,quotaView:'remaining',walletThresholds:{}} as any} onOpen={()=>{}} onRefresh={()=>{}} onConnection={()=>{}} />); }`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty', '.svg': 'text' } });
  const module = { exports: {} as { render(): string } };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), console });
  const html = module.exports.render();
  for (const text of ['有效至', '暂未提供', '账期结束', '3 小时窗口', '模型甲', '共享额度', '账户', '现金', 'Key', '剩余预算', '观察', '实际支付']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('有效至') < html.indexOf('会话额度'));
  assert.ok(!html.includes('2026-10-22 00:00'));
  assert.ok(!html.includes('recharts'));
});

test('automatic account form exposes only actual payment and currency; manual date entry is retained', async () => {
  const result = await build({
    stdin: { contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { SubscriptionForm } from './src/renderer/components/SubscriptionForm'; import { entitlementFixture } from './tests/entitlements-fixture'; export function render(manual = false) { const sub = entitlementFixture(); sub.price.dataOrigin = 'official_api'; if (manual) sub.management = 'manual'; return renderToStaticMarkup(<SubscriptionForm mode="edit" initial={sub} snapshot={{now:'2026-10-21T08:01:00Z', subscriptions:[sub], preferences:{timezone:'Asia/Shanghai'}} as any} client={{} as any} notify={()=>{}} onClose={()=>{}} />); }`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty', '.svg': 'text' },
    plugins: [{ name: 'ssr-modal-shell', setup(b) {
      b.onResolve({ filter: /^\.\/ui$/ }, args => args.importer.endsWith('SubscriptionForm.tsx') ? { path: 'form-ui', namespace: 'ssr-shell' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'ssr-shell' }, () => ({ contents: `import React from 'react'; export { BrandIcon, StatusBadge } from './src/renderer/components/ui'; export function Modal({children}) { return <section>{children}</section>; }`, resolveDir: process.cwd(), loader: 'tsx' }));
    } }],
  });
  const module = { exports: {} as { render(manual?: boolean): string } };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), console });
  const html = module.exports.render();
  assert.ok(html.includes('id="billing-price"'));
  assert.ok(html.includes('id="billing-currency"'));
  assert.ok(!html.includes('type="date"'));
  assert.ok(!html.includes('id="sub-renewal-date"'));
  assert.ok(!html.includes('id="billing-renewalDate"'));
  assert.ok(!/\sdisabled(?:=|\s|>)/.test(html.match(/<input[^>]*id="billing-price"[^>]*>/)?.[0] ?? ''));
  assert.ok(module.exports.render(true).includes('id="sub-renewal-date"'));
});
