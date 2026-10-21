import { _electron } from 'playwright-core';
import electron from 'electron';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildElectron } from './build-electron.mjs';
import { build } from 'esbuild';

// Real Electron UI + IPC, synthetic pending authorization only. No browser opens,
// no vendor calls, no credentials issued. Completion is covered by IPC tests.
const profile=await fs.mkdtemp(path.join(process.env.LOCALAPPDATA,'Temp','opencode','subcal-login-ui-'));
const evidence=path.resolve('docs/evidence/full-service/login-ui');await fs.mkdir(evidence,{recursive:true});
const report={at:new Date().toISOString(),kind:'real-electron-synthetic-authorization',checks:[],errors:[],realAccountAuthorization:'pending'};
let app,server;
try{
  await buildElectron();
  const windowModule=path.join(profile,'login-window.cjs');
  await build({entryPoints:['src/main/login/window.ts'],outfile:windowModule,bundle:true,platform:'node',format:'cjs',external:['electron']});
  server=await createServer({cacheDir:path.join(profile,'vite-cache'),server:{port:0,strictPort:false,hmr:false}});await server.listen();
  const env={...process.env,SUBCAL_USER_DATA:profile,SUBCAL_DEV_URL:server.resolvedUrls.local[0]};delete env.ELECTRON_RUN_AS_NODE;delete env.SUBCAL_PREVIEW;
  app=await _electron.launch({executablePath:electron,args:['.'],env});const page=await app.firstWindow();
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'新增订阅',exact:true}).first().waitFor();
  await app.evaluate(async({shell,session})=>{
    globalThis.__loginOpened=[];globalThis.__loginRequests=[];
    shell.openExternal=async url=>{globalThis.__loginOpened.push(url);};
    await session.defaultSession.protocol.handle('https',request=>{
      globalThis.__loginRequests.push(new URL(request.url).origin+new URL(request.url).pathname);
      return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
    });
  });
  await page.getByRole('button',{name:'新增订阅',exact:true}).first().click();
  await page.getByRole('combobox',{name:'选择服务',exact:true}).click();
  await page.getByRole('option',{name:'Cursor · Grok Bot',exact:true}).click();
  assert.doesNotMatch(await page.locator('[role="dialog"]').innerText(),/打开终端|运行.*login|在原客户端/);
  await page.getByRole('button',{name:'登录 Cursor · Grok Bot',exact:true}).click();
  await page.getByRole('button',{name:'取消登录',exact:true}).waitFor();
  const opened=await app.evaluate(()=>globalThis.__loginOpened);
  assert.equal(opened.length,1);assert.equal(new URL(opened[0]).origin,'https://cursor.com');
  report.checks.push('真实窗口点击登录，通过真实 IPC 创建 PKCE 授权并自动请求打开浏览器（测试拦截）');
  await page.getByText('正在等待授权，完成后自动保存账号、建卡并读取权益。',{exact:true}).waitFor();
  const aliases=await page.evaluate(async()=> (await (await import('/src/renderer/service/client.ts')).client.discoverAccounts()).accounts.map(a=>a.alias));
  await page.screenshot({path:path.join(evidence,'cursor-login.png'),animations:'disabled',mask:aliases.map(alias=>page.getByText(alias,{exact:false}))});
  await page.getByRole('button',{name:'取消登录',exact:true}).click();
  await page.getByRole('button',{name:'登录 Cursor · Grok Bot',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'取消登录',exact:true}).count(),0);
  report.checks.push('取消登录回到可重试状态，没有创建订阅');
  const snapshot=await page.evaluate(async()=> (await import('/src/renderer/service/client.ts')).client.snapshot());assert.equal(snapshot.subscriptions.length,0);
  const isolated=await app.evaluate(async({session,BrowserWindow},modulePath)=>{
    const original=session.fromPartition;
    session.fromPartition=(...args)=>{
      const target=original(...args);
      if(String(args[0]).startsWith('subcal-login-'))target.protocol.handle('https',()=>new Response('<!doctype html><title>Provider fixture</title><script>localStorage.setItem("fixture-token","private-fixture");</script>',{headers:{'Content-Type':'text/html'}}));
      return target;
    };
    let window;
    try{
      const {openLoginWindow}=process.mainModule.require(modulePath);
      window=await openLoginWindow('https://stepfun.com/login',{allowedOrigins:['https://stepfun.com'],title:'登录窗口检查'});
      const actual=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='https://stepfun.com/login');
      const prefs=actual.webContents.getLastWebPreferences();
      const privateToken=await window.evaluate('localStorage.getItem("fixture-token")');
      const output={readInMain:privateToken==='private-fixture',sandbox:prefs.sandbox,nodeDisabled:!prefs.nodeIntegration,noPreload:!prefs.preload,isolated:actual.webContents.session!==session.defaultSession};
      window.close();output.closed=window.closed();return output;
    }finally{window?.close();session.fromPartition=original;}
  },windowModule);
  assert.deepEqual(isolated,{readInMain:true,sandbox:true,nodeDisabled:true,noPreload:true,isolated:true,closed:true});
  report.checks.push('隔离供应商窗口真实加载：独立会话、sandbox、无 Node/preload，凭据仅主进程读取，关闭清理');
  assert.deepEqual(report.errors,[]);
}catch(error){report.errors.push(error instanceof Error?error.message:'check failed');throw error;}
finally{await app?.close();await server?.close();await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));await fs.rm(profile,{recursive:true,force:true});}
console.log(JSON.stringify(report,null,2));
