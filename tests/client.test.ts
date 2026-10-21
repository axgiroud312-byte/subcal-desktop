import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSubCalClient, type DemoStorage } from '../src/renderer/service/MockSubCalClient';
import { emptySubscription } from '../src/renderer/service/scenarios';
import { scenarioIds } from '../src/shared/types';
function storage():DemoStorage{const m=new Map<string,string>();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>{m.set(k,v);}};}
const make=()=>new MockSubCalClient(storage(),5);

test('十二场景隔离、重复创建幂等、重启恢复、删除事务撤销',async()=>{
  const store=storage(),c=new MockSubCalClient(store,1);
  for(const id of scenarioIds){await c.preview.switchScenario(id);assert.equal((await c.snapshot()).scenario,id);}
  await c.preview.switchScenario('empty_first_run');const draft=emptySubscription('仅名称');const id=await c.create(draft,'unique');assert.equal(await c.create(draft,'unique'),id);
  await c.preview.switchScenario('normal_mixed');await c.preview.switchScenario('empty_first_run');assert.equal((await c.snapshot()).subscriptions.length,1);
  const reopened=new MockSubCalClient(store,1);assert.equal((await reopened.snapshot()).subscriptions[0].product,'仅名称');
  const undo=await reopened.remove(id,true);assert.equal((await reopened.snapshot()).subscriptions.length,0);await reopened.undo(undo);assert.equal((await reopened.snapshot()).subscriptions.length,1);
});
test('revision 冲突保留现有记录',async()=>{
  const c=make();await c.update('claude',1,{notes:'先保存'});await assert.rejects(c.update('claude',1,{notes:'迟到'}),/刚刚发生变化/);assert.equal((await c.snapshot()).subscriptions.find(s=>s.id==='claude')!.notes,'先保存');
});
test('部分成功只刷新成功字段；锁定日期不被模拟额度刷新覆盖',async()=>{
  const c=make();await c.preview.switchScenario('partial_success');const before=(await c.snapshot()).subscriptions.find(s=>s.id==='deepseek')!;
  await c.refresh('deepseek');const after=(await c.snapshot()).subscriptions.find(s=>s.id==='deepseek')!;assert.equal(after.plan.observedAt,before.plan.observedAt);assert.notEqual(after.metrics[0].remaining.observedAt,before.metrics[0].remaining.observedAt);
  await c.preview.switchScenario('auth_and_locked_fields');const probe=await c.probe('codex-local','个人示例账号');await c.bind(probe);let s=(await c.snapshot()).subscriptions[0];assert.equal(s.renewalDate.value,'2026-11-03');assert.equal(s.renewalDate.proposed,'2026-11-05');await c.resolveField(s.id,'renewalDate',true);s=(await c.snapshot()).subscriptions[0];assert.equal(s.renewalDate.value,'2026-11-05');
});
test('刷新合并、断开和切场景隔离迟到响应',async()=>{
  const c=make();const first=c.refresh('codex-local');assert.match(await c.refresh('codex-local'),/合并/);await first;assert.equal((await c.snapshot()).connections[0].runs,1);
  const late=c.refresh('codex-local');await c.disconnect('codex-local');await late;assert.equal((await c.snapshot()).connections[0].state,'disconnected');
  const next=c.refresh('deepseek');await c.preview.switchScenario('empty_first_run');await next;assert.equal((await c.snapshot()).subscriptions.length,0);
  await c.preview.switchScenario('normal_mixed');assert.notEqual((await c.snapshot()).connections.find(c=>c.id==='deepseek-balance')!.state,'refreshing');
});
test('限流尊重演示时钟；离线恢复只补查一次',async()=>{
  const c=make();await c.preview.switchScenario('rate_limited');assert.match(await c.refresh('codex'),/限流/);assert.equal((await c.snapshot()).connections[0].runs,0);await c.preview.advance(5);await c.refresh('codex');assert.equal((await c.snapshot()).connections[0].runs,1);
  await c.preview.switchScenario('offline_recovery');await c.refresh();assert.equal((await c.snapshot()).connections[0].runs,0);await c.preview.recoverOffline();await c.preview.recoverOffline();assert.equal((await c.snapshot()).connections[0].runs,1);
});
test('三后端确认边界、重复同步幂等、改期更新相同 ID',async()=>{
  const c=make();for(const backend of ['google','eventkit','icloud-caldav'] as const){const p=await c.previewSync(backend);await c.sync(p.id);const t=(await c.snapshot()).targets.find(t=>t.id===backend)!;assert.match(t.message,backend==='eventkit'?/模拟本机读回一致/:/模拟远端读回一致/);const again=await c.previewSync(backend);assert.equal(again.changes.length,0);await c.sync(again.id);assert.equal((await c.snapshot()).targets.find(x=>x.id===backend)!.remote.length,t.remote.length);}
  const s=(await c.snapshot()).subscriptions.find(s=>s.id==='claude')!;await c.update(s.id,s.revision,{renewalDate:{...s.renewalDate,value:'2026-10-25'},anchorDate:'2026-10-25'});const diff=await c.previewSync('google');assert.equal(diff.changes.find(x=>x.event.id==='claude:renewal:0')!.action,'update');await c.sync(diff.id);assert.equal((await c.snapshot()).targets[0].remote.find(e=>e.id==='claude:renewal:0')!.date,'2026-10-25');
});
test('同步预览失效、模拟写入后失败可恢复；目标暂停中断提交',async()=>{
  const c=make();let p=await c.previewSync('google');await c.update('claude',1,{notes:'使预览失效'});await assert.rejects(c.sync(p.id),/重新预览/);
  p=await c.previewSync('google');await c.sync(p.id,true);assert.equal((await c.snapshot()).targets[0].stage,'failed');p=await c.previewSync('google');assert.equal(p.changes.length,0);await c.sync(p.id);assert.equal((await c.snapshot()).targets[0].stage,'verified');
  p=await c.previewSync('icloud-caldav');const running=c.sync(p.id);await c.targetState('icloud-caldav','paused');await assert.rejects(running,/取消/);assert.equal((await c.snapshot()).targets[2].remote.length,0);
});
test('外部删除抑制、三种冲突裁决与逐次改期保持身份',async()=>{
  const c=make();await c.preview.switchScenario('calendar_conflicts');let p=await c.previewSync('google');const conflict=p.changes.find(x=>x.action==='conflict')!;await c.resolveConflict('google',conflict.event.id,'remote');assert.equal((await c.snapshot()).subscriptions.find(s=>s.id==='claude')!.renewalDate.value,'2026-10-25');
  const id='claude:renewal:1';await c.simulateExternal('google',id,'move');await c.resolveConflict('google',id,'remote');const event=(await c.events()).find(e=>e.id===id)!;assert.equal(event.date,'2026-11-25');assert.equal((await c.snapshot()).subscriptions.find(s=>s.id==='claude')!.renewalDate.value,'2026-10-25');
  p=await c.previewSync('icloud-caldav');const deleted=p.changes.find(x=>x.action==='suppressed')!;await c.refresh();assert.equal((await c.previewSync('icloud-caldav')).changes.find(x=>x.event.id===deleted.event.id)!.action,'suppressed');
  await c.simulateExternal('google','claude:renewal:0','move');await c.resolveConflict('google','claude:renewal:0','local');assert.equal((await c.previewSync('google')).changes.some(x=>x.event.id==='claude:renewal:0'&&x.action==='conflict'),false);
  await c.simulateExternal('google','claude:renewal:0','move');await c.resolveConflict('google','claude:renewal:0','unlink');assert.equal((await c.snapshot()).targets[0].remote.find(x=>x.id==='claude:renewal:0')!.managed,false);
});
test('备份往返、结构/版本/大小/改文件拒绝；恢复目标暂停',async()=>{
  const c=make(),text=await c.exportData();await c.update('claude',1,{product:'修改后的名称'});const p=await c.importPreview(text);await assert.rejects(c.importCommit(p.id,text+' '),/重新预览/);await c.importCommit(p.id,text);const s=await c.snapshot();assert.equal(s.subscriptions.find(s=>s.id==='claude')!.product,'Claude Pro');assert.ok(s.targets.every(t=>t.state==='paused'));
  for(const bad of ['{','{"schemaVersion":2}','x'.repeat(2*1024*1024+1),text.replace('"product": "Codex"','"product": null')])await assert.rejects(c.importPreview(bad));
  assert.equal((await c.snapshot()).subscriptions.length,s.subscriptions.length);
});
test('损坏存储保留原内容，明确恢复前不允许覆盖',async()=>{
  const store=storage();store.setItem('subcal.preview.v1','bad json');const c=new MockSubCalClient(store,1);assert.ok((await c.snapshot()).storageError);await assert.rejects(c.create(emptySubscription('test'),'key'));assert.equal(store.getItem('subcal.preview.v1'),'bad json');await c.preview.recoverStorage();assert.equal(store.getItem('subcal.preview.v1.recovery'),'bad json');assert.equal((await c.snapshot()).storageError,null);
});
test('归档恢复原生命周期，明确移除的模拟未来事件不会复活',async()=>{
  const c=make();await c.update('claude',1,{lifecycle:'trial'});const p=await c.previewSync('google');await c.sync(p.id);
  await c.archive('claude',true,true);assert.equal((await c.previewSync('google')).changes.find(x=>x.event.id==='claude:renewal:0')!.action,'suppressed');
  await c.archive('claude',false,false);assert.equal((await c.snapshot()).subscriptions.find(x=>x.id==='claude')!.lifecycle,'trial');
});
