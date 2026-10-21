import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccountAccess } from '../src/main/account-access';
import { SubCalService } from '../src/main/service';
import { SubCalDatabase } from '../src/main/db/database';
import { CredentialVault } from '../src/main/credentials';
import { manifests } from '../src/main/adapters';

test('browser authorization IPC saves credential in vault and schedules card without another add/bind action',async()=>{
  const root=process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'Temp','opencode'):os.tmpdir();
  const dir=fs.mkdtempSync(path.join(root,'subcal-login-ipc-'));
  let authorized=false,cancelled=0;
  const access=new AccountAccess({loginFactory:async providerId=>({url:'https://cursor.com/loginDeepControl?challenge=public',expiresAt:Date.now()+60000,intervalSeconds:1,cancel(){cancelled++;},async poll(){return authorized?{providerId,subject:'fixture-account',alias:'Fixture',secret:JSON.stringify({accessToken:'private-oauth-token',management:'static',subject:'fixture-account'})}:null;}})});
  const db=new SubCalDatabase(dir);
  const vault=new CredentialVault(dir,{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from([...Buffer.from(s)].map(n=>n^42)),decryptString:b=>Buffer.from([...b].map(n=>n^42)).toString()});
  const service=new SubCalService(db,vault,{collect:async()=>{throw new Error('Fixture does not query vendor');},cancel(){},close(){}},manifests,Date.now,access);
  const call=async(method:string,params:unknown)=>{
    const out=await service.handle({version:1,requestId:randomUUID(),idempotencyKey:randomUUID(),method,params});assert.equal(out.ok,true,out.ok?'':out.error.message);return out.ok?out.result as any:undefined;
  };
  try{
    const start=await call('accounts.loginStart',{providerId:'cursor'});
    assert.doesNotMatch(JSON.stringify(start),/private-oauth-token|accessToken|refreshToken/);
    assert.equal(db.listSubscriptions().length,0);
    authorized=true;
    const result=await call('accounts.loginPoll',{id:start.id});
    assert.equal(result.status,'complete');assert.ok(result.subscriptionId);assert.ok(result.connectionId);
    assert.doesNotMatch(JSON.stringify(result),/private-oauth-token|accessToken|refreshToken/);
    assert.equal(service.scheduler.job(result.connectionId)?.state,'queued');
    assert.equal(db.listSubscriptions().length,1);
    const repeated=await call('accounts.loginPoll',{id:start.id});assert.equal(repeated.subscriptionId,result.subscriptionId);assert.equal(db.listSubscriptions().length,1);
    assert.doesNotMatch(await call('data.export',{}),/private-oauth-token|accessToken|refreshToken/);
    await call('accounts.loginCancel',{id:start.id});assert.equal((await call('accounts.loginPoll',{id:start.id})).status,'expired');
    assert.ok(cancelled>0);
  }finally{service.close();fs.rmSync(dir,{recursive:true,force:true});}
});
