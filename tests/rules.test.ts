import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchoredDate, dateInZone, daysBetween, decimal, decimalText, fieldText, isLow, monthlySummary, projectEvents, validateSubscription } from '../src/shared/rules';
import { defaultPreferences, demoField, makeScenario } from '../src/renderer/service/scenarios';

test('月末锚点及闰年不漂移',()=>{
  assert.deepEqual([0,1,2].map(i=>anchoredDate('2027-01-31','monthly',i)),['2027-01-31','2027-02-28','2027-03-31']);
  assert.equal(anchoredDate('2024-02-29','yearly',3),'2027-02-28');
  assert.equal(anchoredDate('2024-02-29','yearly',4),'2028-02-29');
});
test('日期型不受时区转换影响，DST 按日历天数',()=>{
  assert.equal(dateInZone('2027-03-14T04:30:00.000Z','America/New_York'),'2027-03-13');
  assert.equal(dateInZone('2027-03-14T07:30:00.000Z','America/New_York'),'2027-03-14');
  assert.equal(daysBetween('2027-03-13','2027-03-15'),2);
  const space=makeScenario('date_boundaries');
  const events=projectEvents(space.subscriptions,space.now);
  assert.equal(events.find(e=>e.id==='month-end:renewal:1')!.date,'2027-03-31');
  assert.equal(events.find(e=>e.id==='dst:renewal:0')!.date,'2027-03-14');
});
test('金额定点运算、共用付款去重和按币种分列',()=>{
  assert.equal(decimalText(decimal('0.1')+decimal('0.2')),'0.300000');
  const space=makeScenario('multi_account_shared');const sum=monthlySummary(space.subscriptions);
  assert.equal(sum.totals.find(x=>x.currency==='USD')!.amount,'50.000000');
  assert.equal(sum.totals.find(x=>x.currency==='CNY')!.amount,'49.000000');
  assert.equal(space.subscriptions.find(s=>s.id==='codex')!.quotaPoolId,'pool-codex');
  assert.equal(space.subscriptions.find(s=>s.id==='chatgpt')!.quotaPoolId,null);
});
test('未知不归零；重置不生成续费；陈旧低值不告警',()=>{
  assert.equal(fieldText(demoField(null)),'尚未获取');assert.equal(fieldText(demoField('0')),'0');
  const space=makeScenario('stale_and_past_reset');assert.equal(isLow(space.subscriptions[0],space.now,defaultPreferences),false);
  assert.equal(projectEvents(space.subscriptions,space.now).some(e=>e.kind==='reset'),false);
  assert.equal(projectEvents(space.subscriptions,space.now,true).some(e=>e.kind==='reset'),true);
  const unknown=makeScenario('unknown_and_na');assert.equal(projectEvents(unknown.subscriptions,unknown.now).some(e=>e.subscriptionId==='custom'),false);
  const normal=makeScenario('normal_mixed');assert.equal(isLow(normal.subscriptions[1],normal.now,defaultPreferences),false,'赠送余额低不代表可用总余额低');
});
test('改期保持逻辑 ID；不续费不推断已付有效期',()=>{
  const space=makeScenario('normal_mixed');const sub=space.subscriptions.find(s=>s.id==='claude')!;
  const before=projectEvents([sub],space.now)[0];sub.renewalDate.value='2026-10-25';sub.anchorDate='2026-10-25';
  const after=projectEvents([sub],space.now)[0];assert.equal(before.id,after.id);assert.notEqual(before.date,after.date);
  sub.autoRenew='off';assert.equal(projectEvents([sub],space.now).length,0);
});
test('订阅价格校验不会错误拦截负钱包余额',()=>{
  const s=makeScenario('normal_mixed').subscriptions[1];s.metrics[0].remaining.value='-3.25';assert.deepEqual(validateSubscription(s),{});
  s.price.value='-1';assert.ok(validateSubscription(s).price);s.price.value=null;s.startDate.value='2026-11-01';s.renewalDate.value='2026-10-01';assert.ok(validateSubscription(s).renewalDate);
});
