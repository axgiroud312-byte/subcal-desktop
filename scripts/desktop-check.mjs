import { _electron } from 'playwright-core';
import electron from 'electron';
import { build } from 'esbuild';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const evidence=path.resolve('docs/evidence/visual-v2');
const tempRoot=process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA,'Temp','opencode') : process.cwd();
const profile=await fs.mkdtemp(path.join(tempRoot,'subcal-desktop-'));
await fs.mkdir(evidence,{recursive:true});
const common={bundle:true,platform:'node',format:'cjs',target:'node20',external:['electron'],logLevel:'silent'};
await Promise.all([build({...common,entryPoints:['src/main/main.ts'],outfile:'dist-electron/main.cjs'}),build({...common,entryPoints:['src/preload/preload.ts'],outfile:'dist-electron/preload.cjs'})]);
const server=await createServer({cacheDir:path.join(profile,'vite-cache'),server:{port:5174,strictPort:true,hmr:false}});await server.listen();
const env={...process.env,SUBCAL_USER_DATA:profile,SUBCAL_DEV_URL:'http://127.0.0.1:5174/'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;
const errors=[];const checks=[];
const foundationOnly=process.argv.includes('--foundation-only');
const shellOnly=process.argv.includes('--shell-only');
const runFlows=!process.argv.includes('--native-only')&&!foundationOnly&&!shellOnly;
const match=process.argv.find(argument=>argument.startsWith('--match='))?.slice(8);
const report={platform:process.platform,at:new Date().toISOString(),checks,screenshots:[],visualChecks:[],userAcceptance:'pending',limitations:['macOS 未实测','原生文件选择器由自动化指定路径；文件读写和导入逻辑为实际执行','首次关闭说明由自动化确认；托盘图标通过 Windows UI Automation 操作，退出使用真实菜单回调'],desktop:null};
async function launch(){
  app=await _electron.launch({executablePath:electron,args:['.'],env});page=await app.firstWindow();
  page.on('pageerror',error=>errors.push(error.stack||error.message));
  await page.waitForSelector('.top-nav');await page.waitForFunction(()=>Boolean(window.subcal));
}
async function state(){return page.evaluate(async()=>{const {client}=await import('/src/renderer/service/MockSubCalClient.ts');return client.snapshot();});}
async function waitState(predicate){
  const start=Date.now();while(Date.now()-start<10000){const s=await state();if(predicate(s))return s;await page.waitForTimeout(40);}throw new Error('Timed out waiting for expected saved UI state');
}
async function nav(name){await page.getByRole('button',{name,exact:true}).first().click();}
async function shot(name,scrollToTop=true){
  await page.evaluate(scrollToTop=>{if(scrollToTop)window.scrollTo(0,0);document.querySelectorAll('.modal-body').forEach(e=>e.scrollTop=0);},scrollToTop);
  const metadata=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,scenario:document.querySelector('.app')?.getAttribute('data-scenario'),innerWidth,innerHeight,devicePixelRatio,rootFont:getComputedStyle(document.documentElement).fontSize}));
  const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  await page.screenshot({path:path.join(evidence,name),animations:'disabled'});
  report.screenshots=report.screenshots.filter(item=>item.file!==name);
  report.screenshots.push({file:name,...metadata,scenario:(await state()).scenario,bounds});
}
async function nativeScript(file,args={}){
  const quote=s=>`'${String(s).replaceAll("'","''")}'`;
  const command=`& ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath ${quote(path.resolve('scripts',file))}))) ${Object.entries(args).map(([k,v])=>`-${k} ${quote(v)}`).join(' ')}`;
  try{return await exec('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{timeout:30000});}
  catch(error){const details=[...(error.stderr||'').matchAll(/<S S="Error">([^<]*)/g)].map(m=>m[1].replaceAll('_x000D__x000A_','')).join('\n');throw new Error(`${file}: ${details.slice(0,1500)||error.message}`);}
}
async function check(name,fn){if(match&&!new RegExp(match).test(name)&&!name.startsWith('原生 Electron'))return;await fn();checks.push(name);console.log(`PASS ${name}`);}
async function selectValue(control,value){
  if(await control.evaluate(element=>element.tagName==='SELECT')) { await control.selectOption(value); return; }
  await control.click();
  await page.locator(`[role="option"][data-value="${value}"]`).click();
}
async function setSwitch(control,checked){if(await control.getAttribute('aria-checked')!==String(checked))await control.click();}
async function scenario(id){
  const select=page.getByRole('combobox',{name:'切换演示场景',exact:true});
  if(!await select.isVisible())await page.getByRole('button',{name:/预览工具/}).click();
  await selectValue(select,id);await waitState(s=>s.scenario===id).catch(error=>{throw new Error(`Scenario ${id}: ${error.message}`);});
  await page.waitForFunction(id=>document.querySelector('.app')?.getAttribute('data-scenario')===id,id);
}
async function resetCurrentScenario(){
  const button=page.getByRole('button',{name:'重置当前场景…',exact:true});
  if(!await button.isVisible())await page.getByRole('button',{name:/预览工具/}).click();
  await button.click();await page.getByRole('button',{name:'确认重置当前场景',exact:true}).click();
  await page.getByRole('alertdialog').waitFor({state:'hidden'});
}
const dialog=()=>page.locator('[role="dialog"]:visible,[role="alertdialog"]:visible').last();
async function closeDialog(){await dialog().locator('.modal-close').click();}
// Screenshot-only cleanup: dismiss atomically so the short-lived toast cannot
// expire between an actionability check and the click. Undo is tested normally.
async function hideToast(){await page.evaluate(()=>document.querySelector('[data-sonner-toast] [data-close-button]')?.click());}
async function noHorizontalOverflow(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);}
async function focusWithin(role){await page.waitForFunction(role=>Boolean(document.activeElement?.closest(`[role="${role}"]`)),role,{timeout:5000});}
function contrast(a,b){
  const luminance=color=>{
    const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{const s=value/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  };
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
async function auditVisualTokens(){
  const actual=await page.evaluate(()=>{
    const probe=document.createElement('span');document.body.append(probe);
    const color=name=>{probe.style.color=`var(--${name})`;return getComputedStyle(probe).color;};
    const colors=Object.fromEntries(['foreground','background','card','muted-foreground','input','ring','primary','primary-foreground','warning','warning-soft','destructive','destructive-soft'].map(name=>[name,color(name)]));
    probe.remove();
    const metrics=Array.from(document.querySelectorAll('.quota-value')).map(element=>({size:getComputedStyle(element).fontSize,weight:getComputedStyle(element).fontWeight}));
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
    const rgb=()=>{const [r,g,b]=context.getImageData(0,0,1,1).data;return `rgb(${r}, ${g}, ${b})`;};
    const samples=['.btn-add-sub','.quota-label','.quota-value','.card-account-name','.preview-dock-summary'].flatMap(selector=>{
      const element=document.querySelector(selector);if(!element)return [];
      const layers=[];let parent=element;while(parent){layers.unshift(getComputedStyle(parent).backgroundColor);parent=parent.parentElement;}
      context.clearRect(0,0,1,1);context.fillStyle=colors.background;context.fillRect(0,0,1,1);
      for(const layer of layers){context.fillStyle=layer;context.fillRect(0,0,1,1);}const background=rgb();
      context.clearRect(0,0,1,1);context.fillStyle=getComputedStyle(element).color;context.fillRect(0,0,1,1);
      return [{selector,foreground:rgb(),background,weight:getComputedStyle(element).fontWeight,size:getComputedStyle(element).fontSize}];
    });
    const overweight=Array.from(document.querySelectorAll('body *')).filter(element=>element.children.length===0&&element.textContent?.trim()&&element.getBoundingClientRect().height>0&&Number(getComputedStyle(element).fontWeight)>600).slice(0,12).map(element=>({text:element.textContent.slice(0,80),weight:getComputedStyle(element).fontWeight}));
    const headerControls=Array.from(document.querySelectorAll('.top-nav button')).map(element=>({name:element.getAttribute('aria-label')||element.textContent.trim(),height:element.getBoundingClientRect().height,size:getComputedStyle(element).fontSize,weight:getComputedStyle(element).fontWeight}));
    return {theme:document.documentElement.dataset.theme,rootFont:getComputedStyle(document.documentElement).fontSize,fontFamily:getComputedStyle(document.body).fontFamily,colors,metrics,samples,overweight,headerControls};
  });
  const session=await page.context().newCDPSession(page);
  try {await session.send('DOM.enable');await session.send('CSS.enable');const {root}=await session.send('DOM.getDocument');const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.quota-label'});if(nodeId)actual.platformFonts=(await session.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;}finally{await session.detach();}
  const pairs=[['foreground','card',4.5],['muted-foreground','card',4.5],['muted-foreground','background',4.5],['primary-foreground','primary',4.5],['warning','warning-soft',4.5],['destructive','destructive-soft',4.5],['input','card',3],['ring','card',3]];
  actual.contrasts=pairs.map(([fg,bg,min])=>({fg,bg,minimum:min,ratio:Number(contrast(actual.colors[fg],actual.colors[bg]).toFixed(2))}));
  assert.equal(actual.rootFont,'16px');
  for(const entry of actual.contrasts)assert.ok(entry.ratio>=entry.minimum,`${actual.theme} ${entry.fg}/${entry.bg} contrast ${entry.ratio}`);
  for(const metric of actual.metrics)assert.ok(Number(metric.weight)<=600,`quota weight ${metric.weight}`);
  for(const sample of actual.samples){sample.contrast=Number(contrast(sample.foreground,sample.background).toFixed(2));assert.ok(sample.contrast>=4.5,`${actual.theme} ${sample.selector} contrast ${sample.contrast}`);}
  assert.deepEqual(actual.overweight,[],'业务 UI 不应残留 700 / 800 字重');
  for(const control of actual.headerControls){assert.ok(control.height>=32,`${control.name} must keep a 32px hit target`);assert.equal(control.size,'13px');assert.equal(control.weight,'500');}
  report.visualChecks.push(actual);
}

try{
  await launch();
  report.desktop=await app.evaluate(({BrowserWindow,screen})=>({bounds:BrowserWindow.getAllWindows()[0].getBounds(),display:screen.getPrimaryDisplay(),preferences:BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()}));
  await check('原生 Electron 窗口、实际 DPI 与隔离桥',async()=>{
    assert.equal(report.desktop.preferences.contextIsolation,true);assert.equal(report.desktop.preferences.sandbox,true);assert.equal(report.desktop.preferences.nodeIntegration,false);
    assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
    assert.equal(await page.evaluate(async()=>{try{await window.subcal.openExternal('javascript:alert(1)');return false;}catch{return true;}}),true);
  });
  // UI flow assertions are kept here rather than installing another test runner.
  if(foundationOnly) await check('Mira / Base UI 嵌套 Portal、主题、Recharts Tooltip / Legend / 空数据与窄宽度',async()=>{
    await scenario('normal_mixed');
    for(const theme of ['light','dark']){
      if((await state()).preferences.theme!==theme)await page.getByRole('button',{name:'切换深浅色主题'}).click();
      await page.getByTestId('open-preview-dialog-btn').click();await page.getByTestId('dialog-select-trigger').click();
      const popup=page.getByTestId('dialog-select-content');await popup.waitFor({state:'visible'});
      assert.equal(await popup.evaluate(element=>getComputedStyle(element).backgroundColor),theme==='light'?'rgb(255, 255, 255)':'rgb(34, 34, 38)');
      await page.keyboard.press('Escape');assert.equal(await page.getByTestId('preview-dialog-content').isVisible(),true);
      await page.getByTestId('dialog-select-trigger').click();await page.getByRole('option',{name:'按年续费（组件示例）',exact:true}).click();
      assert.match(await page.getByTestId('dialog-select-trigger').innerText(),/按年续费/);
      await page.getByRole('button',{name:'确认示例选择',exact:true}).click();await page.getByTestId('preview-dialog-content').waitFor({state:'hidden'});
      assert.equal(await page.getByTestId('open-preview-dialog-btn').evaluate(element=>element===document.activeElement),true);
      await auditVisualTokens();
      const chart=page.getByTestId('preview-recharts-container');await chart.scrollIntoViewIfNeeded();await chart.locator('.recharts-bar-rectangle').first().hover();
      const tooltip=chart.locator('.recharts-tooltip-wrapper');await tooltip.waitFor({state:'visible'});assert.match(await tooltip.innerText(),/组件示例 · 非实际消费/);
      const chartStyle=await chart.evaluate(element=>({theme:document.documentElement.dataset.theme,series1:getComputedStyle(element).getPropertyValue('--chart-1').trim(),series2:getComputedStyle(element).getPropertyValue('--chart-2').trim()}));
      report.visualChecks.push({component:'Recharts Tooltip / Legend',...chartStyle});
    }
    const tokenPropagation=await page.evaluate(()=>{
      const root=document.documentElement;
      const previous=root.style.getPropertyValue('--radius-md');
      const elements=[document.querySelector('.btn-add-sub'),document.querySelector('[data-slot="component-preview"] [data-slot="input"]'),document.querySelector('[data-field="切换演示场景"]')];
      const before=elements.map(element=>getComputedStyle(element).borderRadius);
      try { root.style.setProperty('--radius-md','10px');return {token:'--radius-md',before,after:elements.map(element=>getComputedStyle(element).borderRadius)}; }
      finally { if(previous)root.style.setProperty('--radius-md',previous);else root.style.removeProperty('--radius-md'); }
    });
    assert.deepEqual(tokenPropagation.after,['10px','10px','10px']);report.visualChecks.push(tokenPropagation);
    const chart=page.getByTestId('preview-recharts-container');await chart.scrollIntoViewIfNeeded();await chart.locator('.recharts-bar-rectangle').first().hover();
    const tooltip=chart.locator('.recharts-tooltip-wrapper');await tooltip.waitFor({state:'visible'});assert.match(await tooltip.innerText(),/组件示例 · 非实际消费/);
    assert.match(await chart.innerText(),/固定周期指标.*组件示例/s);assert.match(await chart.innerText(),/滚动窗口指标.*组件示例/s);
    await page.getByTestId('toggle-chart-empty-btn').click();assert.equal(await page.getByTestId('chart-empty-state').isVisible(),true);
    await page.getByTestId('toggle-chart-empty-btn').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,640));
    await noHorizontalOverflow();assert.ok((await chart.boundingBox()).width>200);
    await page.getByTestId('open-preview-dialog-btn').click();await shot('foundation-narrow-dark.png');await page.getByRole('button',{name:'确认示例选择',exact:true}).click();
  });
  if(shellOnly) await check('桌面壳 1280 / 960 四页导航、新增、设置与主题 Portal',async()=>{
    for(const [width,height] of [[1280,820],[960,640]]){
      await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),[width,height]);
      for(const name of ['订阅','日历','连接','概览']){
        await nav(name);assert.equal(await page.getByRole('button',{name,exact:true}).first().getAttribute('aria-current'),'page');
      }
      assert.equal(await page.locator('.top-nav').evaluate(element=>element.scrollWidth<=innerWidth),true);
      await page.locator('.top-nav').getByRole('button',{name:'新增订阅',exact:true}).click();await page.locator('#sub-product').waitFor({state:'visible'});await closeDialog();
      await page.getByRole('button',{name:'打开设置与备份'}).click();assert.match(await dialog().innerText(),/显示与提醒/);await closeDialog();
      await page.getByRole('button',{name:'切换深浅色主题'}).click();
    }
  });
  if(runFlows) await check('四页导航与十二场景入口',async()=>{
    for(const name of ['订阅','日历','连接','概览'])await nav(name);
    for(const id of ['empty_first_run','normal_mixed','multi_account_shared','unknown_and_na','zero_vs_unfetched','stale_and_past_reset','partial_success','auth_and_locked_fields','rate_limited','offline_recovery','date_boundaries','calendar_conflicts'])await scenario(id);
    await scenario('normal_mixed');assert.equal((await state()).subscriptions.length,7);
  });
  if(runFlows) {
    await check('键盘新增、未保存保护、编辑与日历联动、删除撤销',async()=>{
      await scenario('empty_first_run');
      const add=page.locator('.top-nav').getByRole('button',{name:'新增订阅',exact:true});await add.focus();await page.keyboard.press('Enter');
      await dialog().getByRole('button',{name:'创建订阅',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#sub-product')?.getAttribute('aria-invalid')==='true');
      assert.ok((await page.locator('[data-slot="field-error"]').first().innerText()).length>0,'必填错误必须有可读文本，不能只有红框');assert.equal((await state()).subscriptions.length,0);
      await page.locator('#sub-product').fill('桌面验证订阅');
      await page.locator('#sub-autorenew').click();await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('alertdialog').count(),0,'嵌套 Select 的 Escape 不能打开父表单放弃确认');
      assert.equal(await page.locator('#sub-product').inputValue(),'桌面验证订阅');
      await page.keyboard.press('Escape');
      assert.equal(await dialog().getByText('有未保存的表单修改',{exact:true}).isVisible(),true);
      await page.keyboard.press('Escape');assert.equal(await dialog().isVisible(),true);
      await focusWithin('alertdialog');
      // Base UI's focus guards return focus on the next frame at either edge.
      // Assert the settled focus after every key instead of sampling the guard.
      for(let index=0;index<6;index++){await page.keyboard.press('Tab');await focusWithin('alertdialog');}
      await dialog().getByRole('button',{name:'继续编辑',exact:true}).click();
      await dialog().getByRole('button',{name:'创建订阅',exact:true}).click();
      let s=await waitState(s=>s.subscriptions.length===1);const id=s.subscriptions[0].id;assert.equal(s.subscriptions[0].renewalDate.value,null);
      await dialog().getByRole('button',{name:'编辑记录',exact:true}).click();
      await page.locator('#sub-price').fill('12.50');await page.locator('#sub-renewal-date').fill('2026-10-25');await selectValue(page.locator('#sub-autorenew'),'on');
      await dialog().getByRole('button',{name:'保存更改',exact:true}).click();await waitState(s=>s.subscriptions[0].price.value==='12.50');
      assert.match(await dialog().innerText(),/2026-10-25/);await closeDialog();
      assert.match(await page.locator('.sub-card').innerText(),/12.50/);await nav('日历');
      const day=page.locator('[data-date="2026-10-25"]');assert.match(await day.innerText(),/桌面验证订阅/);
       await day.getByRole('button').focus();await page.keyboard.press('Enter');await dialog().getByRole('button',{name:'编辑记录',exact:true}).click();
      await page.locator('#sub-renewal-date').fill('2026-10-28');await dialog().getByRole('button',{name:'保存更改',exact:true}).click();
      await closeDialog();await page.locator('[data-date="2026-10-28"]').getByRole('button').click();
      await dialog().getByRole('button',{name:'删除本地演示记录…',exact:true}).click();await dialog().getByRole('button',{name:'确认删除记录（8 秒内可撤销）',exact:true}).click();
      await waitState(s=>s.subscriptions.length===0);await page.getByRole('button',{name:'撤销删除 (8s)',exact:true}).click();s=await waitState(s=>s.subscriptions.length===1);assert.equal(s.subscriptions[0].id,id);assert.equal(s.subscriptions[0].anchorDate,'2026-10-28');
    });
    await check('编辑冲突保留输入、来源不变与品牌模板带入',async()=>{
      await nav('概览');await scenario('normal_mixed');
      await page.getByRole('button',{name:/查看 Codex 详情/}).click();await dialog().getByRole('button',{name:'编辑记录',exact:true}).click();
      await page.locator('#sub-notes').fill('保留这一份未保存输入');
      const before=(await state()).subscriptions.find(subscription=>subscription.id==='codex');
      await page.evaluate(async()=>{const {client}=await import('/src/renderer/service/MockSubCalClient.ts');const current=(await client.snapshot()).subscriptions.find(subscription=>subscription.id==='codex');await client.update(current.id,current.revision,{notes:'模拟并发编辑'});});
      await dialog().getByRole('button',{name:'保存更改',exact:true}).click();await dialog().getByText(/并发版本冲突|REVISION_CONFLICT/).first().waitFor();
      assert.equal(await page.locator('#sub-notes').inputValue(),'保留这一份未保存输入');
      await dialog().getByRole('button',{name:/基于最新版本号.*覆盖保存/}).click();
      const after=(await waitState(snapshot=>snapshot.subscriptions.find(subscription=>subscription.id==='codex').notes==='保留这一份未保存输入')).subscriptions.find(subscription=>subscription.id==='codex');
      assert.deepEqual(after.metrics,before.metrics);assert.deepEqual(after.renewalDate,before.renewalDate);await closeDialog();
      await nav('订阅');await page.getByRole('button',{name:/品牌目录/}).first().click();await page.locator('.catalog-grid').getByRole('button',{name:/^Codex/}).click();
      assert.equal(await page.locator('#sub-kind').getAttribute('data-current-value'),'window');assert.equal(await page.locator('#sub-price').inputValue(),'20.00');
      assert.match(await page.locator('#sub-plan').inputValue(),/Plus/);await closeDialog();
    });
    await check('列表归档恢复、菜单键盘与详情焦点返回',async()=>{
      await scenario('normal_mixed');await nav('订阅');
      const trigger=page.getByTestId('sub-row-menu-codex');await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'hidden'});
      assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
      await trigger.click();await page.getByRole('menuitem',{name:'归档并停止跟踪…',exact:true}).focus();await page.keyboard.press('Enter');
      await dialog().getByRole('button',{name:'确认归档',exact:true}).click();await waitState(snapshot=>snapshot.subscriptions.find(subscription=>subscription.id==='codex').lifecycle==='archived');
      await page.getByRole('group',{name:'归档状态筛选'}).getByRole('button',{name:/已归档/}).click();
      await page.getByTestId('sub-row-menu-codex').click();await page.getByRole('menuitem',{name:'恢复活跃跟踪',exact:true}).click();await dialog().getByRole('button',{name:'确认恢复',exact:true}).click();
      await waitState(snapshot=>snapshot.subscriptions.find(subscription=>subscription.id==='codex').lifecycle==='active');
      await page.getByRole('group',{name:'归档状态筛选'}).getByRole('button',{name:/活跃中/}).click();const title=page.getByRole('button',{name:'Codex',exact:true});await title.click();await closeDialog();
      assert.equal(await title.evaluate(element=>element===document.activeElement),true);
    });
    await check('多账号折叠、共享费用去重、独立额度与保存顺序',async()=>{
      await nav('概览');await scenario('empty_first_run');const otherSpace=(await state()).subscriptions;await scenario('multi_account_shared');
      const kimi=page.locator('.sub-card').filter({has:page.getByRole('button',{name:/查看 Kimi API 详情/})});
      assert.equal(await kimi.locator('.secondary-account-slot .card-account-partition').count(),0);
      await kimi.getByRole('button',{name:/展开其余/}).click();assert.match(await kimi.innerText(),/团队示例账号 3/);
      assert.equal(await kimi.getByRole('button',{name:'收起 团队示例账号 3 详情',exact:true}).isVisible(),true);
      assert.equal(await kimi.locator('.multi-expand-btn').evaluate(element=>element===document.activeElement),true);
      const s=await state();assert.equal(s.subscriptions.find(s=>s.id==='codex').billingGroupId,s.subscriptions.find(s=>s.id==='chatgpt').billingGroupId);assert.notEqual(s.subscriptions.find(s=>s.id==='codex').quotaPoolId,s.subscriptions.find(s=>s.id==='chatgpt').quotaPoolId);
      // Real dnd-kit pointer sorting: move the card's centre to its neighbour's.
      const initialIds=await page.locator('.sub-card').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-card-id')));
      report.sorting={initialIds,initialOrder:(await state()).preferences.order};
      const first=page.locator('.sub-card').first(),second=page.locator('.sub-card').nth(1);
      const handle=first.locator('.card-drag-handle');await handle.scrollIntoViewIfNeeded();
      const [sourceRect,targetRect,handleRect]=await Promise.all([first.boundingBox(),second.boundingBox(),handle.boundingBox()]);
      const x=handleRect.x+handleRect.width/2,y=handleRect.y+handleRect.height/2;
      await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+10,y,{steps:3});
      await page.mouse.move(x+targetRect.x+targetRect.width/2-sourceRect.x-sourceRect.width/2,y+targetRect.y+targetRect.height/2-sourceRect.y-sourceRect.height/2,{steps:12});await page.mouse.up();
      await waitState(snapshot=>snapshot.preferences.order[0]===initialIds[1]);
      await page.waitForFunction(id=>document.querySelector('.sub-card')?.getAttribute('data-card-id')===id,initialIds[1]);
      report.sorting.afterPointer=(await state()).preferences.order;
      // KeyboardSensor, not the old Alt shortcut, commits a second real sort.
      const keyboardHandle=page.locator('.sub-card').first().locator('.card-drag-handle');await keyboardHandle.focus();await page.keyboard.press('Space');
      await page.locator('.sub-card.is-dragging[data-sort-over="true"]').waitFor({state:'visible'});await page.keyboard.press('ArrowRight');
      await page.locator('.sub-card[data-sort-over="true"]:not(.is-dragging)').waitFor({state:'visible'});await page.keyboard.press('Space');
      report.sorting.afterKeyboard=(await state()).preferences.order;
      await waitState(snapshot=>snapshot.preferences.order[0]===initialIds[0]);
      await page.waitForFunction(id=>document.querySelector('.sub-card')?.getAttribute('data-card-id')===id,initialIds[0]);
      const beforeCancel=await state();await page.locator('.sub-card').first().locator('.card-drag-handle').focus();await page.keyboard.press('Space');
      await page.locator('.sub-card.is-dragging[data-sort-over="true"]').waitFor({state:'visible'});await page.keyboard.press('ArrowRight');
      await page.locator('.sub-card[data-sort-over="true"]:not(.is-dragging)').waitFor({state:'visible'});await page.keyboard.press('Escape');
      await page.locator('.sub-card.is-dragging').waitFor({state:'hidden'});assert.deepEqual((await state()).preferences.order,beforeCancel.preferences.order);assert.equal((await state()).revision,beforeCancel.revision);
      await page.getByRole('button',{name:'打开设置与备份'}).click();await setSwitch(dialog().getByRole('switch',{name:/减少动态效果/}),true);await closeDialog();
      assert.equal(await page.evaluate(async()=>{const {getMotionTransition}=await import('/src/renderer/lib/motion.ts');return getMotionTransition('normal').duration;}),0);
      await kimi.locator('.multi-expand-btn').click();await page.waitForFunction(()=>document.querySelectorAll('[data-card-id="kimi"] .secondary-account-slot .card-account-partition').length===0);
      const title=page.getByRole('button',{name:/查看 Codex 详情/});await title.focus();await page.keyboard.press('Alt+ArrowRight');await waitState(s=>s.preferences.order.length>0);
      const order=(await state()).preferences.order;await page.getByRole('button',{name:'切换深浅色主题'}).click();await waitState(s=>s.preferences.theme==='dark');
      await app.close();app=null;await launch();const saved=await state();assert.equal(saved.scenario,'multi_account_shared');assert.deepEqual(saved.preferences.order,order);assert.equal(saved.preferences.theme,'dark');assert.equal(saved.preferences.reducedMotion,true);
      await scenario('empty_first_run');assert.deepEqual((await state()).subscriptions,otherSpace,'切换、排序与重启不能改写另一个演示空间');
    });
    await check('零值、未知、过时与部分成功保持字段语义',async()=>{
      await scenario('unknown_and_na');
      assert.match(await page.locator('[data-card-id="codex"]').innerText(),/尚未获取/);assert.match(await page.locator('[data-card-id="codex"]').innerText(),/待补充/);
      assert.match(await page.locator('[data-card-id="codex"] .card-provenance-footer').innerText(),/模拟缺失字段（未获取）/,'未知字段不能借用另一个已知窗口的观察时间');
      assert.match(await page.locator('[data-card-id="deepseek"]').innerText(),/不适用/);assert.match(await page.locator('[data-card-id="copilot"]').innerText(),/无限量/);
      await scenario('zero_vs_unfetched');assert.match(await page.locator('.sub-card').filter({has:page.getByRole('button',{name:/查看 Codex 详情/})}).innerText(),/剩余 0%/);
      assert.match(await page.locator('[data-card-id="deepseek"]').innerText(),/¥0\.00/);
      assert.match(await page.locator('.sub-card').filter({has:page.getByRole('button',{name:/查看 Kimi API 详情/})}).innerText(),/尚未获取/);
      await scenario('stale_and_past_reset');assert.match(await page.locator('.sub-card').filter({has:page.getByRole('button',{name:/查看 Codex 详情/})}).innerText(),/预计已重置，尚待核实/);
      assert.match(await page.locator('[data-card-id="deepseek"]').innerText(),/86\.40/);assert.match(await page.locator('[data-card-id="deepseek"]').innerText(),/已过时/);
      await scenario('partial_success');const before=(await state()).subscriptions.find(s=>s.id==='deepseek');await page.locator('.top-nav').getByRole('button',{name:'模拟刷新',exact:true}).click();
      const done=await waitState(s=>s.connections.find(c=>c.id==='deepseek-balance').runs===1);const after=done.subscriptions.find(s=>s.id==='deepseek');assert.equal(after.plan.observedAt,before.plan.observedAt);assert.notEqual(after.metrics[0].remaining.observedAt,before.metrics[0].remaining.observedAt);
    });
    await check('认证恢复向导、限流时钟与离线合并补查',async()=>{
      await scenario('auth_and_locked_fields');await nav('连接');const card=page.getByRole('article',{name:'Codex 连接卡片'});
      await card.getByRole('button',{name:'模拟重新连接 / 探测恢复',exact:true}).click();await card.getByRole('button',{name:'2. 开始模拟探测',exact:true}).click();
      await card.getByRole('button',{name:/3. 确认绑定/}).click();await waitState(s=>s.connections[0].state==='ready');assert.equal((await state()).subscriptions[0].renewalDate.value,'2026-11-03');
      await scenario('rate_limited');await page.getByRole('button',{name:/推进.*5 分钟/}).first().click();await waitState(s=>s.now==='2026-10-20T01:05:00.000Z');
      await nav('概览');await page.locator('.top-nav').getByRole('button',{name:'模拟刷新',exact:true}).click();await waitState(s=>s.connections[0].runs===1);
      await scenario('offline_recovery');await page.getByRole('button',{name:'模拟恢复联网（合并补查一次）',exact:true}).click();await waitState(s=>s.connections.every(c=>c.runs===1));
    });
    await check('日期边界月历、键盘跨月与窄窗口日程保留',async()=>{
      await nav('日历');await scenario('date_boundaries');await page.getByRole('grid',{name:'2027-02 月历网格',exact:true}).waitFor();
      const end=page.locator('[data-date="2027-02-28"]');assert.match(await end.innerText(),/月末会员/);assert.match(await end.innerText(),/闰年年费/);
      assert.equal(await end.locator('.cal-event-pill').count(),2);
      await end.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-date')==='2027-03-01');
      assert.match(await page.locator('[data-date="2027-03-01"]').innerText(),/奥克兰日期会员/);
      assert.match(await page.locator('[data-date="2027-03-13"]').innerText(),/纽约时区会员/);assert.match(await page.locator('[data-date="2027-03-14"]').innerText(),/纽约时区会员/);
      const event=page.locator('[data-date="2027-03-14"] .cal-event-pill');await event.focus();await page.keyboard.press('Enter');await dialog().waitFor({state:'visible'});await closeDialog();
      assert.equal(await event.evaluate(element=>element===document.activeElement),true);
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,640));await page.getByRole('tab',{name:/日程列表/}).click();
      assert.match(await page.getByRole('complementary',{name:'日程列表与来源详情'}).innerText(),/2027-03-14/);await noHorizontalOverflow();
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,820));
    });
    await check('三后端分阶段预演、半程失败重试与键盘裁决冲突',async()=>{
      await scenario('normal_mixed');await nav('日历');await page.getByRole('button',{name:'管理外部日历同步 / 预演',exact:true}).click();
      for(const [id,label] of [['google','Google Calendar API'],['eventkit','macOS 系统日历'],['icloud-caldav','Windows iCloud CalDAV']]){
        await dialog().locator('.sync-backend-card').filter({hasText:label}).click();await dialog().getByRole('button',{name:/计算同步预演清单/}).click();
        if(id==='google')await setSwitch(dialog().getByRole('switch',{name:/模拟写入后/}),true);
        await dialog().getByRole('button',{name:/2. 执行模拟同步/}).click();await waitState(s=>s.targets.find(t=>t.id===id).stage===(id==='google'?'failed':'verified'));
        if(id==='google') {await dialog().getByRole('button',{name:/计算同步预演清单/}).click();await setSwitch(dialog().getByRole('switch',{name:/模拟写入后/}),false);await dialog().getByRole('button',{name:/2. 执行模拟同步/}).click();await waitState(s=>s.targets[0].stage==='verified');}
      }
      await shot('desktop-sync.png');await closeDialog();await scenario('calendar_conflicts');
      await page.getByRole('button',{name:/^管理外部日历同步/}).click();const accept=dialog().getByRole('button',{name:/采纳.*手动计划/});await accept.focus();await page.keyboard.press('Enter');await waitState(s=>s.subscriptions.find(s=>s.id==='claude').renewalDate.value==='2026-10-25');await closeDialog();
      for(const choice of ['local','unlink']){
        await resetCurrentScenario();await page.getByRole('button',{name:/^管理外部日历同步/}).click();
        const action=dialog().getByRole('button',{name:choice==='local'?/恢复本地计划/:/解除管理并保留模拟外部事件/});await action.focus();await page.keyboard.press('Enter');
        await waitState(snapshot=>{const remote=snapshot.targets[0].remote.find(event=>event.subscriptionId==='claude');return choice==='local'?remote.date==='2026-10-22':remote.managed===false;});
        assert.equal((await state()).subscriptions.find(subscription=>subscription.id==='claude').renewalDate.value,'2026-10-22');await closeDialog();
      }
      await page.getByRole('button',{name:/^管理外部日历同步/}).click();await dialog().locator('.sync-backend-card').filter({hasText:'Windows iCloud CalDAV'}).click();
      const suppressed=(await state()).targets[2].remote.find(event=>event.subscriptionId==='codex'&&event.deleted);assert.ok(suppressed?.suppressed);
      await dialog().getByRole('button',{name:/计算同步预演清单/}).click();await dialog().getByRole('button',{name:/2. 执行模拟同步/}).click();await waitState(snapshot=>snapshot.targets[2].stage==='verified');
      const kept=(await state()).targets[2].remote.find(event=>event.id===suppressed.id);assert.equal(kept.deleted,true);assert.equal(kept.suppressed,true);await closeDialog();
      assert.equal(await page.getByRole('button',{name:/^管理外部日历同步/}).evaluate(e=>e===document.activeElement),true);
    });
    await check('设置阈值错误、草稿关闭保护与重启恢复',async()=>{
      await page.getByRole('button',{name:'打开设置与备份'}).click();
      const field=page.getByRole('textbox',{name:'CNY 低余额阈值',exact:true});const previous=(await state()).preferences.walletThresholds.CNY;
      await field.fill('-5');await dialog().getByRole('button',{name:'保存阈值',exact:true}).click();await page.getByText('阈值请填写非负金额，最多 6 位小数',{exact:true}).waitFor();
      assert.equal((await state()).preferences.walletThresholds.CNY,previous);await closeDialog();
      assert.match(await dialog().innerText(),/有未保存的钱包阈值修改/);await page.keyboard.press('Escape');await page.keyboard.press('Escape');assert.equal(await page.getByRole('alertdialog').isVisible(),true);
      await dialog().getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await field.inputValue(),'-5');await field.fill('25');await dialog().getByRole('button',{name:'保存阈值',exact:true}).click();
      await waitState(snapshot=>snapshot.preferences.walletThresholds.CNY==='25');await closeDialog();await app.close();app=null;await launch();
      assert.equal((await state()).preferences.walletThresholds.CNY,'25');
    });
    await check('设置真实备份、预览后改文件拒绝与恢复暂停',async()=>{
      const file=path.join(profile,'ui-backup.json');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
      await page.getByRole('button',{name:'打开设置与备份'}).click();await dialog().getByRole('tab',{name:'备份与恢复',exact:true}).click();
      await dialog().getByRole('button',{name:'导出演示备份 JSON',exact:true}).click();await dialog().getByRole('status').getByText(/演示备份已保存/).waitFor();
      assert.equal(await page.getByText(/演示备份已保存/).filter({visible:true}).count(),1,'同一通知在模态框中只显示一处');
      const noticeBox=await dialog().getByRole('status').boundingBox(),bodyBox=await dialog().locator('.modal-body').boundingBox();assert.ok(noticeBox.y+noticeBox.height<=bodyBox.y+1,'通知必须预留正常流空间，不能盖住表单或保存');
      const text=await fs.readFile(file,'utf8');assert.equal(JSON.parse(text).schemaVersion,1);
      const beforeImport=(await state()).subscriptions;await fs.writeFile(file,'{ broken json');await dialog().getByRole('button',{name:'选择备份并预览',exact:true}).click();await dialog().getByRole('alert').waitFor();
      assert.deepEqual((await state()).subscriptions,beforeImport,'损坏文件不能更改演示资料');await fs.writeFile(file,text);
      await dialog().getByRole('button',{name:'选择备份并预览',exact:true}).click();await page.getByTestId('open-restore-confirm-btn').click();await dialog().getByRole('button',{name:'取消',exact:true}).click();
      assert.deepEqual((await state()).subscriptions,beforeImport,'取消恢复不能更改演示资料');
      await dialog().getByRole('button',{name:'选择备份并预览',exact:true}).click();await page.getByTestId('open-restore-confirm-btn').click();await dialog().getByRole('button',{name:'确认恢复演示资料',exact:true}).waitFor();await fs.writeFile(file,text+' ');
      await dialog().getByRole('button',{name:'确认恢复演示资料',exact:true}).click();await dialog().getByText(/文件在预览后发生变化/).waitFor();
      await dialog().getByRole('button',{name:'选择备份并预览',exact:true}).click();await page.getByTestId('open-restore-confirm-btn').click();await dialog().getByRole('button',{name:'确认恢复演示资料',exact:true}).click();await waitState(s=>s.targets.every(t=>t.state==='paused'));await closeDialog();
    });
    await check('150% 系统缩放下的深浅色、960 窄窗口与键盘焦点',async()=>{
      await scenario('normal_mixed');await nav('概览');await page.getByRole('button',{name:'重置当前场景…',exact:true}).click();await page.getByRole('button',{name:'确认重置当前场景',exact:true}).click();await page.getByRole('button',{name:/收起预览工具/}).click();await hideToast();
      if((await state()).preferences.theme!=='light')await page.getByRole('button',{name:'切换深浅色主题'}).click();await shot('desktop-light.png');await auditVisualTokens();
      const windowHandle=await app.evaluate(({BrowserWindow})=>{const handle=BrowserWindow.getAllWindows()[0].getNativeWindowHandle();return handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());});
      const native=await nativeScript('capture-window.ps1',{WindowHandle:windowHandle,OutputPath:path.join(evidence,'native-window-150.png')});report.nativeCapture=JSON.parse(native.stdout.trim());
      await nav('订阅');await noHorizontalOverflow();await shot('desktop-subscriptions.png');
      await nav('连接');await noHorizontalOverflow();await shot('desktop-connections.png');
      await nav('日历');await noHorizontalOverflow();await shot('desktop-calendar.png');
      await nav('概览');await page.getByRole('button',{name:'切换深浅色主题'}).click();await shot('desktop-dark.png');await auditVisualTokens();
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,640));await noHorizontalOverflow();
      await page.getByRole('button',{name:/查看 Codex 详情/}).focus();await page.keyboard.press('Enter');await shot('desktop-narrow-detail.png');
      const rect=await dialog().boundingBox();assert.ok(rect.x>400,'抽屉必须贴右显示');
      const before=(await state()).subscriptions.find(s=>s.id==='codex');await dialog().getByRole('button',{name:'编辑记录',exact:true}).click();await page.locator('#sub-notes').fill('仅修改备注，不改变官方观察来源与精确重置时刻');await shot('desktop-narrow-form.png');
      await dialog().getByRole('button',{name:'保存更改',exact:true}).click();const after=(await state()).subscriptions.find(s=>s.id==='codex');assert.deepEqual(after.metrics,before.metrics);assert.deepEqual(after.renewalDate,before.renewalDate);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button',{name:/查看 Codex 详情/}).evaluate(e=>e===document.activeElement),true);
      await nav('日历');await noHorizontalOverflow();await hideToast();await shot('desktop-narrow-calendar.png');
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,820));await shot('desktop-calendar-dark.png');
    });
    await check('双主题四页、主要 Portal 与状态视觉核对',async()=>{
      await scenario('normal_mixed');await resetCurrentScenario();await page.getByRole('button',{name:/收起预览工具/}).click();await hideToast();
      for(const theme of ['light','dark']){
        if((await state()).preferences.theme!==theme)await page.getByRole('button',{name:'切换深浅色主题'}).click();await hideToast();
        await scenario('normal_mixed');await page.getByRole('button',{name:/收起预览工具/}).click();await hideToast();
        const expected=theme==='light'?'rgb(255, 255, 255)':'rgb(34, 34, 38)';
        for(const name of ['订阅','日历','连接','概览']){
          await nav(name);await noHorizontalOverflow();assert.equal(await page.locator('.panel,.sub-card').first().evaluate(element=>getComputedStyle(element).backgroundColor),expected);
          if(name==='订阅')assert.equal(await page.locator('.subscriptions-search-wrap').evaluate(element=>{const input=element.querySelector('input'),icon=element.querySelector('svg');return input.getBoundingClientRect().x+parseFloat(getComputedStyle(input).paddingLeft)>icon.getBoundingClientRect().right;}),true,'搜索图标不能盖住输入和占位文字');
          if(theme==='dark'&&name!=='概览')await shot(`desktop-${name==='订阅'?'subscriptions':name==='日历'?'calendar':'connections'}-dark.png`);
        }
        await page.getByRole('button',{name:'打开设置与备份'}).click();assert.equal(await dialog().evaluate(element=>getComputedStyle(element).backgroundColor),expected);
        const tabs=dialog().getByRole('tablist'),content=dialog().getByRole('tabpanel');assert.ok((await content.boundingBox()).y>(await tabs.boundingBox()).y,'设置标签页必须在内容上方');
        await closeDialog();await page.getByRole('button',{name:/查看 Codex 详情/}).click();assert.equal(await dialog().evaluate(element=>getComputedStyle(element).backgroundColor),expected);await closeDialog();
        await page.locator('.top-nav').getByRole('button',{name:'新增订阅',exact:true}).click();assert.equal(await dialog().evaluate(element=>getComputedStyle(element).backgroundColor),expected);
        await page.locator('#sub-product').fill('主题与关闭保护核对');await page.locator('#sub-kind').click();assert.equal(await page.locator('[data-slot="select-content"]').evaluate(element=>getComputedStyle(element).backgroundColor),expected);
        await page.keyboard.press('Escape');await page.keyboard.press('Escape');assert.equal(await page.getByRole('alertdialog').evaluate(element=>getComputedStyle(element).backgroundColor),expected);
        if(theme==='dark')await shot('desktop-unsaved-dark.png');await dialog().getByRole('button',{name:'放弃修改并关闭',exact:true}).click();
        for(const id of ['multi_account_shared','unknown_and_na','zero_vs_unfetched','stale_and_past_reset','auth_and_locked_fields','empty_first_run']){
          await scenario(id);
          // The preceding create/edit test deliberately persists one record in
          // this space. Reset through its real UI before checking its empty seed.
          if(id==='empty_first_run')await resetCurrentScenario();
          await noHorizontalOverflow();
          const semantics=await page.locator('.overview-page').innerText();assert.ok(semantics.length>40);
          report.visualChecks.push({theme,scenario:id,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio})),noHorizontalOverflow:true});
          if(id==='multi_account_shared'){
            assert.equal(await page.locator('.secondary-account-slot .card-account-partition').count(),0);
            const multi=page.locator('[data-card-id="kimi"]');
            if(theme==='light'){await hideToast();await multi.evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+scrollY-72));await shot('desktop-multi-account.png',false);}
            await multi.getByRole('button',{name:/展开其余/}).click();
          }
          if(id==='empty_first_run')assert.equal(await page.locator('.sub-card').count(),0);
          if(theme==='dark'&&['unknown_and_na','zero_vs_unfetched','stale_and_past_reset','empty_first_run'].includes(id)){await hideToast();await shot(`state-${id}.png`);}
          if(id==='auth_and_locked_fields'){await nav('连接');if(theme==='dark'){await hideToast();await shot('desktop-connections-error-dark.png');}await nav('概览');}
        }
      }
      await scenario('normal_mixed');await page.getByRole('button',{name:/收起预览工具/}).click();await hideToast();
    });
  }
  if(!foundationOnly&&!shellOnly) await check('实际 JSON 文件往返与提交前重新读取',async()=>{
    const file=path.join(profile,'bridge-roundtrip.json');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    const text=JSON.stringify({schemaVersion:1,kind:'native-bridge-check'});
    const saved=await page.evaluate(async text=>window.subcal.saveFile('bridge-roundtrip.json',text),text);
    assert.equal(saved.saved,true);assert.equal(await fs.readFile(file,'utf8'),text);
    const selected=await page.evaluate(()=>window.subcal.openFile());assert.equal(selected.contents,text);
    await fs.writeFile(file,'changed after preview');
    assert.equal(await page.evaluate(id=>window.subcal.readSelectedFile(id),selected.selectionId),'changed after preview');
  });
  if(!foundationOnly&&!shellOnly) await check('首次关闭说明、真实托盘重新打开与菜单完全退出',async()=>{
    const marker=`SubCal-Verification-${app.process().pid}`;
    await app.evaluate(({Menu})=>{const original=Menu.buildFromTemplate;Menu.buildFromTemplate=(template)=>{const menu=original(template);globalThis.__verificationTrayMenu=menu;return menu;};});
    await page.evaluate(marker=>window.subcal.updateTray({nextRenewal:marker,pinned:['Codex 剩余 35%（示例）'],reconnectCount:1,paused:false,closeToTray:true}),marker);
    const notice=await app.evaluate(({BrowserWindow,dialog})=>{let notice;dialog.showMessageBoxSync=(_win,options)=>{notice=options;return 0;};BrowserWindow.getAllWindows()[0].close();return notice;});
    assert.match(notice.detail,/预览仍在运行/);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    await nativeScript('tray-action.ps1',{Marker:marker,Action:'open'});
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
    const closed=app.waitForEvent('close');
    await app.evaluate(()=>{const item=globalThis.__verificationTrayMenu.items.find(i=>i.label==='退出 SubCal 预览');if(!item)throw new Error('Quit menu missing');item.click();});
    await closed;app=null;
  });
  assert.deepEqual(errors,[]);
  if(match)report.filter=match;
  const reportName=foundationOnly?'foundation-check.json':shellOnly?'shell-check.json':match?`desktop-check-${match.replace(/[^\p{L}\p{N}]+/gu,'-').slice(0,60)}.json`:'desktop-check.json';
  await fs.writeFile(path.join(evidence,reportName),JSON.stringify(report,null,2));
}catch(error){
  report.failure=String(error);report.pageErrors=errors;
  if(page&&!page.isClosed())report.failureState=await page.evaluate(async()=>{const {client}=await import('/src/renderer/service/MockSubCalClient.ts');const snapshot=await client.snapshot();return {scenario:snapshot.scenario,order:snapshot.preferences.order,domOrder:Array.from(document.querySelectorAll('.sub-card')).map(element=>element.getAttribute('data-card-id')),active:document.activeElement?.outerHTML.slice(0,600)};}).catch(()=>null);
  if(page&&!page.isClosed())await page.screenshot({path:path.join(tempRoot,'subcal-desktop-failure.png')}).catch(()=>{});
  await fs.writeFile(path.join(tempRoot,'subcal-desktop-failure.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(evidence,`desktop-attempt-${new Date().toISOString().replace(/[:.]/g,'-')}.json`),JSON.stringify(report,null,2));
  throw error;
}finally{
  if(app)await app.close().catch(()=>{});
  if(server)await server.close();
  await fs.rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:150}).catch(()=>{});
}
