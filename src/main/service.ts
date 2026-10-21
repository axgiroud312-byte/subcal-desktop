import { createHash, randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { IpcRequestEnvelope, IpcResponseEnvelope } from '../shared/bridge';
import { parseRequest, subscriptionSchema, preferencesSchema } from '../shared/schema';
import { projectEvents } from '../shared/rules';
import { OFFICIAL_ADAPTER_CATALOG, type Subscription, type Snapshot, type Field, type Probe, type ImportPreview } from '../shared/types';
import { SubCalDatabase, DEFAULT_PRODUCTION_PREFERENCES } from './db/database';
import { CredentialVault, sanitizeDiagnosticText } from './credentials';
import { Scheduler, type CollectorPort } from './scheduler';
import type { AdapterManifest, CollectOutput } from './adapters/types';
import { AdapterError } from './adapters/types';
import { AccountAccess, AccountAccessError, type AccountCredential } from './account-access';
import { remoteOrigin } from './adapters/remote-account-adapter';
import { tencentTeamCredential } from './tencent-account-teams';
import { SERVICE_ACCESS } from '../shared/service-access';
import { hashKeySubject } from './adapters/http-adapters';
import { isAutomatic, mergeBalances, mergeEntitlements, mergeObservation, writableSubscriptionPatch } from '../shared/entitlements';

export class BusinessError extends Error { constructor(public code:string,message:string) { super(message); } }
function fail(code:string,message:string):never {throw new BusinessError(code,message);}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const reads=new Set(['accounts.discover','subscriptions.snapshot','calendars.events','data.export','collections.diagnose','data.importPreview']);
type ProbeRecord={ probe:Probe; output:CollectOutput; subscriptionId?:string; expires:number };
export class SubCalService {
  readonly scheduler:Scheduler;
  private listeners=new Set<()=>void>();
  private inflight=new Map<string,Promise<unknown>>();
  private inflightHashes=new Map<string,string>();
  private credentialTimer?:ReturnType<typeof setInterval>;
  private reconciling=false;
  private closed=false;
  constructor(readonly db:SubCalDatabase, readonly vault:CredentialVault, private readonly collector:CollectorPort, manifests:readonly AdapterManifest[], private now:()=>number=Date.now, readonly accountAccess=new AccountAccess()) {
    const authenticatedCollector:CollectorPort={
      collect:async(provider,input)=>{
        let secret:string|null;
        try {secret=await this.prepareCredential(input.connectionId,input.generation,input.secret??null);}
        catch(error) {
          if(error instanceof AccountAccessError) {
            const code=error.code==='ACCOUNT_MISMATCH'?'ACCOUNT_MISMATCH':error.code==='AUTH_REQUIRED'||error.code==='SOURCE_UNREADABLE'?'AUTH_REQUIRED':error.code==='STALE_GENERATION'?'CANCELLED':error.code==='SCHEMA_CHANGED'?'SCHEMA_CHANGED':'UPSTREAM_UNAVAILABLE';
            throw new AdapterError(code,error.message);
          }
          throw error;
        }
        return collector.collect(provider,{...input,secret});
      },cancel:id=>collector.cancel(id),close:()=>collector.close(),
    };
    this.scheduler=new Scheduler(db,vault,authenticatedCollector,manifests,(id,result)=>this.applyCollection(id,result),()=>this.changed(),now);
  }
  startAccountUpdates() {
    void this.reconcileCredentials();
    this.credentialTimer=setInterval(()=>void this.reconcileCredentials(),30000);
    this.credentialTimer.unref?.();
  }
  private credential(id:string,secret:string):AccountCredential {
    const c=this.connection(id);
    return {providerId:c.providerId,subject:c.accountSubject??'',alias:c.accountAlias,secret};
  }
  private async prepareCredential(id:string,generation:number,secret:string|null) {
    if(!secret?.startsWith('{'))return secret;
    let parsed:any;try{parsed=JSON.parse(secret);}catch{throw new AdapterError('AUTH_REQUIRED','请重新登录');}
    if(parsed.management==='static')return secret;
    const original=this.connection(id),credential=this.credential(id,secret);
    const next=parsed.management==='external'?await this.accountAccess.refreshExternal(credential):await this.accountAccess.refresh(credential);
    if(this.closed)throw new AdapterError('CANCELLED','应用已退出');
    const latest=this.connection(id);
    if(latest.generation!==generation||latest.credentialRef!==original.credentialRef)throw new AdapterError('CANCELLED','登录已更新，旧查询已取消');
    if(next.subject!==credential.subject)throw new AdapterError('ACCOUNT_MISMATCH','原客户端已切换账号，请添加新账号');
    if(next.secret!==secret)this.vault.withRollback(()=>this.db.writeTransaction(()=>{
      const saved=this.vault.saveSecret(id,next.secret,latest.credentialRef);this.db.updateConnection(id,{credentialRef:saved.credentialRef});
    }));
    return next.secret;
  }
  async reconcileCredentials() {
    if(this.closed||this.reconciling||this.db.getStorageError())return;
    this.reconciling=true;
    try {
      for(const row of this.db.listConnections()) {
        if(['disconnected','paused'].includes(row.state))continue;
        const c=this.connection(row.id),secret=this.vault.getSecret(c.credentialRef);
        if(!secret?.startsWith('{'))continue;
        let parsed:any;try{parsed=JSON.parse(secret);}catch{continue;}
        if(parsed.management!=='external')continue;
        try {
          const next=await this.accountAccess.refreshExternal(this.credential(c.id,secret));
          if(this.closed)return;
          const latest=this.connection(c.id);
          if(latest.generation!==c.generation||latest.credentialRef!==c.credentialRef||next.secret===secret)continue;
          if(next.subject!==c.accountSubject)continue;
          this.scheduler.cancel(c.id);
          this.vault.withRollback(()=>this.db.writeTransaction(()=>{
            const saved=this.vault.saveSecret(c.id,next.secret,c.credentialRef);
            this.db.updateConnection(c.id,{credentialRef:saved.credentialRef,generation:c.generation+1,state:'ready',error:null});
            this.scheduler.enqueue(c.id);
            this.db.rawPrepare('UPDATE collection_jobs SET consecutive_schema_errors=0 WHERE connection_id=?').run(c.id);
          }));
          this.changed();
        }catch{/* A missing/changed external login must never replace the saved identity. Collection reports recovery. */}
      }
    } finally {this.reconciling=false;}
  }
  subscribe(fn:()=>void) { this.listeners.add(fn); return ()=>{this.listeners.delete(fn);}; }
  changed() { for(const fn of this.listeners)fn(); }
  snapshot():Snapshot { return {revision:this.db.getSpaceRevision(),now:new Date(this.now()).toISOString(),scenario:'empty_first_run',subscriptions:this.db.listSubscriptions(),connections:this.db.listConnections(ref=>this.vault.getMask(ref)),targets:this.db.listCalendarTargets(),offline:false,preferences:this.db.getPreferences(),storageError:this.db.getStorageError()}; }
  private subscription(id:string) { return this.db.getSubscription(id)??fail('NOT_FOUND','订阅不存在'); }
  private connection(id:string) { return this.db.getConnectionRow(id)??fail('NOT_FOUND','连接不存在'); }
  private save(sub:Subscription) { if(sub.connectionId)sub.management='automatic';const validated=subscriptionSchema.parse(sub); this.db.upsertSubscription(validated);this.db.bumpSpaceRevision(); }
  private history(sub:Subscription,text:string) { sub.revision++;sub.history.push({at:new Date(this.now()).toISOString(),text,dataOrigin:'manual'}); }
  async handle(raw:unknown):Promise<IpcResponseEnvelope> {
    let requestId=typeof (raw as any)?.requestId==='string'?(raw as any).requestId:'';
    try {
      const req=parseRequest(raw);requestId=req.requestId;
      const write=!reads.has(req.method);
      if(write&&req.expectedRevision===undefined&&!req.idempotencyKey)fail('WRITE_GUARD_REQUIRED','写操作需要版本或幂等键');
      const key=req.idempotencyKey?`ipc:${req.method}:${req.idempotencyKey}`:null;
      // Hash only: credentials and full request parameters never enter the journal.
      const fingerprint=hash(JSON.stringify({method:req.method,params:req.params,revision:req.expectedRevision}));
      const cached=key?this.db.getSetting<{hash:string;result:unknown}|null>(key,null):null;
      if(key&&this.inflightHashes.has(key)&&this.inflightHashes.get(key)!==fingerprint)fail('IDEMPOTENCY_CONFLICT','幂等键已用于不同请求');
      if(cached) { if(cached.hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT','幂等键已用于不同请求'); return {version:1,requestId,ok:true,result:cached.result}; }
      const execute=async()=>{
        let result:unknown;
        if(req.method.startsWith('accounts.'))result=await this.handleAccount(req.method,req.params as any);
        else if(req.method==='connections.probe')result=await this.probe((req.params as {id:string}).id);
        else if(reads.has(req.method)&&req.method!=='data.importPreview')result=this.dispatch(req as IpcRequestEnvelope);
        else result=this.vault.withRollback(()=>this.db.writeTransaction(()=>{
          const out=this.dispatch(req as IpcRequestEnvelope);
          if(key)this.db.setSetting(key,{hash:fingerprint,result:out??null});
          return out;
        }));
        if(key&&(req.method==='connections.probe'||req.method==='accounts.add'))this.db.setSetting(key,{hash:fingerprint,result:result??null});
        if(write)this.changed();
        return result;
      };
      let pending=key?this.inflight.get(key):undefined;
      if(!pending) { pending=execute();if(key){this.inflight.set(key,pending);this.inflightHashes.set(key,fingerprint);} }
      try { return {version:1,requestId,ok:true,result:await pending}; } finally {if(key){this.inflight.delete(key);this.inflightHashes.delete(key);}}
    } catch(error) {
      const code=error instanceof BusinessError?error.code:error instanceof ZodError?'VALIDATION_ERROR':(error as {code?:string})?.code??'SERVICE_ERROR';
      const message=error instanceof ZodError?'输入资料格式无效，请检查日期、金额和必填项':sanitizeDiagnosticText(error instanceof Error?error.message:'本地操作失败');
      return {version:1,requestId,ok:false,error:{code,message}};
    }
  }
  private async handleAccount(method:string,p:any):Promise<unknown> {
    if(method==='accounts.discover')return this.accountAccess.discover();
    if(method==='accounts.loginStart')return this.accountAccess.startLogin(p.providerId);
    if(method==='accounts.loginPoll') {
      const result=await this.accountAccess.pollLogin(p.id);
      if(result.status!=='complete'||!result.credential)return {status:result.status};
      return {status:'complete',...this.addCredential(result.credential)};
    }
    if(p.providerId==='remote-magpie'&&!p.candidateId){
      let input:any;try{input=JSON.parse(p.secret);}catch{fail('AUTH_REQUIRED','请填写远端地址与访问 Key');}
      const origin=remoteOrigin(input.origin),key=typeof input.apiKey==='string'?input.apiKey.trim():'';
      if(!key||/[\r\n]/.test(key))fail('AUTH_REQUIRED','远端访问 Key 无效');
      const subject=hashKeySubject('remote-magpie',origin+'\0'+key),alias=`远端 Magpie (${new URL(origin).hostname})`;
      return this.addCredential({providerId:'remote-magpie',subject,alias,secret:JSON.stringify({origin,approvedOrigin:origin,accessToken:key,subject,alias,source:'remote-magpie',management:'static'})});
    }
    if(p.providerId==='relay-wallet'&&!p.candidateId){
      const { approveRelayCredential } = await import('./adapters/relay-account-adapter');
      return this.addCredential(approveRelayCredential(p.secret));
    }
    const cloud=SERVICE_ACCESS.find(s=>s.id===p.providerId&&s.cloudRegion);
    if(cloud&&!p.candidateId){
      let values:any;try{values=JSON.parse(p.secret);}catch{fail('AUTH_REQUIRED','请填写云平台访问凭据');}
      const ak=typeof values.accessKeyId==='string'?values.accessKeyId.trim():'',sk=typeof values.secretAccessKey==='string'?values.secretAccessKey.trim():'',teamId=typeof values.teamId==='string'?values.teamId.trim():'';
      if(!ak||!sk||/[\r\n]/.test(ak+sk+teamId))fail('AUTH_REQUIRED','访问凭据格式无效');
      const subject=hashKeySubject(cloud.id,ak+'\0'+teamId),alias=cloud.name+' 账号';
      return this.addAccountCredential({providerId:cloud.id,subject,alias,organization:teamId,secret:JSON.stringify({accessKeyId:ak,secretAccessKey:sk,teamId,region:cloud.cloudRegion,source:cloud.id,subject,alias,management:'static'})});
    }
    const credential=p.candidateId?await this.accountAccess.resolve(p.candidateId):{
      providerId:p.providerId,subject:hashKeySubject(p.providerId,p.secret),alias:'API Key',secret:p.secret,
    };
    return this.addAccountCredential(credential);
  }
  private async addAccountCredential(credential: AccountCredential) {
    if (!credential.providerId.startsWith('tencent-token-plan-')) return this.addCredential(credential);
    let value: Record<string, unknown>; try { value = JSON.parse(credential.secret); } catch { return this.addCredential(credential); }
    if (value.teamId || value.TeamId) return this.addCredential(credential);
    const result = await this.collector.collect(credential.providerId, { connectionId: `team-discovery-${randomUUID()}`, generation: 1, reason: 'probe', secret: credential.secret, expectedSubject: credential.subject });
    if (this.closed) fail('CANCELLED', '应用已退出');
    if (result.partialFailures.some(f=>f.field.startsWith('list:'))) fail('PARTIAL', '团队列表未完整读取，请稍后重试');
    const teams = result.discoveredOrganizations ?? [];
    if (!teams.length) fail('PERMISSION_DENIED', '当前地区未发现可读取的企业套餐团队');
    return this.vault.withRollback(()=>this.db.writeTransaction(()=>{
      const added = teams.map(team=>this.addCredential(tencentTeamCredential(credential, team)));
      return added[0];
    }));
  }
  private addCredential(credential:AccountCredential) {
    if(this.closed)fail('CANCELLED','应用已退出');
    return this.vault.withRollback(()=>this.db.writeTransaction(()=>{
      const id=`${credential.providerId}:${hash(credential.subject).slice(0,32)}`;
      this.db.ensureConnection(credential.providerId,id);
      const c=this.connection(id);
      let sub=this.db.listSubscriptions().find(s=>s.connectionId===id);
      if(sub&&['ready','refreshing','partial'].includes(c.state)&&this.vault.getSecret(c.credentialRef)===credential.secret)
        return {subscriptionId:sub.id,connectionId:id};
      this.scheduler.cancel(id);
      const saved=this.vault.saveSecret(id,credential.secret,c.credentialRef);
      this.db.updateConnection(id,{credentialRef:saved.credentialRef,generation:c.generation+1,state:'ready',accountSubject:credential.subject,accountAlias:credential.alias,accountOrg:credential.organization,error:null});
      if(!sub){sub=this.emptySubscription(id);sub.management='automatic';sub.account=credential.alias;sub.organization=credential.organization??'个人';this.save(sub);}
      this.scheduler.enqueue(id);
      this.db.rawPrepare('UPDATE collection_jobs SET consecutive_schema_errors=0 WHERE connection_id=?').run(id);
      return {subscriptionId:sub.id,connectionId:id};
    }));
  }
  private dispatch(req:IpcRequestEnvelope):unknown {
    const p=req.params as any;
    switch(req.method) {
      case 'subscriptions.snapshot':return this.snapshot();
      case 'subscriptions.create': {
        if(p.input.connectionId) this.connection(p.input.connectionId);
        const sub={...p.input,id:randomUUID(),revision:1,history:[]};this.save(sub);return sub.id;
      }
      case 'subscriptions.update': {
        const sub=this.subscription(p.id);if(req.expectedRevision!==sub.revision)fail('REVISION_CONFLICT','资料已更新，请重新打开后编辑');
        if(p.patch.connectionId&&p.patch.connectionId!==sub.connectionId)fail('BIND_REQUIRED','请通过探测流程绑定连接');
        const patch=writableSubscriptionPatch(sub,p.patch);
        const next={...sub,...patch};this.history(next,'更新订阅资料');this.save(next);return;
      }
      case 'subscriptions.archive': {
        const sub=this.subscription(p.id);if(p.archived&&sub.lifecycle!=='archived'){sub.archivedFrom=sub.lifecycle;sub.lifecycle='archived';}else if(!p.archived&&sub.lifecycle==='archived'){sub.lifecycle=sub.archivedFrom??'active';delete sub.archivedFrom;}
        this.history(sub,p.archived?'归档订阅':'恢复订阅');this.save(sub);return;
      }
      case 'subscriptions.remove': {
        const sub=this.subscription(p.id),token=randomUUID();this.db.setSetting(`undo:${token}`,{sub,expires:this.now()+30000});this.db.deleteSubscription(sub.id);
        if(sub.connectionId&&!this.db.listSubscriptions().some(s=>s.connectionId===sub.connectionId)) {
          const c=this.connection(sub.connectionId);this.scheduler.cancel(c.id);this.db.updateConnection(c.id,{state:'paused',generation:c.generation+1});
        }
        return token;
      }
      case 'subscriptions.undo': {
        const undo=this.db.getSetting<{sub:Subscription;expires:number}|null>(`undo:${p.token}`,null);if(!undo||undo.expires<this.now())fail('UNDO_EXPIRED','撤销已过期');if(this.db.getSubscription(undo.sub.id))fail('REVISION_CONFLICT','该订阅已存在');this.save(undo.sub);
        if(undo.sub.connectionId){const c=this.connection(undo.sub.connectionId);if(c.credentialRef){this.db.updateConnection(c.id,{state:'ready'});this.scheduler.enqueue(c.id);}}
        this.db.setSetting(`undo:${p.token}`,null);return;
      }
      case 'subscriptions.reorder': {
        const all=new Set(this.db.listSubscriptions().map(s=>s.id));if(new Set(p.ids).size!==p.ids.length||p.ids.some((id:string)=>!all.has(id)))fail('VALIDATION_ERROR','排序包含重复或不存在的订阅');this.db.savePreferences({...this.db.getPreferences(),order:p.ids});this.db.bumpSpaceRevision();return;
      }
      case 'preferences.set':this.db.savePreferences(preferencesSchema.parse({...this.db.getPreferences(),...p.patch}));this.db.bumpSpaceRevision();return;
      case 'subscriptions.resolveField': {
        const sub=this.subscription(p.id),field=sub[p.field as 'plan'];
        if(isAutomatic(sub)&&p.field==='price')fail('AUTOMATIC_FIELD','实际支付请直接编辑，供应商标价不能覆盖支付金额');
        const proposal=this.db.getSetting<Field<string>|null>(`proposal:${sub.id}:${p.field}`,null);
        if(p.accept&&proposal)sub[p.field as 'plan']={...proposal,locked:false};else delete field.proposed;
        this.db.setSetting(`proposal:${sub.id}:${p.field}`,null);this.history(sub,p.accept?'接受自动来源':'保留锁定字段');this.save(sub);return;
      }
      case 'connections.beginAuth': {
        const catalog=OFFICIAL_ADAPTER_CATALOG.find(c=>c.adapterId===p.provider||c.provider===p.provider);if(!catalog)fail('UNSUPPORTED','当前产品仅支持手动记录');
        if(p.subscriptionId)this.subscription(p.subscriptionId);
        const selected=p.subscriptionId?this.subscription(p.subscriptionId):null;
        const existing=selected?.connectionId?this.connection(selected.connectionId):this.db.getConnectionRow(catalog.adapterId);
        const reuse=existing?.providerId===catalog.adapterId&&(selected?.connectionId||existing.state==='disconnected'||existing.state==='paused');
        const connectionId=this.db.ensureConnection(catalog.adapterId,reuse?existing!.id:existing?`${catalog.adapterId}:${randomUUID()}`:catalog.adapterId);
        const c=this.connection(connectionId);this.scheduler.cancel(c.id);
        this.db.updateConnection(c.id,{generation:c.generation+1,state:'paused',error:null});
        this.db.setSetting(`auth:${c.id}`,{subscriptionId:p.subscriptionId});
        return {connectionId:c.id,fields:catalog.fields,unsupported:catalog.unsupported,permissions:catalog.permissions,credentialLocation:catalog.credentialLocation,authMode:catalog.authMode,verification:'pending'};
      }
      case 'connections.saveCredential': {
        const c=this.connection(p.connectionId);if(c.authType!=='api_key')fail('UNSUPPORTED','官方客户端自行管理凭据');
        const saved=this.vault.saveSecret(c.id,p.secret,c.credentialRef);this.scheduler.cancel(c.id);this.db.updateConnection(c.id,{credentialRef:saved.credentialRef,generation:c.generation+1,state:'paused',error:null});return {mask:saved.mask};
      }
      case 'connections.deleteCredential':this.disconnect(p.connectionId,true);return;
      case 'connections.disconnect':this.disconnect(p.id,p.removeCredential);return;
      case 'connections.bind': {
        const record=this.db.getSetting<ProbeRecord|null>(`probe:${p.probe.id}`,null);if(!record||record.expires<this.now()||JSON.stringify(record.probe)!==JSON.stringify(p.probe))fail('PROBE_EXPIRED','探测结果已失效，请重新探测');
        const c=this.connection(record.probe.connectionId);if(c.generation!==record.probe.generation)fail('PROBE_EXPIRED','连接已改变，请重新探测');
        let sub=record.subscriptionId?this.subscription(record.subscriptionId):this.db.listSubscriptions().find(s=>s.connectionId===c.id&&s.lifecycle!=='archived');
        if(!sub)sub=this.emptySubscription(c.id);
        if(c.accountSubject&&c.accountSubject!==record.output.account.subject) {
          for(const previous of this.db.listSubscriptions().filter(s=>s.connectionId===c.id&&s.id!==sub.id)) {previous.connectionId=null;this.history(previous,'账号变更，保留原账号观察值并断开采集');this.save(previous);}
          sub.metrics=[];sub.quotaPoolId=null;
          for(const name of ['plan','price','renewalDate'] as const)if(!sub[name].locked&&['official_api','local_client'].includes(sub[name].dataOrigin))sub[name]={...sub[name],value:null,availability:'unfetched',observedAt:null};
          this.history(sub,'确认绑定新账号');
        }
        sub.connectionId=c.id;sub.account=record.output.account.alias;this.save(sub);
        this.db.updateConnection(c.id,{generation:c.generation+1,state:record.output.partialFailures.length?'partial':'ready',accountAlias:record.output.account.alias,accountSubject:record.output.account.subject,accountRegion:record.output.account.region,accountOrg:record.output.account.organization,error:null});
        this.applyCollection(c.id,record.output);this.db.setSetting(`probe:${p.probe.id}`,null);this.scheduler.enqueue(c.id,this.now()+this.scheduler.manifest(c.id).defaultForegroundSeconds*1000);return;
      }
      case 'connections.pause': {
        const cs=p.id?[this.connection(this.resolveConnectionId(p.id))]:this.db.listConnections().map(c=>this.connection(c.id));
        const resume=cs.filter(c=>c.state!=='disconnected').every(c=>c.state==='paused');
        for(const c of cs) {if(c.state==='disconnected')continue;this.scheduler.cancel(c.id);this.db.updateConnection(c.id,{generation:c.generation+1,state:resume&&c.accountSubject?'ready':'paused'});if(resume&&c.accountSubject)this.scheduler.enqueue(c.id);}
        return;
      }
      case 'collections.refresh': {
        const ids=p.id?[this.resolveConnectionId(p.id)]:this.db.listConnections().filter(c=>!['disconnected','paused','auth','denied','runtime_missing'].includes(c.state)).map(c=>c.id);
        for(const id of ids){const c=this.connection(id);if(['disconnected','paused','auth','denied','runtime_missing'].includes(c.state))fail('RECONNECT_REQUIRED','请先启用连接');this.scheduler.enqueue(id);}
        return ids.length?`已加入刷新队列（${ids.length} 个连接），按允许频率执行`:'没有可刷新的连接';
      }
      case 'collections.diagnose':return JSON.stringify({schemaVersion:1,storageError:Boolean(this.db.getStorageError()),notifications:this.db.getSetting('notificationStatus','unknown'),connections:this.db.listConnections().map(c=>({adapter:c.adapterId,state:c.state,generation:c.generation,version:c.version,verification:c.verification,lastAttempt:c.lastAttempt,lastSuccess:c.lastSuccess,errorCode:c.error?.code??null}))},null,2);
      case 'calendars.events':return projectEvents(this.db.listSubscriptions().filter(s=>s.lifecycle!=='archived'),new Date(this.now()).toISOString(),p.includeReset);
      case 'data.export':return JSON.stringify({schemaVersion:2,format:'subcal-backup',exportedAt:new Date(this.now()).toISOString(),subscriptions:this.db.listSubscriptions(),preferences:this.db.getPreferences()},null,2);
      case 'data.importPreview': {
        const imported=this.parseImport(p.text),current=this.db.listSubscriptions(),id=randomUUID();
        const old=new Set(current.map(s=>s.id)),next=new Set(imported.subscriptions.map(s=>s.id));
        const preview:ImportPreview={id,count:next.size,currentCount:old.size,added:[...next].filter(x=>!old.has(x)).length,overwritten:[...next].filter(x=>old.has(x)).length,removed:[...old].filter(x=>!next.has(x)).length,scenario:'empty_first_run',text:p.text};
        this.db.setSetting(`import:${id}`,{hash:hash(p.text),revision:this.db.getSpaceRevision(),expires:this.now()+600000});return preview;
      }
      case 'data.importCommit': {
        const preview=this.db.getSetting<{hash:string;revision:number;expires:number}|null>(`import:${p.id}`,null);
        if(!preview||preview.hash!==hash(p.text)||preview.expires<this.now()||preview.revision!==this.db.getSpaceRevision())fail('IMPORT_CHANGED','文件或当前资料已改变，请重新预览');
        const imported=this.parseImport(p.text);
        for(const c of this.db.listConnections())this.disconnect(c.id,false);
        for(const s of this.db.listSubscriptions())this.db.deleteSubscription(s.id);
        for(const sub of imported.subscriptions){if(sub.connectionId)sub.management='automatic';sub.connectionId=null;this.save(sub);}
        this.db.savePreferences(imported.preferences);this.db.setSetting(`import:${p.id}`,null);return;
      }
      default:return fail('NOT_IMPLEMENTED','外部日历同步待接入；当前不会写入外部日历');
    }
  }
  private parseImport(text:string) {
    if(Buffer.byteLength(text,'utf8')>2*1024*1024)fail('INVALID_IMPORT','导入文件不能超过 2MB');
    let raw:any;try{raw=JSON.parse(text);}catch{fail('INVALID_IMPORT','不是有效 JSON 文件');}
    const source=raw?.format==='subcal-backup'?raw:raw?.spaces?.[raw.active]??raw?.space??raw;
    if(![1,2].includes(raw?.schemaVersion)||!Array.isArray(source?.subscriptions)||source.subscriptions.length>10000)fail('INVALID_IMPORT','备份格式或版本不支持');
    const subscriptions:Subscription[]=source.subscriptions.map((s:unknown)=>subscriptionSchema.parse(s));
    if(new Set(subscriptions.map(s=>s.id)).size!==subscriptions.length)fail('INVALID_IMPORT','备份中订阅 ID 重复');
    return {subscriptions,preferences:preferencesSchema.parse({...DEFAULT_PRODUCTION_PREFERENCES,...raw.preferences})};
  }
  private resolveConnectionId(id:string) {return this.db.getConnectionRow(id)?id:this.subscription(id).connectionId??fail('NO_CONNECTION','此订阅尚未连接');}
  private disconnect(id:string,removeCredential:boolean) {
    const c=this.connection(id);this.scheduler.cancel(id);
    if(removeCredential)this.vault.deleteSecret(c.credentialRef);
    this.db.updateConnection(id,{generation:c.generation+1,state:'disconnected',credentialRef:removeCredential?null:c.credentialRef,error:null});
    for(const sub of this.db.listSubscriptions().filter(s=>s.connectionId===id)){sub.connectionId=null;this.history(sub,'断开采集，保留历史观察值');this.save(sub);}
  }
  private async probe(id:string) {
    const c=this.connection(id),output=await this.scheduler.run(id,'probe');
    if(this.connection(id).generation!==c.generation)fail('PROBE_EXPIRED','连接已变更');
    const probe:Probe={id:randomUUID(),connectionId:id,generation:c.generation,account:output.account.alias,fields:[...output.metrics.map(m=>m.label),...output.fields.map(f=>f.field)],samples:output.samples.map(s=>sanitizeDiagnosticText(s))};
    const auth=this.db.getSetting<{subscriptionId?:string}>(`auth:${id}`,{});
    this.db.setSetting(`probe:${probe.id}`,{probe,output,subscriptionId:auth.subscriptionId,expires:this.now()+600000} satisfies ProbeRecord);return probe;
  }
  private emptySubscription(id:string):Subscription {
    const m=this.scheduler.manifest(id),unknown=():Field<string>=>({value:null,availability:'unfetched',source:'来源尚未提供',observedAt:null,dataOrigin:'manual'});
    return {id:randomUUID(),revision:1,product:m.product,brand:m.brand,kind:m.authMode==='api_key'?'wallet':'window',account:'',region:m.region,organization:'个人',plan:unknown(),price:unknown(),currency:m.id==='kimi-platform-cn'?'CNY':'USD',cycle:m.authMode==='api_key'?'none':'irregular',intervalDays:30,anchorDate:null,timezone:this.db.getPreferences().timezone,startDate:unknown(),renewalDate:unknown(),paidThrough:unknown(),trialEnd:unknown(),lifecycle:'active',autoRenew:'unknown',billingGroupId:null,quotaPoolId:null,possibleSharedWallet:false,metrics:[],connectionId:id,website:'',reminder:'local',pinned:false,notes:'',history:[]};
  }
  applyCollection(id:string,result:CollectOutput) {
    for(const sub of this.db.listSubscriptions().filter(s=>s.connectionId===id)) {
      sub.management='automatic';sub.quotaPoolId=result.poolId||sub.quotaPoolId;sub.account=result.account.alias;
      const successfulEntitlements=result.partialFailures.some(f=>f.field==='entitlements')?{}:{...result.entitlements};
      for(const key of Object.keys(successfulEntitlements))if(result.partialFailures.some(f=>f.field===key||f.field===`entitlements.${key}`))delete (successfulEntitlements as Record<string,unknown>)[key];
      sub.entitlements=mergeEntitlements(sub.entitlements,successfulEntitlements);
      sub.credentialExpiresAt=mergeObservation(sub.credentialExpiresAt,result.credentialExpiresAt);
      sub.balances=mergeBalances(sub.balances,result.partialFailures.some(f=>f.field==='balances')?[]:result.balances?.filter(b=>!result.partialFailures.some(f=>f.field===b.id||f.field===`balances.${b.id}`)));
      for(const observation of result.fields) {
        const {field:fieldName,...value}=observation;
        const field:Field<string>={...value,evidence:observation.evidence??'reported'};
        if(result.partialFailures.some(f=>f.field===observation.field))continue;
        // A provider price is a list price, never the user's actual payment.
        if(fieldName==='price'){sub.entitlements=mergeEntitlements(sub.entitlements,{listPrice:field});continue;}
        const old=sub[observation.field];if(old.observedAt&&old.observedAt>observation.observedAt)continue;
        if(mergeObservation(old,field)===old)continue;
        if(old.locked&&old.value!==field.value) { old.proposed=field.value??undefined;this.db.setSetting(`proposal:${sub.id}:${observation.field}`,field); }else sub[observation.field]={...field,locked:old.locked};
      }
      for(const m of result.metrics) {
        if(result.partialFailures.some(f=>f.field===m.id)||['unfetched','denied'].includes(m.availability))continue;
        const existing=sub.metrics.find(x=>x.id===m.id);
        const old=existing?.unit===m.unit?existing:undefined;
        if(old?.remaining.observedAt&&Date.parse(old.remaining.observedAt)>Date.parse(m.observedAt))continue;
        const observed:Field<string>={value:m.remaining,availability:m.availability,source:m.source,observedAt:m.observedAt,dataOrigin:m.dataOrigin,evidence:m.evidence??'reported'};
        const remaining=mergeObservation(old?.remaining,observed)!;
        const metric={...old,id:m.id,label:m.label,unit:m.unit,total:m.total??old?.total??null,resetAt:m.resetAt??old?.resetAt??null,staleAfterMinutes:m.staleAfterMinutes,remaining,
          used:mergeObservation(old?.used,m.used===undefined?undefined:{...observed,value:m.used}),totalObservation:mergeObservation(old?.totalObservation,m.totalObservation),resetObservation:mergeObservation(old?.resetObservation,m.resetObservation),windowStart:mergeObservation(old?.windowStart,m.windowStart),windowEnd:mergeObservation(old?.windowEnd,m.windowEnd),
          windowMinutes:m.windowMinutes??old?.windowMinutes,scope:m.scope??old?.scope,models:m.models??old?.models,poolId:m.poolId??old?.poolId,evidence:m.evidence??old?.evidence??'reported'};
        for(const key of ['remaining','used','totalObservation','resetObservation','windowStart','windowEnd','windowMinutes','scope','models','poolId','total','resetAt'] as const) {
          if(result.partialFailures.some(f=>f.field===`${m.id}.${key}`||f.field===`metrics.${m.id}.${key}`)) {
            if(old?.[key]!==undefined)(metric as Record<string,unknown>)[key]=old[key];
            else if(key==='total'||key==='resetAt')metric[key]=null;
            else if(key!=='remaining')delete (metric as Record<string,unknown>)[key];
            else metric.remaining={...observed,value:null,availability:'unfetched',observedAt:null};
          }
        }
        if(existing)sub.metrics[sub.metrics.indexOf(existing)]=metric;else sub.metrics.push(metric);
      }
      sub.revision++;this.save(sub);
    }
    for(const m of result.metrics)if(!result.partialFailures.some(f=>f.field===m.id||f.field.startsWith(`${m.id}.`)||f.field.startsWith(`metrics.${m.id}.`))&&!['unfetched','denied'].includes(m.availability))this.db.recordMetricObservation({poolId:m.poolId??result.poolId,unit:m.unit,meterKey:m.id,remaining:m.remaining,total:m.total,resetAtMs:m.resetAt?.includes('T')?Date.parse(m.resetAt):null,observedAtMs:Date.parse(m.observedAt),source:m.source,availability:m.availability,used:m.used,observation:m});
  }
  close() {this.closed=true;if(this.credentialTimer)clearInterval(this.credentialTimer);this.scheduler.close();this.db.close();}
}
