import { _electron } from 'playwright-core';
import electron from 'electron';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildElectron } from './build-electron.mjs';

// Real Electron, real local credential discovery, real read-only provider calls.
// This script never writes the source clients' configurations or prints credentials/identities.
const evidenceArg=process.argv.indexOf('--evidence');
const evidence=path.resolve(evidenceArg>=0 ? process.argv[evidenceArg+1] : 'docs/evidence/BE-012');
const temp=path.join(process.env.LOCALAPPDATA,'Temp','opencode');
const profile=await fs.mkdtemp(path.join(temp,'subcal-account-check-'));
await fs.mkdir(evidence,{recursive:true});
await buildElectron();
const server=await createServer({cacheDir:path.join(profile,'vite-cache'),server:{port:0,strictPort:false,hmr:false}});
await server.listen();
const env={...process.env,SUBCAL_USER_DATA:profile,SUBCAL_DEV_URL:server.resolvedUrls.local[0]};
delete env.ELECTRON_RUN_AS_NODE;delete env.SUBCAL_PREVIEW;
const report={at:new Date().toISOString(),platform:process.platform,userAcceptance:'pending',checks:[],services:[],errors:[]};
let app,page;
async function launch(){app=await _electron.launch({executablePath:electron,args:['.'],env});page=await app.firstWindow();page.on('pageerror',()=>report.errors.push('Renderer error'));await page.getByRole('button',{name:'新增订阅',exact:true}).first().waitFor({timeout:30000});}
async function state(){return page.evaluate(async()=> (await import('/src/renderer/service/client.ts')).client.snapshot());}
async function screenshot(name){
  const s=await state();const masks=s.subscriptions.filter(x=>x.account).map(x=>page.getByText(x.account,{exact:false}));
  await page.screenshot({path:path.join(evidence,name),animations:'disabled',mask:masks});
}
try{
  await launch();
  await page.getByRole('button',{name:'新增订阅',exact:true}).first().click();
  const discovered=await page.evaluate(async()=> (await import('/src/renderer/service/client.ts')).client.discoverAccounts());
  report.checks.push('真实 Electron 添加入口已打开，后台自动发现已调用');
  const availableProviders=await page.evaluate(async()=> (await import('/src/renderer/service/account-providers.ts')).PROVIDERS.map(p=>p.id));
  const providers=process.argv.includes('--all-services') ? [...new Set([...discovered.accounts.map(a=>a.providerId),...availableProviders])] : ['codex-local','claude-local','copilot-local','deepseek-balance','kimi-platform-cn','openrouter-key'];
  for(const providerId of providers){
    const candidates=discovered.accounts.filter(a=>a.providerId===providerId);
    const entry={providerId,discovered:candidates.length,status:'待验证',checks:[],blocker:''};report.services.push(entry);
    if(!candidates.length){entry.blocker='本机未发现可用真实凭据；授权登录与权益尚待真实账号验证';continue;}
    const candidate=candidates[0];
    // First Codex is added by an actual UI click; the others exercise the same IPC.
    let added;
    if(providerId==='codex-local'){
      const row=page.locator('section').filter({hasText:candidate.alias}).getByRole('button',{name:'加入',exact:true}).first();
      await row.click({timeout:15000});
      await page.waitForFunction(async()=>{const s=await (await import('/src/renderer/service/client.ts')).client.snapshot();return s.subscriptions.some(x=>x.product==='Codex');});
      const s=await state(),sub=s.subscriptions.find(x=>x.product==='Codex');added={subscriptionId:sub.id,connectionId:sub.connectionId};
      entry.checks.push('在真实窗口选择已发现账号后生成卡片');
    }else added=await page.evaluate(async id=>(await import('/src/renderer/service/client.ts')).client.addAccount({candidateId:id}),candidate.id);
    let s,conn;
    const deadline=Date.now()+65000;
    do {
      s=await state();conn=s.connections.find(x=>x.id===added.connectionId);
      if(conn&&(conn.lastSuccess||conn.error)&&conn.state!=='refreshing')break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }while(Date.now()<deadline);
    assert.ok(conn&&(conn.lastSuccess||conn.error),'后台查询未在65秒内给出成功或错误结果');
    const sub=s.subscriptions.find(x=>x.id===added.subscriptionId);
    assert.ok(sub);entry.checks.push('后台自动尝试查询，无需读取或绑定');
    entry.state=conn.state;entry.errorCode=conn.error?.code??null;
    entry.metrics=sub.metrics.map(m=>({label:m.label,unit:m.unit,availability:m.remaining.availability,hasObservedAt:Boolean(m.remaining.observedAt)}));
    entry.entitlementFields=Object.keys(sub.entitlements??{});
    if(conn.lastSuccess){entry.status='真实权益查询通过，完整生命周期仍待验证';entry.checks.push('供应商实际返回权益');}
    else{entry.blocker=`实际查询未成功（${conn.error?.code??conn.state}），账号与卡片保留`;entry.checks.push('查询失败保留已添加账号');}
    const before=JSON.stringify(sub.metrics),plan=JSON.stringify(sub.plan),entitlements=JSON.stringify(sub.entitlements),balances=JSON.stringify(sub.balances);
    await page.evaluate(async sub=>{const client=(await import('/src/renderer/service/client.ts')).client;await client.update(sub.id,sub.revision,{notes:'BE-012 真实桌面验证',metrics:[],plan:{...sub.plan,value:'不得覆盖'}});},sub);
    const after=(await state()).subscriptions.find(x=>x.id===sub.id);assert.equal(JSON.stringify(after.metrics),before);assert.equal(JSON.stringify(after.plan),plan);
    assert.equal(JSON.stringify(after.entitlements),entitlements);assert.equal(JSON.stringify(after.balances),balances);
    entry.checks.push('编辑资料不能篡改自动额度与套餐');
    const repeated=await page.evaluate(async id=>(await import('/src/renderer/service/client.ts')).client.addAccount({candidateId:id}),candidate.id);
    assert.equal(repeated.subscriptionId,added.subscriptionId);entry.checks.push('重复加入保持同一卡片');
    if(providerId==='codex-local'&&process.argv.includes('--all-services')){
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:/查看 Codex 详情/}).first().click();
      await page.getByRole('button',{name:'编辑实际支付',exact:true}).click();
      await page.getByLabel('实际支付金额',{exact:true}).fill('12.34');
      assert.equal(await page.locator('input[type="date"]').count(),0,'自动账号仍暴露日期编辑');
      await page.getByRole('button',{name:'保存账单资料',exact:true}).click();
      const paid=(await state()).subscriptions.find(x=>x.id===sub.id);
      assert.equal(paid.price.value,'12.34');assert.deepEqual(paid.metrics,after.metrics);assert.deepEqual(paid.entitlements,after.entitlements);
      entry.checks.push('真实窗口编辑实际支付并保存，未出现日期输入，自动权益不变');
      await page.keyboard.press('Escape');
    }
    if(providerId==='codex-local'&&process.argv.includes('--payment-ui')){
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:/查看 Codex 详情/}).first().click();
      await page.getByRole('button',{name:'编辑实际支付',exact:true}).click();
      await page.getByLabel('实际支付金额',{exact:true}).fill('12.34');
      assert.equal(await page.locator('input[type="date"]').count(),0,'自动订阅不得有日期编辑');
      await page.getByRole('button',{name:'保存账单资料',exact:true}).click();
      const paid=(await state()).subscriptions.find(x=>x.id===sub.id);
      assert.equal(paid.price.value,'12.34');assert.equal(JSON.stringify(paid.metrics),before);assert.equal(JSON.stringify(paid.entitlements),entitlements);
      entry.checks.push('实际桌面打开支付编辑并保存，自动套餐、日期、额度不变且无日期输入');
      await page.keyboard.press('Escape');
    }
    if(providerId==='codex-local'&&conn.lastSuccess&&process.argv.includes('--wait-update')) {
      const firstSuccess=conn.lastSuccess,until=Date.now()+330000;
      let updated;
      do {
        updated=(await state()).connections.find(c=>c.id===added.connectionId);
        if(updated.lastSuccess&&updated.lastSuccess!==firstSuccess)break;
        await new Promise(resolve=>setTimeout(resolve,1000));
      }while(Date.now()<until);
      assert.ok(updated.lastSuccess&&updated.lastSuccess!==firstSuccess,'自动更新未在预定周期内成功');
      entry.checks.push('等待实际五分钟周期，第二次后台查询自动完成');
    }
  }
  // Screenshot only the main view, masking discovered aliases in account cards.
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'概览',exact:true}).first().click();
  const expectedCards=(await state()).subscriptions.length;
  if(expectedCards)await page.locator('.sub-card').first().waitFor();
  await screenshot('accounts-real.png');
  if(process.argv.includes('--all-services'))for(const width of [1280,960]){
    await page.setViewportSize({width,height:900});
    await screenshot(`accounts-${width}.png`);
    const layout=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.sub-card')].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:r.width,height:r.height,padding:s.padding,borderRadius:s.borderRadius,overflow:el.scrollWidth>el.clientWidth};})}));
    assert.ok(!expectedCards||layout.cards.length>0,'已有订阅但没有渲染卡片');
    assert.ok(layout.cards.every(card=>!card.overflow),'卡片内部出现横向溢出');
    assert.ok(layout.page<=layout.viewport,'页面出现横向溢出');report.checks.push(`${width}px 真实窗口无页面横向溢出`);
    (report.layouts??=[]).push(layout);
  }
  const before=await state();
  await app.close();app=null;await launch();
  const after=await state();assert.deepEqual(after.subscriptions.map(x=>x.id).sort(),before.subscriptions.map(x=>x.id).sort());
  report.checks.push('完整退出与重启后账号和订阅持久化');
  const backup=await page.evaluate(async()=> (await import('/src/renderer/service/client.ts')).client.exportData());
  assert.doesNotMatch(backup,/"(?:accessToken|refreshToken|access_token|refresh_token|secret|locator)"\s*:/);
  report.checks.push('普通备份不含凭据字段');
  await screenshot('accounts-restarted.png');
}catch(error){report.errors.push(error instanceof Error?error.message.replace(/[A-Z]:\\Users\\[^\\]+/gi,'[profile]'):'verification failed');throw error;}
finally{
  await app?.close();await server.close();
  await fs.writeFile(path.join(evidence,'real-desktop-report.json'),JSON.stringify(report,null,2));
  await fs.rm(profile,{recursive:true,force:true});
}
console.log(JSON.stringify(report,null,2));
