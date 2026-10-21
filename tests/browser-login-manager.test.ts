import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserLoginManager } from '../src/main/login/manager';
import type { AccountCredential } from '../src/main/account-access';
import type { LoginFlow } from '../src/main/login/types';
import { REGISTERED_LOGIN_PROVIDERS } from '../src/main/login';
import { BROWSER_LOGIN_PROVIDERS } from '../src/shared/login-providers';

test('every advertised application login is registered in main',()=>{
  assert.deepEqual([...BROWSER_LOGIN_PROVIDERS].sort(),[...REGISTERED_LOGIN_PROVIDERS].sort());
  assert.equal(new Set(BROWSER_LOGIN_PROVIDERS).size,BROWSER_LOGIN_PROVIDERS.length);
});

const credential:AccountCredential={providerId:'fixture',subject:'account',alias:'Fixture',secret:'private-token'};
const createFlow=(poll:LoginFlow['poll'],cancel=()=>{}):LoginFlow=>({url:'https://auth.example.test/login',userCode:'PUBLIC-CODE',expiresAt:60000,intervalSeconds:2,poll,cancel});

test('browser ticket never exposes credentials; concurrent polls coalesce and completed result is retryable',async()=>{
  let resolve!:(value:AccountCredential|null)=>void,calls=0,cancelled=0;
  const manager=new BrowserLoginManager(async()=>createFlow(()=>{calls++;return new Promise(r=>resolve=r);},()=>cancelled++),{now:()=>0,fetch});
  const ticket=await manager.start('fixture');
  assert.doesNotMatch(JSON.stringify(ticket),/private-token|subject|secret/);
  const a=manager.poll(ticket.id),b=manager.poll(ticket.id);
  resolve(credential);
  assert.equal((await a).credential?.subject,'account');assert.deepEqual(await b,await a);assert.equal(calls,1);
  assert.equal((await manager.poll(ticket.id)).status,'complete');assert.equal(cancelled,1);
  manager.cancel(ticket.id);assert.equal((await manager.poll(ticket.id)).status,'expired');manager.close();
});

test('cancel and newer authorization discard late tokens, including starts not yet returned',async()=>{
  let complete!:(c:AccountCredential|null)=>void;
  const manager=new BrowserLoginManager(async()=>createFlow(()=>new Promise(r=>complete=r)),{now:()=>0,fetch});
  const ticket=await manager.start('fixture');const pending=manager.poll(ticket.id);manager.cancel(ticket.id);complete(credential);
  assert.equal((await pending).status,'expired');manager.close();
  let first!:(flow:LoginFlow)=>void,count=0,disposed=0;
  const starting=new BrowserLoginManager(async()=>++count===1?new Promise(r=>first=r):createFlow(async()=>null),{now:()=>0,fetch});
  const older=starting.start('fixture');await starting.start('fixture');first(createFlow(async()=>null,()=>disposed++));
  await assert.rejects(older,/替代/);assert.equal(disposed,1);starting.close();
});

test('bounded polling, explicit submission and expiry clean authorization state',async()=>{
  let now=0,calls=0,submitted='';
  const manager=new BrowserLoginManager(async()=>({...createFlow(async()=>{calls++;return null;}),submit:async code=>{submitted=code;}}),{now:()=>now,fetch});
  const ticket=await manager.start('fixture');assert.equal(ticket.requiresCode,true);
  await manager.submit(ticket.id,'provider-code');assert.equal(submitted,'provider-code');
  await manager.poll(ticket.id);await manager.poll(ticket.id);assert.equal(calls,1);
  now=2000;await manager.poll(ticket.id);assert.equal(calls,2);
  now=60000;assert.equal((await manager.poll(ticket.id)).status,'expired');await assert.rejects(manager.submit(ticket.id,'late'));
  manager.close();
});

test('invalid returned provider never becomes a saved account',async()=>{
  const manager=new BrowserLoginManager(async()=>createFlow(async()=>({...credential,providerId:'another'})),{now:()=>0,fetch});
  const ticket=await manager.start('fixture');await assert.rejects(manager.poll(ticket.id),/不一致/);
  assert.equal((await manager.poll(ticket.id)).status,'expired');manager.close();
});

test('only the exact active login URL can open a local authorization page',async()=>{
  const manager=new BrowserLoginManager(async()=>({...createFlow(async()=>null),url:'http://127.0.0.1:18432/start?nonce=random'}),{now:()=>0,fetch});
  const ticket=await manager.start('fixture');
  assert.equal(manager.ownsUrl(ticket.verificationUri),true);
  assert.equal(manager.ownsUrl('http://127.0.0.1:18432/start?nonce=wrong'),false);
  manager.cancel(ticket.id);assert.equal(manager.ownsUrl(ticket.verificationUri),false);manager.close();
});

test('provider window opens only through an active main-process flow',async()=>{
  let opens=0;
  const manager=new BrowserLoginManager(async()=>({...createFlow(async()=>null),open:async()=>{opens++;}}),{now:()=>0,fetch});
  const ticket=await manager.start('fixture');
  assert.equal(await manager.openUrl(ticket.verificationUri+'?other=1'),false);
  assert.equal(await manager.openUrl(ticket.verificationUri),true);assert.equal(opens,1);
  manager.cancel(ticket.id);assert.equal(await manager.openUrl(ticket.verificationUri),false);manager.close();
});
