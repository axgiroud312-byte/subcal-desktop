import type { Backend, CalendarEvent, CalendarTarget, ConnectionState, ImportPreview, Preferences, PreviewController, Probe, RemoteEvent, ScenarioId, Snapshot, Space, Store, SubCalClient, Subscription, SubscriptionInput, SyncChange, SyncPreview } from '../../shared/types';
import { scenarioIds } from '../../shared/types';
import { addDays, dateInZone, projectEvents, validateSubscription } from '../../shared/rules';
import { defaultPreferences, makeScenario, scenarioNames } from './scenarios';
import { parseStore } from './validation';

export class ClientError extends Error { constructor(public code:string,message:string,public details?:Record<string,string>){super(message);this.name='ClientError';} }
export interface DemoStorage { getItem(key:string):string|null; setItem(key:string,value:string):void }
export class DemoClock { constructor(private instant:string){} now(){return this.instant;} advance(minutes:number){this.instant=new Date(Date.parse(this.instant)+minutes*60000).toISOString();return this.instant;} }
const NAMESPACE='subcal.preview.v1';
const clone=<T,>(value:T):T=>structuredClone(value);
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export class MockSubCalClient implements SubCalClient {
  private store:Store;
  private storageError:string|null=null;
  private listeners=new Set<()=>void>();
  private epoch=0;
  private jobs=new Map<string,Promise<string>>();
  private previews=new Map<string,SyncPreview>();
  private probes=new Map<string,Probe>();
  private imports=new Map<string,{preview:ImportPreview;store:Store;epoch:number;revision:number}>();
  private created=new Map<string,string>();
  private undoRecords=new Map<string,{subscription:Subscription;index:number;remote:Record<string,RemoteEvent[]>;expires:number;epoch:number}>();
  private activeSync=new Set<Backend>();
  constructor(private storage:DemoStorage,private delay=450,clock?:DemoClock){
    this.store={schemaVersion:1,active:'normal_mixed',spaces:{normal_mixed:makeScenario('normal_mixed')},preferences:clone(defaultPreferences),counter:100};
    if(clock)this.store.spaces.normal_mixed!.now=clock.now();
    try{const saved=storage.getItem(NAMESPACE);if(saved)this.store=parseStore(saved);}catch(error){this.storageError=`演示存储读取失败：${(error as Error).message}。原始内容仍保留；可先导出恢复副本，再明确重置。`;}
    // Interrupted mock jobs are not resumed as fictitious successes.
    for(const space of Object.values(this.store.spaces)){
      for(const c of space.connections)if(c.state==='refreshing'){c.state='ready';c.error={code:'INTERRUPTED',message:'上次模拟刷新被中断，旧值保留',action:'再次模拟刷新'};}
      for(const t of space.targets)if(t.stage==='queued'||t.stage==='written'){t.state='paused';t.message='上次模拟同步被中断；请核对后重新预览';}
    }
  }
  private get space(){return this.store.spaces[this.store.active]!;}
  private token(prefix:string){return `${prefix}-${++this.store.counter}`;}
  private emit(){for(const listener of this.listeners)listener();}
  private commit(change:()=>void,revision=true){
    if(this.storageError)throw new ClientError('STORAGE_RECOVERY','原始存储需要恢复。请使用预览工具导出原始副本或明确重置。');
    const before=clone(this.store);
    try{change();if(revision)this.space.revision++;this.storage.setItem(NAMESPACE,JSON.stringify(this.store));}
    catch(error){this.store=before;throw error instanceof ClientError?error:new ClientError('STORAGE_WRITE','本地保存失败，当前修改未提交。请检查可用存储空间。');}
    this.emit();
  }
  private invalidate(){this.epoch++;this.jobs.clear();this.previews.clear();this.probes.clear();this.imports.clear();this.activeSync.clear();}
  private interruptSpace(){
    for(const c of this.space.connections)if(c.state==='refreshing'){c.generation++;c.state='ready';c.error={code:'CANCELLED',message:'切换场景已取消在途模拟任务，旧值保留',action:'可再次模拟刷新'};}
    for(const t of this.space.targets)if(t.stage==='queued'||t.stage==='written'){t.state='paused';t.message='切换场景已暂停在途模拟同步，请重新预览';}
  }
  private sub(id:string){const s=this.space.subscriptions.find(s=>s.id===id);if(!s)throw new ClientError('NOT_FOUND','记录已不在当前演示空间');return s;}
  private target(id:Backend){return this.space.targets.find(t=>t.id===id)!;}
  private history(s:Subscription,text:string){s.history.unshift({at:this.space.now,text,dataOrigin:'demo'});s.history=s.history.slice(0,100);}
  async snapshot():Promise<Snapshot>{return clone({...this.space,scenario:this.store.active,preferences:this.store.preferences,storageError:this.storageError});}
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  async create(input:SubscriptionInput,key:string){
    const existing=this.created.get(`${this.epoch}:${key}`);if(existing)return existing;
    const errors=validateSubscription(input);if(Object.keys(errors).length)throw new ClientError('VALIDATION','请检查表单中的字段',errors);
    let id='';this.commit(()=>{id=this.token('sub');const s:Subscription={...clone(input),product:input.product.trim(),id,revision:1,history:[]};this.history(s,'新增本地演示记录');this.space.subscriptions.push(s);});
    this.created.set(`${this.epoch}:${key}`,id);return id;
  }
  async update(id:string,revision:number,patch:Partial<SubscriptionInput>){
    const current=this.sub(id);if(current.revision!==revision)throw new ClientError('REVISION_CONFLICT','这条记录刚刚发生变化，输入已保留。请重新核对最新记录后保存。');
    const updated={...current,...clone(patch)};const errors=validateSubscription(updated);if(Object.keys(errors).length)throw new ClientError('VALIDATION','请检查表单中的字段',errors);
    this.commit(()=>{Object.assign(current,updated);current.revision++;this.history(current,'修改本地演示资料；日历投影已同步更新');
      if(current.billingGroupId&&['price','currency','cycle','intervalDays','anchorDate','renewalDate','paidThrough','autoRenew'].some(key=>Object.hasOwn(patch,key)))for(const other of this.space.subscriptions.filter(s=>s.id!==id&&s.billingGroupId===current.billingGroupId)){
        for(const key of ['price','currency','cycle','intervalDays','anchorDate','renewalDate','paidThrough','autoRenew'] as const)if(Object.hasOwn(patch,key))Object.assign(other,{[key]:clone(current[key])});
        other.revision++;this.history(other,'共用付款记录同步更新；额度池保持独立');
      }
    });
  }
  private handleRemote(s:Subscription,removeFuture:boolean){
    const ids=new Set(projectEvents([s],this.space.now).map(e=>e.id));
    // A shared billing occurrence still belongs to the surviving member.
    const retained=new Set(projectEvents(this.space.subscriptions.filter(x=>x.id!==s.id),this.space.now).map(e=>e.id));
    for(const t of this.space.targets){t.remote=t.remote.filter(e=>{
      if(!ids.has(e.id)||retained.has(e.id)||e.date<dateInZone(this.space.now,e.timezone))return true;
      if(removeFuture)return false;e.managed=false;return true;
    });t.revision++;}
  }
  async archive(id:string,archived:boolean,removeFuture=false){this.commit(()=>{const s=this.sub(id);if(archived){if(s.lifecycle!=='archived')s.archivedFrom=s.lifecycle;s.lifecycle='archived';}else{s.lifecycle=s.archivedFrom||'active';delete s.archivedFrom;}s.revision++;if(archived&&removeFuture){
    const retained=new Set(projectEvents(this.space.subscriptions.filter(x=>x.id!==id&&x.lifecycle!=='archived'),this.space.now).map(e=>e.id));
    for(const t of this.space.targets)for(const e of projectEvents([s],this.space.now).filter(e=>e.date>=dateInZone(this.space.now,e.timezone)&&!retained.has(e.id))){const r=t.remote.find(r=>r.id===e.id);if(r){r.suppressed=true;r.deleted=true;}else t.remote.push({...e,managed:true,baselineDate:e.date,suppressed:true,deleted:true});}
  }this.history(s,archived?'归档：停止本地跟踪，保留本地日程':'恢复本地跟踪');});}
  async remove(id:string,removeFuture:boolean){
    const s=clone(this.sub(id));const token=this.token('undo');const remote=Object.fromEntries(this.space.targets.map(t=>[t.id,clone(t.remote)]));const index=this.space.subscriptions.findIndex(x=>x.id===id);
    this.commit(()=>{this.handleRemote(s,removeFuture);this.space.subscriptions.splice(index,1);});
    this.undoRecords.set(token,{subscription:s,index,remote,expires:Date.now()+8000,epoch:this.epoch});return token;
  }
  async undo(token:string){
    const record=this.undoRecords.get(token);if(!record||record.epoch!==this.epoch||Date.now()>record.expires)throw new ClientError('UNDO_EXPIRED','8 秒撤销时间已结束');
    this.commit(()=>{
      if(this.space.subscriptions.some(s=>s.id===record.subscription.id))throw new ClientError('CONFLICT','该记录已恢复');
      this.space.subscriptions.splice(record.index,0,record.subscription);
      const ids=new Set(projectEvents([record.subscription],this.space.now).map(e=>e.id));
      for(const t of this.space.targets){const current=new Map(t.remote.map(e=>[e.id,e]));for(const e of record.remote[t.id])if(ids.has(e.id))current.set(e.id,e);t.remote=[...current.values()];t.revision++;}
    });this.undoRecords.delete(token);
  }
  async reorder(ids:string[]){await this.setPreferences({order:[...new Set(ids)]});}
  async setPreferences(patch:Partial<Preferences>){this.commit(()=>{Object.assign(this.store.preferences,clone(patch));},false);}
  async resolveField(id:string,field:'renewalDate'|'price'|'plan',accept:boolean){this.commit(()=>{const s=this.sub(id);const f=s[field];if(f.proposed===undefined)return;if(accept){f.value=f.proposed;f.observedAt=this.space.now;f.source='用户采纳模拟探测值';if(field==='renewalDate')s.anchorDate=f.value;}delete f.proposed;f.locked=true;s.revision++;
    if(accept&&field!=='plan'&&s.billingGroupId)for(const related of this.space.subscriptions.filter(x=>x.id!==id&&x.billingGroupId===s.billingGroupId)){related[field]=clone(f);if(field==='renewalDate')related.anchorDate=f.value;related.revision++;}
    this.history(s,accept?`采纳 ${field} 的模拟差异为手动值`:`保留 ${field} 的手动锁定值`);});}
  async refresh(id?:string):Promise<string>{
    const connId=id&&this.space.subscriptions.find(s=>s.id===id)?.connectionId||id;
    if(!connId){const results=await Promise.all(this.space.connections.map(c=>this.refresh(c.id)));return results.length?`模拟刷新：${results.join('；')}`:'暂无可模拟刷新的连接';}
    const c=this.space.connections.find(c=>c.id===connId);if(!c)return '手动记录没有模拟连接';
    if(this.jobs.has(c.id))return '已合并到正在执行的模拟任务';
    if(this.space.offline)return '当前离线（模拟）；可继续手动编辑，恢复后补查一次';
    if(c.state==='rate_limited'&&c.nextAllowed&&c.nextAllowed>this.space.now)return `模拟限流，下次允许：${c.nextAllowed}`;
    if(['paused','disconnected','auth','denied','runtime_missing','schema_changed'].includes(c.state))return c.error?.message||'连接已暂停或未连接（模拟），请先恢复';
    const epoch=this.epoch,generation=c.generation,partial=c.state==='partial';
    this.commit(()=>{c.state='refreshing';c.lastAttempt=this.space.now;});
    const task=(async()=>{
      await sleep(this.delay);
      if(epoch!==this.epoch||c.generation!==generation||c.state!=='refreshing')return '旧模拟响应已忽略';
      this.commit(()=>{
        c.state=partial?'partial':'ready';c.lastSuccess=this.space.now;c.nextAllowed=null;c.runs++;
        c.error=partial?{code:'PARTIAL',message:'余额更新成功；套餐字段仍为旧观察（模拟）',action:'查看字段来源'}:null;
        const pools=new Set(this.space.subscriptions.filter(s=>s.connectionId===c.id).map(s=>s.quotaPoolId).filter(Boolean));
        for(const s of this.space.subscriptions){if(s.connectionId!==c.id&&(!s.quotaPoolId||!pools.has(s.quotaPoolId)))continue;
          for(const m of s.metrics){if(m.remaining.availability!=='known'||m.remaining.value===null)continue;m.remaining.observedAt=this.space.now;m.remaining.source='模拟官方读取';if(m.resetAt&&m.resetAt<=this.space.now){m.resetAt=new Date(Date.parse(this.space.now)+5*3600000).toISOString();if(m.unit==='%')m.remaining.value='82';}}
          // Renewal, price, plan have their own provenance and never acquire a quota refresh timestamp.
          s.revision++;this.history(s,partial?'模拟部分观察：仅余额/额度字段成功；套餐未更新':'模拟观察：更新额度字段；收费日期保持原来源');
        }
      });return partial?'部分字段模拟更新完成，失败字段保留旧时间':'模拟额度更新完成';
    })().finally(()=>{if(this.jobs.get(c.id)===task)this.jobs.delete(c.id);});
    this.jobs.set(c.id,task);return task;
  }
  async pause(id?:string){
    const selected=id?this.space.connections.filter(c=>c.id===id):this.space.connections;
    const resume=selected.length>0&&selected.every(c=>c.state==='paused');
    this.commit(()=>{for(const c of selected){c.generation++;c.state=resume?'ready':'paused';c.error=null;}});
    if(resume)await Promise.all(selected.map(c=>this.refresh(c.id)));
  }
  async disconnect(id:string){this.commit(()=>{const c=this.space.connections.find(c=>c.id===id);if(c){c.generation++;c.state='disconnected';c.error=null;}for(const s of this.space.subscriptions.filter(s=>s.connectionId===id))this.history(s,'断开模拟绑定，订阅资料与日程保留');});}
  async probe(id:string,profile:string){
    const c=this.space.connections.find(c=>c.id===id);if(!c)throw new ClientError('NOT_FOUND','未找到连接');
    if(!['个人示例账号','团队示例账号'].includes(profile))throw new ClientError('PROFILE','只能选择预置示例身份');
    const epoch=this.epoch,generation=c.generation;await sleep(this.delay);
    if(epoch!==this.epoch||generation!==c.generation)throw new ClientError('CANCELLED','场景或连接已改变，请重新模拟探测');
    const samples=this.space.subscriptions.filter(s=>s.connectionId===id).flatMap(s=>s.metrics.map((m,index)=>`${m.label}：${m.remaining.availability==='unlimited'?'无限量':profile!==c.account?(m.unit==='%'?'55':[ '25.00','20.00','5.00' ][index]||'5.00'):m.remaining.value??'尚未获取'} ${m.unit}（模拟）`));
    const p:Probe={id:this.token('probe'),connectionId:id,generation,account:profile,fields:c.fields,samples};this.probes.set(p.id,p);return clone(p);
  }
  async bind(probe:Probe){
    const saved=this.probes.get(probe.id);const c=this.space.connections.find(c=>c.id===saved?.connectionId);
    if(!saved||!c||c.generation!==saved.generation)throw new ClientError('STALE_PROBE','模拟探测已失效，请重试');
    const identityChanged=c.account!==saved.account;
    this.commit(()=>{c.generation++;c.account=saved.account;c.state='ready';c.error=null;c.nextAllowed=null;
      for(const s of this.space.subscriptions.filter(s=>s.connectionId===c.id)){
        s.account=c.account;s.revision++;if(identityChanged){s.quotaPoolId=this.token('pool');s.metrics.forEach((m,index)=>{if(m.remaining.availability==='known'){m.remaining.value=m.unit==='%'?'55':(['25.00','20.00','5.00'][index]||'5.00');m.remaining.observedAt=this.space.now;m.remaining.source='模拟新账号探测';}});}
        this.history(s,'用户确认示例身份并绑定模拟连接');
      }
    });this.probes.delete(probe.id);await this.refresh(c.id);
  }
  async diagnose(id?:string){return JSON.stringify({dataOrigin:'demo',notice:'仅脱敏模拟诊断，不含账号、网址、凭据或本机路径',connections:this.space.connections.filter(c=>!id||c.id===id).map((c,i)=>({reference:`connection-${i+1}`,provider:c.provider,version:c.version,state:c.state,errorCode:c.error?.code||null,runs:c.runs,lastSuccess:c.lastSuccess}))},null,2);}
  async events(includeReset=false){return projectEvents(this.space.subscriptions,this.space.now,includeReset);}
  private syncChanges(backend:Backend):SyncChange[]{
    const t=this.target(backend);const events=projectEvents(this.space.subscriptions,this.space.now).filter(e=>e.kind!=='reset'&&e.date>=dateInZone(this.space.now,e.timezone));
    const changes:SyncChange[]=[];const local=new Map(events.map(e=>[e.id,e]));const remote=new Map(t.remote.map(e=>[e.id,e]));
    for(const e of events){const r=remote.get(e.id);if(r?.suppressed||r?.deleted||r?.managed===false){changes.push({action:'suppressed',event:e,remote:r});continue;}
      if(!r)changes.push({action:'add',event:e});else if(r.date!==r.baselineDate)changes.push({action:'conflict',event:e,remote:r});else if(r.date!==e.date||r.product!==e.product||r.expected!==e.expected)changes.push({action:'update',event:e,remote:r});}
    for(const r of t.remote){if(r.managed&&!r.suppressed&&!r.deleted&&!local.has(r.id)&&r.date>=dateInZone(this.space.now,r.timezone))changes.push({action:'remove',event:r,remote:r});}
    return changes;
  }
  async previewSync(backend:Backend){const p:SyncPreview={id:this.token('preview'),backend,revision:this.space.revision,changes:clone(this.syncChanges(backend))};this.previews.set(p.id,p);return clone(p);}
  async sync(previewId:string,failAfterWrite=false){
    const p=this.previews.get(previewId);if(!p||p.revision!==this.space.revision)throw new ClientError('STALE_PREVIEW','资料已变化，请重新预览日历变更');
    const t=this.target(p.backend);if(t.state!=='ready')throw new ClientError('TARGET_PAUSED','目标已暂停或不可写，请先核对目标状态');
    if(this.activeSync.has(t.id))throw new ClientError('MERGED','模拟同步已在进行');
    if(p.changes.some(c=>c.action==='conflict'))throw new ClientError('CONFLICT','请先处理外部改期冲突，再重新预览');
    this.activeSync.add(t.id);const epoch=this.epoch;let version=this.space.revision;
    const valid=()=>epoch===this.epoch&&t.state==='ready'&&this.space.revision===version;
    try{
      this.commit(()=>{t.stage='queued';t.message='模拟已排队';},false);await sleep(this.delay);
      if(!valid()){if(epoch===this.epoch)this.commit(()=>{t.stage='failed';t.message='资料或目标已改变；请重新预览（模拟）';},false);throw new ClientError('CANCELLED','模拟同步已取消，请重新预览');}
      this.commit(()=>{
        for(const change of p.changes){if(change.action==='suppressed')continue;const index=t.remote.findIndex(e=>e.id===change.event.id);
          if(change.action==='remove'){if(index>=0)t.remote.splice(index,1);continue;}
          const r:RemoteEvent={...change.event,managed:true,baselineDate:change.event.date,suppressed:false,deleted:false};if(index<0)t.remote.push(r);else t.remote[index]=r;
        }
        t.stage='written';t.message=t.id==='eventkit'?'模拟写入系统日历，等待本机读回':'模拟已写入，等待读回';t.revision++;
      },false);await sleep(this.delay);
      if(!valid()){if(epoch===this.epoch)this.commit(()=>{t.stage='failed';t.message='模拟写入后资料已变化，请重新预览并核对';},false);throw new ClientError('CANCELLED','模拟同步已中断，请重新预览并核对已写入结果');}
      this.commit(()=>{t.stage=failAfterWrite?'failed':'verified';t.message=failAfterWrite?'模拟读回失败；已写入快照保留，重新预览可继续核对':t.id==='eventkit'?'模拟本机读回一致；iCloud 云端由系统同步，本预览未验证':'模拟远端读回一致';},false);
      this.previews.delete(previewId);
    }finally{this.activeSync.delete(t.id);}
  }
  async targetState(backend:Backend,state:CalendarTarget['state']){this.commit(()=>{const t=this.target(backend);t.state=state;t.revision++;t.message=state==='ready'?'模拟目标已核对，请重新预览':'模拟目标暂停：请核对原目标，不会改写到默认日历';});}
  async simulateExternal(backend:Backend,eventId:string,kind:'move'|'delete'){
    this.commit(()=>{const t=this.target(backend);const r=t.remote.find(e=>e.id===eventId);if(!r)throw new ClientError('NO_EVENT','请先模拟同步生成事件');if(kind==='move')r.date=addDays(r.date,3);else{r.deleted=true;r.suppressed=true;}t.revision++;t.message=kind==='move'?'模拟发现外部改期，等待裁决':'模拟发现外部删除，已抑制自动重建';});
  }
  async resolveConflict(backend:Backend,eventId:string,choice:'local'|'remote'|'unlink'){
    this.commit(()=>{const t=this.target(backend),r=t.remote.find(e=>e.id===eventId);if(!r)throw new ClientError('NOT_FOUND','未找到模拟事件');
      if(choice==='unlink'){r.managed=false;r.suppressed=true;return;}
      const local=projectEvents(this.space.subscriptions,this.space.now).find(e=>e.id===eventId);if(!local)throw new ClientError('NOT_FOUND','本地日程已移除，请解除管理');
      if(choice==='local'){r.date=local.date;r.baselineDate=local.date;r.deleted=false;r.suppressed=false;}
      else{
        const s=this.sub(local.subscriptionId);const field=local.kind==='renewal'?'renewalDate':local.kind==='expiry'?'paidThrough':local.kind==='trial'?'trialEnd':'startDate';
        if(local.kind==='renewal'&&!eventId.endsWith(':0')){
          for(const related of this.space.subscriptions.filter(x=>x.id===s.id||s.billingGroupId&&x.billingGroupId===s.billingGroupId)){related.scheduleOverrides={...related.scheduleOverrides,[eventId]:r.date};related.revision++;}
        }else{
          s[field]={value:r.date,availability:'known',source:'用户采纳模拟外部日期为手动计划',observedAt:this.space.now,dataOrigin:'demo',locked:true};if(field==='renewalDate'){s.anchorDate=r.date;for(const related of this.space.subscriptions.filter(x=>s.billingGroupId&&x.id!==s.id&&x.billingGroupId===s.billingGroupId)){related.renewalDate=clone(s.renewalDate);related.anchorDate=r.date;related.revision++;}}s.revision++;
        }
        this.history(s,'采纳模拟外部日期为新的手动计划（不是已扣款）');r.baselineDate=r.date;
      }t.revision++;t.message='模拟冲突已处理，请重新预览';
    });
  }
  async exportData(){return JSON.stringify(this.store,null,2);}
  async exportRawStorage(){return this.storage.getItem(NAMESPACE)||'';}
  async importPreview(text:string){
    this.imports.clear();const store=parseStore(text);const incoming=store.spaces[store.active]!.subscriptions;const current=this.space.subscriptions;
    const p:ImportPreview={id:this.token('import'),count:incoming.length,currentCount:current.length,added:incoming.filter(s=>!current.some(c=>c.id===s.id)).length,overwritten:incoming.filter(s=>current.some(c=>c.id===s.id)).length,removed:current.filter(s=>!incoming.some(c=>c.id===s.id)).length,scenario:store.active,text};
    this.imports.set(p.id,{preview:p,store,epoch:this.epoch,revision:this.space.revision});return clone(p);
  }
  async importCommit(id:string,text:string){
    const item=this.imports.get(id);if(!item||item.preview.text!==text||item.epoch!==this.epoch||item.revision!==this.space.revision)throw new ClientError('STALE_IMPORT','文件或当前资料已变化，请重新预览');
    const restored=clone(item.store);restored.counter=Math.max(restored.counter,this.store.counter);
    for(const space of Object.values(restored.spaces)){space.revision++;for(const t of space.targets){t.state='paused';t.stage='idle';t.message='备份恢复后暂停，请核对原模拟目标';}for(const c of space.connections){c.generation++;c.state='paused';}}
    this.commit(()=>{this.store=restored;});this.invalidate();this.emit();
  }
  preview:PreviewController={
    scenarios:async()=>scenarioIds.map(id=>({id,name:scenarioNames[id]})),
    switchScenario:async(id:ScenarioId)=>{if(!scenarioIds.includes(id))throw new ClientError('SCENARIO','未知场景');this.commit(()=>{this.interruptSpace();if(!this.store.spaces[id])this.store.spaces[id]=makeScenario(id);this.store.active=id;});this.invalidate();this.emit();},
    resetScenario:async()=>{this.commit(()=>{this.store.spaces[this.store.active]=makeScenario(this.store.active);});this.invalidate();this.emit();},
    advance:async(minutes:number)=>{if(!Number.isFinite(minutes)||minutes<0||minutes>525600)throw new ClientError('CLOCK','演示时钟增量无效');this.commit(()=>{const clock=new DemoClock(this.space.now);this.space.now=clock.advance(minutes);});},
    recoverOffline:async()=>{if(!this.space.offline)return;this.commit(()=>{this.space.offline=false;for(const c of this.space.connections)if(c.state==='offline')c.state='ready';});await this.refresh();},
    recoverStorage:async()=>{if(!this.storageError)return;const raw=this.storage.getItem(NAMESPACE);if(raw)this.storage.setItem(`${NAMESPACE}.recovery`,raw);this.storageError=null;this.commit(()=>{});},
  };
}
const memory=new Map<string,string>();
const storage:DemoStorage=typeof window==='undefined'?{getItem:k=>memory.get(k)||null,setItem:(k,v)=>{memory.set(k,v);}}:{getItem:k=>window.localStorage.getItem(k),setItem:(k,v)=>window.localStorage.setItem(k,v)};
export const client=new MockSubCalClient(storage);
