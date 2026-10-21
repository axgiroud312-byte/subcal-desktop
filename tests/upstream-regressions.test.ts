import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlAdapters } from '../src/main/adapters/control-adapters';
import { CursorAdapter } from '../src/main/adapters/priority-adapters';
import { remoteAccountAdapter, remoteOrigin } from '../src/main/adapters/remote-account-adapter';
const at='2026-10-21T08:00:00Z';
test('fixed Magpie New API code:true response and Sub2API quota-limited windows',()=>{
  const adapters=createControlAdapters({relays:[{origin:'https://new.example',protocol:'new-api-key'},{origin:'https://sub.example',protocol:'sub2api-key'}]});
  const api=adapters.find(a=>a.manifest.id.startsWith('relay-new-api-key'))!;
  assert.equal(api.normalize({code:true,message:'ok',data:{total_available:1500000}},at).balances?.[0].amount.value,'3');
  const sub=adapters.find(a=>a.manifest.id.startsWith('relay-sub2api-key'))!;
  const out=sub.normalize({mode:'quota_limited',rate_limits:[{window:'1d',limit:300,remaining:200,used:100,reset_at:'2026-10-22T00:00:00Z'},{window:'7d',limit:800,remaining:600,used:200}]},at);
  assert.deepEqual(out.metrics.map(m=>[m.unit,m.total,m.remaining,m.scope]),[['USD','300','200','key'],['USD','800','600','key']]);
  assert.equal(out.balances?.length??0,0);
});
test('Remote omitempty amount=0 keeps actual credits, not a percentage',()=>{
  const adapter=createControlAdapters().find(a=>a.manifest.id==='remote-magpie')!;
  const out=adapter.normalize({data:[{provider:'test',user:'a',asOf:at,windows:[{name:'Credits',used:0,limit:500,unit:'credits'}]}]},at);
  assert.equal(out.metrics[0].unit,'credits');assert.equal(out.metrics[0].remaining,'500');
});
test('Cursor Bot pools cannot mix accounts',async()=>{
  const adapter=new CursorAdapter(async url=>({status:200,headers:{get:()=>null},text:async()=>JSON.stringify(url.includes('get-sand')?{includedLimitZero:false,usagePercent:20}:url.endsWith('GetPlanInfo')?{planInfo:{planName:'Pro'}}:{})}));
  const token='e30.'+Buffer.from(JSON.stringify({sub:'user|1'})).toString('base64url')+'.sig';
  const get=(subject:string)=>adapter.collect({connectionId:subject,generation:1,reason:'scheduled',expectedSubject:subject,secret:JSON.stringify({accessToken:token,subject,source:'cursor'})});
  const [a,b]=await Promise.all([get('cursor:a'),get('cursor:b')]);
  assert.notEqual(a.metrics.find(m=>m.id==='grok-bot')?.poolId,b.metrics.find(m=>m.id==='grok-bot')?.poolId);
});
test('Remote origin approval is explicit and does not allow paths or redirects',async()=>{
  for(const url of ['http://remote.example','https://remote.example:8443','https://user@remote.example','https://remote.example/path'])assert.throws(()=>remoteOrigin(url));
  await assert.rejects(remoteAccountAdapter.collect({connectionId:'r',generation:1,reason:'probe',secret:JSON.stringify({origin:'https://remote.example',accessToken:'test'})}),/尚未确认/);
});
