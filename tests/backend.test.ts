import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SubCalDatabase } from '../src/main/db/database';
import { CredentialVault, type SafeStorageBackend } from '../src/main/credentials';
import { SubCalService } from '../src/main/service';
import { NotificationService } from '../src/main/notifications';
import type { AdapterManifest, CollectOutput } from '../src/main/adapters/types';
import { AdapterError } from '../src/main/adapters/types';
import type { IpcMethod } from '../src/shared/bridge';
import type { SubscriptionInput } from '../src/shared/types';
import { compareMetricDecimal } from '../src/shared/rules';
import { Scheduler } from '../src/main/scheduler';
import { entitlementDateSchema } from '../src/shared/schema';
import { mergeObservation, mergeBalances } from '../src/shared/entitlements';
import { projectEvents } from '../src/shared/rules';
import type { Field, EntitlementDate, Balance } from '../src/shared/types';

const backend:SafeStorageBackend={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from([...Buffer.from(s)].map(b=>b^0x42)),decryptString:b=>Buffer.from([...b].map(v=>v^0x42)).toString()};
const manifest:AdapterManifest={id:'deepseek-balance',version:'1',brand:'DeepSeek',product:'DeepSeek API',region:'cn',supportedFields:[],unsupportedFields:[],authMode:'api_key',officialSourceUrl:'https://api.deepseek.com',termsCheckedAt:'2026-01-01',allowedHosts:['api.deepseek.com'],minIntervalSeconds:300,defaultForegroundSeconds:1800,defaultBackgroundSeconds:1800,timeoutMs:15000,supportTier:'official_auto',permissions:'read',credentialLocation:'vault'};
const unknown=()=>({value:null,availability:'unfetched' as const,source:'手动',observedAt:null,dataOrigin:'manual' as const});
const input=():SubscriptionInput=>({product:'测试订阅',brand:'测试',kind:'manual',account:'本人',region:'中国',organization:'个人',plan:unknown(),price:{...unknown(),value:'12.50',availability:'known'},currency:'CNY',cycle:'monthly',intervalDays:30,anchorDate:'2026-01-31',timezone:'Asia/Shanghai',startDate:unknown(),renewalDate:{...unknown(),value:'2026-02-28',availability:'known'},paidThrough:unknown(),trialEnd:unknown(),lifecycle:'active',autoRenew:'on',billingGroupId:null,quotaPoolId:null,possibleSharedWallet:false,metrics:[],connectionId:null,website:'',reminder:'local',pinned:false,notes:''});
function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'subcal-backend-'));
  let clock=Date.parse('2026-02-26T04:00:00Z');
  const db=new SubCalDatabase(dir),vault=new CredentialVault(dir,backend);
  assert.equal(db.listConnections().length,0);db.ensureConnection('deepseek-balance');
  let calls=0;
  let collect:()=>Promise<CollectOutput>=async()=>({account:{subject:'account-1',alias:'测试账号',organization:'个人',region:'cn'},poolId:'pool:one',metrics:[{id:'balance',label:'余额',unit:'CNY',remaining:'1.234567891',total:null,resetAt:null,observedAt:new Date(clock).toISOString(),availability:'known',source:'official',dataOrigin:'official_api',staleAfterMinutes:60}],fields:[],partialFailures:[],samples:['余额 1.234567891'],observedAt:new Date(clock).toISOString()});
  const service=new SubCalService(db,vault,{collect:()=>{calls++;return collect();},cancel:()=>{},close:()=>{}},[manifest],()=>clock);
  const call=async(method:IpcMethod,params:unknown={},extra:Record<string,unknown>={})=>{const r=await service.handle({version:1,requestId:randomUUID(),idempotencyKey:randomUUID(),method,params,...extra});if(!r.ok)throw Object.assign(new Error(r.error.message),{code:r.error.code});return r.result as any;};
  return {dir,db,vault,service,call,advance:(ms:number)=>{clock+=ms;},now:()=>clock,calls:()=>calls,setCollect:(fn:()=>Promise<CollectOutput>)=>{collect=fn;},close:()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('empty production store, durable CRUD, revision, idempotency, archive and undo',async()=>{
  const f=fixture();try {
    assert.equal(f.service.snapshot().subscriptions.length,0);
    const key=randomUUID(),id=await f.call('subscriptions.create',{input:input()},{idempotencyKey:key});
    assert.equal(await f.call('subscriptions.create',{input:input()},{idempotencyKey:key}),id);
    await assert.rejects(f.call('subscriptions.create',{input:{...input(),product:'different'}},{idempotencyKey:key}),{code:'IDEMPOTENCY_CONFLICT'});
    await f.call('subscriptions.update',{id,patch:{notes:'persist'}},{expectedRevision:1});
    await assert.rejects(f.call('subscriptions.update',{id,patch:{notes:'stale'}},{expectedRevision:1}),{code:'REVISION_CONFLICT'});
    await f.call('subscriptions.archive',{id,archived:true,removeFuture:false});assert.equal(f.db.getSubscription(id)?.lifecycle,'archived');
    await f.call('subscriptions.archive',{id,archived:false,removeFuture:false});assert.equal(f.db.getSubscription(id)?.lifecycle,'active');
    const token=await f.call('subscriptions.remove',{id,removeFuture:false});assert.equal(f.db.listSubscriptions().length,0);
    await f.call('subscriptions.undo',{token});assert.equal(f.db.getSubscription(id)?.notes,'persist');
    const second=new SubCalDatabase(f.dir);assert.equal(second.getSubscription(id)?.notes,'persist');second.close();
  }finally{f.close();}
});
test('strict IPC schema, invalid date and unsafe website rejected; new backup restores disconnected',async()=>{
  const f=fixture();try {
    await assert.rejects(f.call('subscriptions.create',{input:{...input(),website:'javascript:alert(1)'}}));
    await assert.rejects(f.call('subscriptions.create',{input:{...input(),renewalDate:{...unknown(),value:'2026-02-30'}}}));
    await f.call('subscriptions.create',{input:input()});const text=await f.call('data.export');
    const preview=await f.call('data.importPreview',{text});
    await assert.rejects(f.call('data.importCommit',{id:preview.id,text:text+' '}),{code:'IMPORT_CHANGED'});
    await f.call('data.importCommit',{id:preview.id,text});assert.equal(f.db.listSubscriptions().length,1);
    assert.ok(f.db.listConnections().every(c=>c.state==='disconnected'));
  }finally{f.close();}
});
test('auth probe bind creates product only after success, secrets stay outside SQLite and exports',async()=>{
  const f=fixture();try {
    const auth=await f.call('connections.beginAuth',{provider:'deepseek-balance'});
    await f.call('connections.saveCredential',{connectionId:auth.connectionId,secret:'sk-secret-never-export-this'});
    assert.equal(f.db.listSubscriptions().length,0);
    const p=await f.call('connections.probe',{id:auth.connectionId,profile:''});
    await f.call('connections.bind',{probe:p});assert.equal(f.db.listSubscriptions().length,1);
    assert.equal(f.db.listSubscriptions()[0].metrics[0].remaining.value,'1.234567891');
    assert.equal(f.db.listConnections().find(c=>c.id===auth.connectionId)?.verification,'pending');
    assert.ok(!(await f.call('data.export')).includes('sk-secret-never-export-this'));
    assert.ok(!JSON.stringify(f.service.snapshot()).includes('sk-secret-never-export-this'));
    await f.call('connections.disconnect',{id:auth.connectionId,removeCredential:true});
    assert.equal(f.db.listSubscriptions().length,1);assert.equal(f.db.listSubscriptions()[0].connectionId,null);
  }finally{f.close();}
});
test('persistent frequency floor survives reconnect and probe; no manual bypass',async()=>{
  const f=fixture();try {
    await f.call('connections.beginAuth',{provider:'deepseek-balance'});
    const p=await f.call('connections.probe',{id:'deepseek-balance',profile:''});await f.call('connections.bind',{probe:p});
    await assert.rejects(f.service.scheduler.run('deepseek-balance','manual'),{code:'RATE_LIMITED'});
    await f.call('connections.beginAuth',{provider:'deepseek-balance'});
    await assert.rejects(f.call('connections.probe',{id:'deepseek-balance',profile:''}),{code:'RATE_LIMITED'});
    assert.equal(f.calls(),1);
  }finally{f.close();}
});
test('late old generation cannot bind or overwrite; failed probe preserves original subscription',async()=>{
  const f=fixture();try {
    const id=await f.call('subscriptions.create',{input:input()});
    await f.call('connections.beginAuth',{provider:'deepseek-balance',subscriptionId:id});
    let resolve!:(o:CollectOutput)=>void;f.setCollect(()=>new Promise(r=>{resolve=r;}));
    const pending=f.call('connections.probe',{id:'deepseek-balance',profile:''});
    await new Promise(r=>setImmediate(r));
    await f.call('connections.disconnect',{id:'deepseek-balance',removeCredential:false});
    resolve({account:{subject:'late',alias:'late',region:'cn',organization:'personal'},poolId:'late',metrics:[],fields:[],partialFailures:[],samples:[],observedAt:new Date(f.now()).toISOString()});
    await assert.rejects(pending);assert.equal(f.db.getSubscription(id)?.product,'测试订阅');assert.equal(f.db.getConnectionRow('deepseek-balance')?.state,'disconnected');
  }finally{f.close();}
});
test('401 stops, 429 backs off, five schema failures trip circuit',async()=>{
  const f=fixture();try {
    f.db.updateConnection('deepseek-balance',{state:'ready'});
    f.setCollect(async()=>{throw new AdapterError('AUTH_REQUIRED','expired');});
    await assert.rejects(f.service.scheduler.run('deepseek-balance','manual'));assert.equal(f.db.getConnectionRow('deepseek-balance')?.state,'auth');
    f.advance(400000);f.db.updateConnection('deepseek-balance',{state:'ready'});
    f.setCollect(async()=>{throw new AdapterError('RATE_LIMITED','wait',{retryAfterMs:700000});});
    await assert.rejects(f.service.scheduler.run('deepseek-balance','manual'));assert.ok(f.db.getConnectionRow('deepseek-balance')!.nextAllowedAt!>=f.now()+700000);
    f.setCollect(async()=>{throw new AdapterError('SCHEMA_CHANGED','changed');});
    for(let i=0;i<5;i++){f.advance(4000000);await assert.rejects(f.service.scheduler.run('deepseek-balance','manual'));}
    assert.equal(f.service.scheduler.job('deepseek-balance')?.state,'paused');const count=f.calls();f.advance(4000000);await f.service.scheduler.tick();assert.equal(f.calls(),count);
  }finally{f.close();}
});
test('locked field proposes source, partial metrics preserve observation timestamp',async()=>{
  const f=fixture();try {
    const id=await f.call('subscriptions.create',{input:{...input(),connectionId:'deepseek-balance',plan:{...unknown(),value:'Mine',availability:'known',locked:true}}});
    const result:CollectOutput={account:{subject:'a',alias:'a',region:'cn',organization:'p'},poolId:'pool:one',metrics:[{id:'m',label:'m',unit:'次',remaining:'3',total:null,resetAt:null,observedAt:new Date(f.now()).toISOString(),availability:'known',source:'api',dataOrigin:'official_api',staleAfterMinutes:10}],fields:[{field:'plan',value:'Auto',availability:'known',source:'api',observedAt:new Date(f.now()).toISOString(),dataOrigin:'official_api'}],partialFailures:[],samples:[],observedAt:new Date(f.now()).toISOString()};
    f.service.applyCollection('deepseek-balance',result);const first=f.db.getSubscription(id)!;assert.equal(first.plan.value,'Mine');assert.equal(first.plan.proposed,'Auto');
    f.advance(60000);result.metrics[0].observedAt=new Date(f.now()).toISOString();result.partialFailures=[{field:'m',reason:'failed'}];f.service.applyCollection('deepseek-balance',result);
    assert.equal(f.db.getSubscription(id)!.metrics[0].remaining.observedAt,first.metrics[0].remaining.observedAt);
    await f.call('subscriptions.resolveField',{id,field:'plan',accept:true});assert.equal(f.db.getSubscription(id)!.plan.value,'Auto');assert.equal(f.db.getSubscription(id)!.plan.dataOrigin,'official_api');
  }finally{f.close();}
});
test('notifications durable dedupe, quiet hours, mute and one summarized delivery',async()=>{
  const f=fixture();try {
    await f.call('subscriptions.create',{input:input()});let shown=0;
    const n=new NotificationService(f.db,{available:()=>true,show:()=>{shown++;}},f.now);
    f.db.savePreferences({...f.db.getPreferences(),notificationsMuted:true});n.tick();assert.equal(shown,0);
    f.db.savePreferences({...f.db.getPreferences(),notificationsMuted:false,dndStart:'00:00',dndEnd:'23:59'});n.tick();assert.equal(shown,0);
    f.db.savePreferences({...f.db.getPreferences(),dndStart:'23:00',dndEnd:'08:00'});n.tick();n.tick();assert.equal(shown,1);
    const n2=new NotificationService(f.db,{available:()=>true,show:()=>{shown++;}},f.now);n2.tick();assert.equal(shown,1);
    assert.equal(f.db.rawPrepare('SELECT delivered_at FROM notification_deliveries').get()?.delivered_at,null);
  }finally{f.close();}
});
test('vault corruption preserved and atomic failed write restores prior credential',()=>{
  const f=fixture();try {
    const old=f.vault.saveSecret('a','secret-old-value');
    fs.mkdirSync(path.join(f.dir,'credentials.vault.json.tmp'));
    assert.throws(()=>f.vault.saveSecret('a','secret-new-value',old.credentialRef));assert.equal(f.vault.getSecret(old.credentialRef),'secret-old-value');
    fs.rmSync(path.join(f.dir,'credentials.vault.json.tmp'),{recursive:true});
    assert.throws(()=>f.vault.withRollback(()=>{f.vault.saveSecret('a','replacement-secret',old.credentialRef);throw new Error('database commit failed');}));
    assert.equal(new CredentialVault(f.dir,backend).getSecret(old.credentialRef),'secret-old-value');
    fs.writeFileSync(path.join(f.dir,'credentials.vault.json'),'{broken');const broken=new CredentialVault(f.dir,backend);assert.throws(()=>broken.saveSecret('a','something-valid'));assert.equal(fs.readFileSync(path.join(f.dir,'credentials.vault.json'),'utf8'),'{broken');
  }finally{f.close();}
});
test('corrupt database returns explicit storage error without destructive reset',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'subcal-corrupt-'));try {fs.writeFileSync(path.join(dir,'subcal.sqlite'),'broken');const db=new SubCalDatabase(dir);assert.ok(db.getStorageError());assert.throws(()=>db.setSetting('x',1));assert.equal(fs.readFileSync(path.join(dir,'subcal.sqlite'),'utf8'),'broken');db.close();}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('metric decimals preserve precision rather than rounding to price precision',()=>{assert.equal(compareMetricDecimal('0.123456789','0.123456788'),1);assert.equal(compareMetricDecimal('-0.000000001','0'),-1);});
test('three global leases, provider serialization, persistent queue and wake coalescing',async()=>{
  const f=fixture();try {
    const ids=['deepseek-balance','kimi-platform-cn','openrouter-key','codex-local','copilot-local'] as const;
    const manifests=ids.map(id=>({...manifest,id}));for(const id of ids){f.db.ensureConnection(id);f.db.updateConnection(id,{state:'ready'});}
    const resolves=new Map<string,(value:CollectOutput)=>void>();let calls=0;
    const scheduler=new Scheduler(f.db,f.vault,{collect:(_id,p)=>{calls++;return new Promise(r=>resolves.set(p.connectionId,r));},cancel:()=>{},close:()=>{}},manifests,()=>{},()=>{},f.now,()=>0.5);
    for(const id of ids){scheduler.enqueue(id);scheduler.enqueue(id);}
    assert.equal(f.db.rawPrepare('SELECT count(*) AS n FROM collection_jobs').get()?.n,5);
    await scheduler.tick();await new Promise(r=>setImmediate(r));assert.equal(calls,3);
    f.db.ensureConnection('deepseek-balance','second-account');f.db.updateConnection('second-account',{state:'ready'});
    await assert.rejects(scheduler.run('second-account','manual'));assert.equal(calls,3);
    const first=ids.find(id=>resolves.has(id))!;
    const a=scheduler.run(first,'manual'),b=scheduler.run(first,'manual');assert.equal(a,b);
    scheduler.resume();scheduler.resume();await scheduler.tick();assert.equal(calls,3);
    const empty:CollectOutput={account:{subject:'a',alias:'a',region:'cn',organization:'p'},poolId:'p',metrics:[],fields:[],partialFailures:[],samples:[],observedAt:new Date(f.now()).toISOString()};
    for(const resolve of resolves.values())resolve(empty);await a;await new Promise(r=>setImmediate(r));
    f.advance(30000);await scheduler.tick();await new Promise(r=>setImmediate(r));assert.equal(calls,5);
    for(const resolve of resolves.values())resolve(empty);await new Promise(r=>setImmediate(r));
    scheduler.close();
  }finally{f.close();}
});
test('expired lease reclaimed once, active lease preserved, offline creates no attempts',async()=>{
  const f=fixture();try {
    f.db.updateConnection('deepseek-balance',{state:'ready'});f.service.scheduler.enqueue('deepseek-balance');
    f.db.rawPrepare("UPDATE collection_jobs SET state='running',lease_until=?").run(f.now()+60000);
    await f.service.scheduler.tick();assert.equal(f.calls(),0);
    f.advance(70000);f.service.scheduler.setOnline(false);await f.service.scheduler.tick();assert.equal(f.calls(),0);
    f.service.scheduler.setOnline(true);f.advance(31000);await f.service.scheduler.tick();await new Promise(r=>setImmediate(r));assert.equal(f.calls(),1);
    await f.service.scheduler.tick();assert.equal(f.calls(),1);
  }finally{f.close();}
});
test('migration creates a consistent pre-upgrade backup',()=>{
  const f=fixture();try {
    f.db.rawPrepare('DELETE FROM schema_migrations WHERE version=2').run();
    const reopened=new SubCalDatabase(f.dir);const row=reopened.getAppliedMigrations().find(m=>m.version===2);assert.ok(row?.backupRef);assert.ok(fs.existsSync(row.backupRef));reopened.close();
  }finally{f.close();}
});
const reported=<T>(value:T,at='2026-02-26T04:00:00Z'):Field<T>=>({value,availability:'known',source:'synthetic read-only fixture',observedAt:at,dataOrigin:'official_api',evidence:'reported'});
const day=(value:string):Field<EntitlementDate>=>reported({precision:'day',value});
test('date precision is strict; expiry/reset/credit and authentication lifetimes never interchange',async()=>{
  assert.equal(entitlementDateSchema.safeParse({precision:'day',value:'2026-02-30'}).success,false);
  assert.equal(entitlementDateSchema.safeParse({precision:'day',value:'2026-02-28',timezone:'UTC'}).success,false);
  assert.equal(entitlementDateSchema.safeParse({precision:'instant',value:'2026-02-28T12:00:00'}).success,false);
  const f=fixture();try {
    const id=await f.call('subscriptions.create',{input:{...input(),connectionId:'deepseek-balance',renewalDate:unknown(),entitlements:{membershipExpiresAt:day('2026-02-28'),billingPeriodEnd:day('2026-02-28'),nextBillingStart:day('2026-02-28')},credentialExpiresAt:day('2026-02-28'),balances:[{id:'gift',label:'gift',scope:'account',kind:'grant',currency:'CNY',amount:reported('5'),expiresAt:day('2026-02-28')}],metrics:[{id:'quota',label:'quota',unit:'次',remaining:reported('4'),total:'10',resetAt:null,resetObservation:day('2026-02-28'),staleAfterMinutes:10}]} });
    const events=projectEvents([f.db.getSubscription(id)!],new Date(f.now()).toISOString(),true);
    assert.deepEqual(events.map(e=>e.kind).sort(),['expiry','reset']);
    assert.ok(events.every(e=>e.date==='2026-02-28'&&e.precision==='day'&&e.instant===undefined));
    assert.deepEqual(events.map(e=>e.dateSemantic).sort(),['membership_expiry','quota_reset']);
    const sub=f.db.getSubscription(id)!;sub.entitlements={};sub.metrics=[];f.db.upsertSubscription(sub);
    assert.equal(projectEvents([sub],new Date(f.now()).toISOString(),true).length,0,'token exp and credit expiry are not membership or reset events');
    let shown=0;new NotificationService(f.db,{available:()=>true,show:()=>{shown++;}},f.now).tick();assert.equal(shown,0,'authentication and credit expiry do not emit membership notifications');
  }finally{f.close();}
});
test('unknown, partial, old and omitted observations retain actual prior values and timestamps',async()=>{
  const f=fixture();try {
    const id=await f.call('subscriptions.create',{input:{...input(),connectionId:'deepseek-balance'}});
    const base:CollectOutput={account:{subject:'a',alias:'a',region:'cn',organization:'p'},poolId:'pool:one',metrics:[{id:'m',label:'dynamic',unit:'tokens',remaining:'7',used:'3',total:'10',resetAt:'2026-02-28',observedAt:new Date(f.now()).toISOString(),availability:'known',source:'api',dataOrigin:'official_api',staleAfterMinutes:10,windowStart:day('2026-02-01'),windowMinutes:43200,scope:'model',models:['a','b'],poolId:'shared:models'}],fields:[{field:'plan',value:'Pro',availability:'known',source:'api',observedAt:new Date(f.now()).toISOString(),dataOrigin:'official_api'}],entitlements:{membershipExpiresAt:day('2026-02-28')},balances:[{id:'cash',label:'cash',scope:'account',kind:'cash',currency:'CNY',amount:reported('0')}],partialFailures:[],samples:[],observedAt:new Date(f.now()).toISOString()};
    f.service.applyCollection('deepseek-balance',base);const before=f.db.getSubscription(id)!;
    f.advance(60000);
    f.service.applyCollection('deepseek-balance',{...base,fields:[{...base.fields[0],value:null,availability:'denied',observedAt:new Date(f.now()).toISOString()}],metrics:[{...base.metrics[0],remaining:null,used:'4',total:null,resetAt:null,observedAt:new Date(f.now()).toISOString()}],entitlements:{membershipExpiresAt:{...day('2026-03-01'),availability:'unfetched'}},balances:[],partialFailures:[]});
    const after=f.db.getSubscription(id)!;
    assert.deepEqual(after.plan,before.plan);assert.deepEqual(after.entitlements,before.entitlements);assert.deepEqual(after.balances,before.balances);
    assert.deepEqual(after.metrics[0].remaining,before.metrics[0].remaining);assert.equal(after.metrics[0].used?.value,'4');assert.equal(after.metrics[0].total,'10');assert.equal(after.metrics[0].resetAt,'2026-02-28');assert.deepEqual(after.metrics[0].models,['a','b']);
    const row=f.db.rawPrepare('SELECT used,observation_json,currency FROM metric_observations ORDER BY rowid DESC LIMIT 1').get()!;
    assert.equal(row.used,'4');assert.equal(row.currency,null);assert.equal(JSON.parse(String(row.observation_json)).scope,'model');
    f.advance(60000);f.service.applyCollection('deepseek-balance',{...base,metrics:[{...base.metrics[0],remaining:'6',used:'999',observedAt:new Date(f.now()).toISOString()}],entitlements:{membershipExpiresAt:day('2026-03-01')},partialFailures:[{field:'m.used',reason:'synthetic partial failure'},{field:'entitlements.membershipExpiresAt',reason:'synthetic partial failure'}]});
    const partial=f.db.getSubscription(id)!;assert.equal(partial.metrics[0].remaining.value,'6');assert.equal(partial.metrics[0].used?.value,'4');assert.deepEqual(partial.entitlements,before.entitlements);
    const current=reported('current'),old=reported('old','2026-01-01T00:00:00Z');assert.deepEqual(mergeObservation(current,old),current);
  }finally{f.close();}
});
test('actual payment cannot be overwritten by provider list price or edits to automatic fields, even after disconnect',async()=>{
  const f=fixture();try {
    const id=await f.call('subscriptions.create',{input:{...input(),connectionId:'deepseek-balance'}});
    f.service.applyCollection('deepseek-balance',{account:{subject:'a',alias:'a',region:'cn',organization:'p'},poolId:'pool:one',metrics:[],fields:[{field:'price',value:'99',availability:'known',source:'api',observedAt:new Date(f.now()).toISOString(),dataOrigin:'official_api'}],entitlements:{autoRenew:reported(false)},partialFailures:[],samples:[],observedAt:new Date(f.now()).toISOString()});
    let sub=f.db.getSubscription(id)!;assert.equal(sub.price.value,'12.50');assert.equal(sub.entitlements?.listPrice?.value,'99');
    await f.call('subscriptions.update',{id,patch:{price:reported('8.25'),currency:'USD',paidThrough:reported('2026-03-01'),cycle:'yearly',autoRenew:'on',entitlements:{autoRenew:reported(true)},metrics:[],management:'manual'}},{expectedRevision:sub.revision});
    sub=f.db.getSubscription(id)!;assert.equal(sub.price.value,'8.25');assert.equal(sub.price.dataOrigin,'manual');assert.equal(sub.currency,'USD');assert.equal(sub.paidThrough.value,null);assert.equal(sub.cycle,'monthly');assert.equal(sub.entitlements?.autoRenew?.value,false);assert.equal(sub.management,'automatic');
    await f.call('connections.disconnect',{id:'deepseek-balance',removeCredential:false});sub=f.db.getSubscription(id)!;
    await f.call('subscriptions.update',{id,patch:{plan:reported('forged')}},{expectedRevision:sub.revision});assert.equal(f.db.getSubscription(id)?.plan.value,null);
  }finally{f.close();}
});
test('balance currency, key scope, grant expiry and unknown versus zero remain independent',()=>{
  const cash:Balance={id:'same',label:'cash',scope:'account',kind:'cash',currency:'USD',amount:reported('0')};
  const key:Balance={...cash,scope:'key',kind:'budget',amount:reported('7')};
  const cny:Balance={...cash,currency:'CNY',amount:reported('2')};
  assert.equal(mergeBalances([cash],[key,cny]).length,3);
  const denied={...cash,amount:{...cash.amount,value:null,availability:'denied' as const}};
  assert.deepEqual(mergeBalances([cash],[denied]),[cash]);
  assert.deepEqual(mergeBalances([cash],[{...denied,expiresAt:day('2026-03-01')}])[0].expiresAt,day('2026-03-01'));
});
test('v2 upgrade preserves legacy manual data and creates a pre-v3 backup; v1 and v2 JSON round trips preserve sources',async()=>{
  const f=fixture();try {
    const id=await f.call('subscriptions.create',{input:input()});const original=f.db.getSubscription(id)!;
    const automaticId=await f.call('subscriptions.create',{input:{...input(),connectionId:'deepseek-balance'}});
    const legacyAutomatic=f.db.getSubscription(automaticId)!;delete legacyAutomatic.management;f.db.upsertSubscription(legacyAutomatic);
    f.db.rawPrepare('ALTER TABLE metric_observations DROP COLUMN observation_json').run();
    f.db.rawPrepare('DELETE FROM schema_migrations WHERE version=3').run();
    const reopened=new SubCalDatabase(f.dir);try {
      assert.equal(reopened.getStorageError(),null);assert.deepEqual(reopened.getSubscription(id),original);
      assert.equal(reopened.getSubscription(automaticId)?.management,'automatic');assert.equal(reopened.getSubscription(automaticId)?.price.source,'手动');
      const migration=reopened.getAppliedMigrations().find(m=>m.version===3)!;assert.ok(migration.backupRef&&fs.existsSync(migration.backupRef));
    }finally{reopened.close();}
    for(const version of [1,2]) {
      const text=JSON.stringify({schemaVersion:version,format:'subcal-backup',subscriptions:[original],preferences:f.db.getPreferences()});
      const preview=await f.call('data.importPreview',{text});await f.call('data.importCommit',{id:preview.id,text});assert.deepEqual(f.db.getSubscription(id),original);
    }
    const exported=JSON.parse(await f.call('data.export'));assert.equal(exported.schemaVersion,3);assert.deepEqual(exported.payments,[]);assert.deepEqual(exported.subscriptions[0],original);
    // A database that predates the payment ledger gains it through v4 with a consistency backup.
    f.db.rawPrepare('DROP TABLE payments').run();f.db.rawPrepare('DELETE FROM schema_migrations WHERE version=4').run();
    const upgraded=new SubCalDatabase(f.dir);try {
      const migration=upgraded.getAppliedMigrations().find(m=>m.version===4)!;assert.ok(migration.backupRef&&fs.existsSync(migration.backupRef));
      assert.deepEqual(upgraded.listPayments(),[]);
    }finally{upgraded.close();}
  }finally{f.close();}
});
