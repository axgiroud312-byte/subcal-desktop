import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SubCalService } from '../src/main/service';
import { SubCalDatabase } from '../src/main/db/database';
import { CredentialVault } from '../src/main/credentials';
import { manifests } from '../src/main/adapters';
import { AdapterError, type CollectInput, type CollectOutput } from '../src/main/adapters/types';
import type { IpcMethod } from '../src/shared/bridge';

function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'subcal-accounts-'));
  const backend={isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from([...Buffer.from(s)].map(b=>b^42)),decryptString:(b:Buffer)=>Buffer.from([...b].map(v=>v^42)).toString()};
  const db=new SubCalDatabase(dir),vault=new CredentialVault(dir,backend);
  let now=Date.now();
  let behavior=async(input:CollectInput):Promise<CollectOutput>=>({account:{subject:input.expectedSubject!,alias:'测试账号',region:'cn',organization:'个人'},poolId:input.connectionId,metrics:[{id:'balance',label:'余额',unit:'CNY',remaining:'17.25',total:null,resetAt:null,observedAt:new Date(now).toISOString(),availability:'known',source:'测试响应',dataOrigin:'official_api',staleAfterMinutes:60}],fields:[{field:'plan',value:'真实响应套餐',availability:'known',source:'测试响应',dataOrigin:'official_api',observedAt:new Date(now).toISOString()}],partialFailures:[],samples:[],observedAt:new Date(now).toISOString()});
  const service=new SubCalService(db,vault,{collect:(_,input)=>behavior(input),cancel:()=>{},close:()=>{}},manifests,()=>now);
  const call=async(method:IpcMethod,params:any={},extra:any={})=>{const result=await service.handle({version:1,requestId:randomUUID(),idempotencyKey:randomUUID(),method,params,...extra});if(!result.ok)throw new Error(result.error.message);return result.result as any;};
  return {dir,db,vault,service,call,set:(fn:typeof behavior)=>{behavior=fn;},advance:()=>{now+=7200000;},close:()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('adding creates durable card and scheduled job before any query; duplicate key is one account',async()=>{
  const f=fixture();try{
    const added=await f.call('accounts.add',{providerId:'deepseek-balance',secret:'test-only-key'});
    assert.equal(f.db.listSubscriptions().length,1);assert.equal(f.service.scheduler.job(added.connectionId)?.state,'queued');
    assert.equal(f.db.getSubscription(added.subscriptionId)?.metrics.length,0);
    assert.deepEqual(await f.call('accounts.add',{providerId:'deepseek-balance',secret:'test-only-key'}),added);
    const another=await f.call('accounts.add',{providerId:'deepseek-balance',secret:'different-test-key'});
    assert.notEqual(another.connectionId,added.connectionId);
    const reopened=new SubCalDatabase(f.dir);assert.equal(reopened.listSubscriptions().length,2);reopened.close();
    for(const text of [await f.call('data.export'),await f.call('collections.diagnose'),JSON.stringify(f.service.snapshot())])assert.ok(!text.includes('test-only-key'));
  }finally{f.close();}
});
test('failed query preserves card and last observation; billing edits cannot forge automatic entitlement',async()=>{
  const f=fixture();try{
    const added=await f.call('accounts.add',{providerId:'deepseek-balance',secret:'test-only-key'});
    await f.service.scheduler.run(added.connectionId,'scheduled');
    const before=f.db.getSubscription(added.subscriptionId)!;
    f.advance();f.set(async()=>{throw new AdapterError('UPSTREAM_UNAVAILABLE','temporary');});
    await assert.rejects(f.service.scheduler.run(added.connectionId,'scheduled'));
    assert.deepEqual(f.db.getSubscription(before.id)?.metrics,before.metrics);
    await f.call('subscriptions.update',{id:before.id,patch:{metrics:[],account:'forged',plan:{...before.plan,value:'forged'},price:{...before.price,value:'20',availability:'known'}}},{expectedRevision:before.revision});
    const after=f.db.getSubscription(before.id)!;
    assert.deepEqual(after.metrics,before.metrics);assert.equal(after.plan.value,before.plan.value);assert.equal(after.account,before.account);assert.equal(after.price.value,'20');
    await f.call('subscriptions.remove',{id:before.id,removeFuture:false});
    assert.equal(f.service.scheduler.job(added.connectionId)?.state,'paused');
  }finally{f.close();}
});
test('late collection from previous login generation cannot overwrite re-added account',async()=>{
  const f=fixture();try{
    const added=await f.call('accounts.add',{providerId:'deepseek-balance',secret:'test-only-key'});
    let finish!:(result:CollectOutput)=>void;
    f.set(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=f.service.scheduler.run(added.connectionId,'scheduled');
    await new Promise(resolve=>setImmediate(resolve));
    f.db.updateConnection(added.connectionId,{state:'auth'});
    await f.call('accounts.add',{providerId:'deepseek-balance',secret:'test-only-key'});
    finish({account:{subject:'old',alias:'old',region:'cn',organization:'old'},poolId:'old',metrics:[],fields:[],partialFailures:[],samples:[],observedAt:new Date().toISOString()});
    await assert.rejects(pending);assert.equal(f.db.getSubscription(added.subscriptionId)?.account,'API Key');
    assert.equal(f.db.getConnectionRow(added.connectionId)?.state,'ready');
  }finally{f.close();}
});
test('external rotation is persisted without crossing workspace identity; source mismatch preserves observations',async()=>{
  const f=fixture();try{
    let token='first-external-token';
    const credential=(workspace:string)=>({providerId:'codex-local',subject:`codex:${workspace}`,alias:'same@example.test',organization:workspace,secret:JSON.stringify({accessToken:token,subject:`codex:${workspace}`,alias:'same@example.test',source:'codex',management:'external',locator:{kind:'test'}})});
    f.service.accountAccess.resolve=async id=>credential(id);
    f.service.accountAccess.refreshExternal=async c=>credential(c.subject.split(':')[1]);
    const first=await f.call('accounts.add',{candidateId:'workspace-one'});
    const second=await f.call('accounts.add',{candidateId:'workspace-two'});
    assert.notEqual(first.connectionId,second.connectionId);assert.equal(f.db.listSubscriptions().length,2);
    await f.service.scheduler.run(first.connectionId,'scheduled');
    const original=f.db.getConnectionRow(first.connectionId)!;
    token='rotated-external-token';await f.service.reconcileCredentials();
    const updated=f.db.getConnectionRow(first.connectionId)!;
    assert.equal(updated.generation,original.generation+1);assert.match(f.vault.getSecret(updated.credentialRef)!,/rotated-external-token/);
    assert.ok(!JSON.stringify(f.service.snapshot()).includes('external-token'));
    const previous=f.db.getSubscription(first.subscriptionId)!;
    f.service.accountAccess.refreshExternal=async()=>credential('different-workspace');
    f.advance();await assert.rejects(f.service.scheduler.run(first.connectionId,'scheduled'));
    assert.deepEqual(f.db.getSubscription(first.subscriptionId)?.metrics,previous.metrics);
    assert.equal(f.db.getConnectionRow(first.connectionId)?.accountSubject,'codex:workspace-one');
  }finally{f.close();}
});
test('provider reset date stays date-only through persistence and calendar projection',async()=>{
  const f=fixture();try{
    const added=await f.call('accounts.add',{providerId:'deepseek-balance',secret:'test-only-key'});
    f.service.applyCollection(added.connectionId,{account:{subject:'fixture',alias:'fixture',region:'cn',organization:'fixture'},poolId:'date-only-pool',metrics:[{id:'quota',label:'额度',unit:'次',remaining:'12',total:'100',resetAt:'2026-11-01',observedAt:new Date().toISOString(),availability:'known',source:'test',dataOrigin:'official_api',staleAfterMinutes:30}],fields:[],partialFailures:[],samples:[],observedAt:new Date().toISOString()});
    const sub=f.db.getSubscription(added.subscriptionId)!;
    await f.call('subscriptions.update',{id:sub.id,patch:{timezone:'America/Los_Angeles'}},{expectedRevision:sub.revision});
    const events=await f.call('calendars.events',{includeReset:true});
    assert.equal(events[0].date,'2026-11-01');assert.equal(events[0].instant,undefined);
    assert.equal(f.db.getSubscription(sub.id)?.metrics[0].resetAt,'2026-11-01');
  }finally{f.close();}
});
