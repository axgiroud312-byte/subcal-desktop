import { randomUUID } from 'node:crypto';
import type { SubCalDatabase } from './db/database';
import type { CredentialVault } from './credentials';
import { sanitizeDiagnosticText } from './credentials';
import type { AdapterManifest, CollectInput, CollectOutput } from './adapters/types';
import { AdapterError, defaultDescribeRecovery } from './adapters/types';

export interface CollectorPort { collect(id:string,input:CollectInput):Promise<CollectOutput>; cancel(id:string):void; close():void }
type Job = { id:string; connection_id:string; state:string; next_run_at:number; lease_until:number|null; attempt:number; generation:number; consecutive_schema_errors:number };
export class Scheduler {
  private active = new Map<string, Promise<CollectOutput>>();
  private providers = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private suspended = false;
  private online = true;
  setOnline(online:boolean) {const recovered=!this.online&&online;this.online=online;if(recovered)this.resume();}
  foreground = true;
  constructor(private db:SubCalDatabase, private vault:CredentialVault, private collector:CollectorPort, private manifests:readonly AdapterManifest[], private apply:(id:string,result:CollectOutput)=>void, private changed:()=>void = ()=>{}, private now:()=>number = Date.now, private random:()=>number = Math.random) {}
  manifest(id:string) { const c=this.db.getConnectionRow(id); const m=this.manifests.find(x=>x.id===c?.providerId); if(!m) throw new Error('连接不存在'); return m; }
  job(id:string) { return this.db.rawPrepare('SELECT * FROM collection_jobs WHERE connection_id=?').get(id) as Job|undefined; }
  enqueue(id:string, at=this.now()) {
    const c=this.db.getConnectionRow(id); if(!c) throw new Error('连接不存在');
    const floor=Math.max(c.nextAllowedAt??0,this.db.getSetting<number>(`limit:${c.providerId}`,0));
    this.db.writeTransaction(()=>this.db.rawPrepare(`INSERT INTO collection_jobs(id,connection_id,capability,next_run_at,state,generation) VALUES(?,?,'quota',?,'queued',?) ON CONFLICT(connection_id,capability) DO UPDATE SET next_run_at=CASE WHEN collection_jobs.state='running' THEN collection_jobs.next_run_at ELSE MIN(collection_jobs.next_run_at,excluded.next_run_at) END, state=CASE WHEN collection_jobs.state='running' THEN 'running' ELSE 'queued' END, generation=excluded.generation`).run(`job:${id}`,id,Math.max(at,floor),c.generation));
    return `job:${id}`;
  }
  start() { this.stopped=false; this.resume(); this.timer=setInterval(()=>{void this.tick().catch(()=>{this.suspended=true;});},1000); this.timer.unref?.(); }
  suspend() { this.suspended=true; }
  resume() {
    this.suspended=false;
    const now=this.now();
    this.db.writeTransaction(()=>{
      const rows=this.db.rawPrepare("SELECT * FROM collection_jobs WHERE state IN ('queued','running')").all() as Job[];
      for(const j of rows) if(!this.active.has(j.connection_id) && (j.state!=='running'||(j.lease_until??0)<=now)) this.db.rawPrepare("UPDATE collection_jobs SET state='queued',lease_until=NULL,next_run_at=? WHERE id=?").run(Math.max(j.next_run_at,now+Math.floor(this.random()*30000)),j.id);
    });
  }
  async tick() {
    if(this.stopped||this.suspended||!this.online||this.db.getStorageError())return;
    const now=this.now();
    const rows=this.db.rawPrepare("SELECT * FROM collection_jobs WHERE (state='queued' AND next_run_at<=?) OR (state='running' AND lease_until<=?) ORDER BY next_run_at").all(now,now) as Job[];
    for(const j of rows) {
      const c=this.db.getConnectionRow(j.connection_id);
      if(!c||['paused','auth','denied','disconnected','runtime_missing'].includes(c.state)||j.consecutive_schema_errors>=5)continue;
      if(this.active.size>=3)break;
      if(this.providers.has(c.providerId)||this.active.has(c.id))continue;
      void this.run(c.id,'scheduled').catch(()=>{});
    }
    const lastCleanup=this.db.getSetting<number>('retention:lastCleanupAt',0);
    if(now-lastCleanup>=3600000)this.db.writeTransaction(()=>{
      this.db.rawPrepare('DELETE FROM metric_observations WHERE observed_at<?').run(now-90*86400000);
      this.db.rawPrepare('DELETE FROM collection_runs WHERE finished_at<?').run(now-30*86400000);
      this.db.setSetting('retention:lastCleanupAt',now);
    });
  }
  run(id:string,reason:CollectInput['reason']):Promise<CollectOutput> {
    const current=this.active.get(id); if(current)return current;
    const c=this.db.getConnectionRow(id); if(!c)return Promise.reject(new Error('连接不存在'));
    const m=this.manifest(id), now=this.now();
    if(this.stopped||this.suspended)return Promise.reject(new Error('采集已暂停'));
    if(!this.online)return Promise.reject(new AdapterError('NETWORK_OFFLINE','网络离线，已保留历史观察值'));
    if(reason!=='probe'&&(['paused','auth','denied','disconnected','runtime_missing'].includes(c.state)|| (this.job(id)?.consecutive_schema_errors??0)>=5))return Promise.reject(new Error('请先重新连接'));
    if(this.active.size>=3||this.providers.has(c.providerId))return Promise.reject(new Error('采集正在排队，请稍后重试'));
    const floor=Math.max(c.nextAllowedAt??0,this.db.getSetting<number>(`limit:${c.providerId}`,0));
    if(floor>now)return Promise.reject(new AdapterError('RATE_LIMITED','尚未到允许查询时间',{retryAfterMs:floor-now}));
    const j=this.job(id); if(j?.state==='running'&&(j.lease_until??0)>now)return Promise.reject(new Error('采集租约尚未到期'));
    const sequence=this.db.getSetting<number>(`sequence:${id}`,0)+1;
    const runId=randomUUID(), generation=c.generation;
    this.db.writeTransaction(()=>{
      this.enqueue(id,now);
      this.db.rawPrepare("UPDATE collection_jobs SET state='running',lease_until=?,attempt=attempt+1,generation=? WHERE connection_id=?").run(now+Math.max(m.timeoutMs+15000,60000),generation,id);
      this.db.rawPrepare("INSERT INTO collection_runs(id,job_id,started_at,result,adapter_version,sequence) VALUES(?,?,?,'running',?,?)").run(runId,`job:${id}`,now,m.version,sequence);
      this.db.setSetting(`sequence:${id}`,sequence);
      this.db.setSetting(`limit:${c.providerId}`,now+m.minIntervalSeconds*1000);
      this.db.updateConnection(id,{state:'refreshing',lastAttemptAt:now,nextAllowedAt:now+m.minIntervalSeconds*1000,runs:c.runs+1});
    });
    this.providers.add(c.providerId);
    const promise=Promise.resolve().then(()=>this.collector.collect(m.id,{connectionId:id,generation,reason,secret:this.vault.getSecret(c.credentialRef),expectedSubject:reason==='probe'?null:c.accountSubject,timeoutMs:m.timeoutMs})).then(result=>{
      if(this.stopped)throw new AdapterError('CANCELLED','应用已退出');
      const latest=this.db.getConnectionRow(id);
      if(latest?.generation!==generation||this.db.getSetting(`sequence:${id}`,0)!==sequence)throw new AdapterError('CANCELLED','连接已变更，旧结果已丢弃');
      if(reason!=='probe'&&c.accountSubject&&c.accountSubject!==result.account.subject)throw new AdapterError('ACCOUNT_MISMATCH','官方客户端账号已改变，请重新核对');
      this.db.writeTransaction(()=>{
        if(reason!=='probe')this.apply(id,result);
        this.db.updateConnection(id,{state:result.partialFailures.length?'partial':(reason==='probe'?'paused':'ready'),lastSuccessAt:this.now(),error:result.partialFailures.length?{code:'PARTIAL',message:sanitizeDiagnosticText(result.partialFailures.map(f=>f.reason).join('；')).slice(0,1000),action:'已保留可用资料，将自动重试未更新的项目'}:null});
        let next=this.now()+(this.foreground?m.defaultForegroundSeconds:m.defaultBackgroundSeconds)*1000;
        for(const metric of result.metrics) { const reset=metric.resetAt?.includes('T')?Date.parse(metric.resetAt):0; if(reset>this.now())next=Math.min(next,reset+30000+Math.floor(this.random()*90000)); }
        next=Math.max(next,now+m.minIntervalSeconds*1000);
        this.db.rawPrepare('UPDATE collection_jobs SET state=?,lease_until=NULL,next_run_at=?,attempt=0,consecutive_schema_errors=0 WHERE connection_id=?').run(reason==='probe'?'paused':'queued',next,id);
        this.db.rawPrepare("UPDATE collection_runs SET finished_at=?,result=?,error_code=NULL WHERE id=?").run(this.now(),result.partialFailures.length?'partial':'success',runId);
      });
      return result;
    }).catch((error:unknown)=>{
      if(this.stopped)throw error;
      if(this.db.getConnectionRow(id)?.generation!==generation)return Promise.reject(error);
      const e=error instanceof AdapterError?error:new AdapterError('UPSTREAM_UNAVAILABLE','采集未完成，请稍后重试');
      const recovery=defaultDescribeRecovery(m,e);
      const job=this.job(id)!;
      const schemaErrors=e.code==='SCHEMA_CHANGED'?job.consecutive_schema_errors+1:0;
      const stop=['AUTH_REQUIRED','PERMISSION_DENIED','ACCOUNT_MISMATCH','RUNTIME_MISSING','CANCELLED'].includes(e.code)||schemaErrors>=5||reason==='probe';
      const delay=Math.max(m.minIntervalSeconds*1000,e.options?.retryAfterMs??0,[60000,300000,900000,3600000][Math.min(Math.max(job.attempt-1,0),3)])+Math.floor(this.random()*5000);
      this.db.writeTransaction(()=>{
        this.db.setSetting(`limit:${c.providerId}`,this.now()+delay);
        this.db.updateConnection(id,{state:recovery.state,error:{code:e.code,message:sanitizeDiagnosticText(recovery.message),action:recovery.action},nextAllowedAt:this.now()+delay});
        this.db.rawPrepare('UPDATE collection_jobs SET state=?,lease_until=NULL,next_run_at=?,consecutive_schema_errors=? WHERE connection_id=?').run(stop?'paused':'queued',this.now()+delay,schemaErrors,id);
        this.db.rawPrepare("UPDATE collection_runs SET finished_at=?,result='failed',error_code=? WHERE id=?").run(this.now(),e.code,runId);
      });
      throw e;
    }).finally(()=>{this.active.delete(id);this.providers.delete(c.providerId);if(!this.stopped)this.changed();});
    this.active.set(id,promise);this.changed();return promise;
  }
  cancel(id:string) { this.collector.cancel(id); this.db.writeTransaction(()=>this.db.rawPrepare("UPDATE collection_jobs SET state='paused',lease_until=NULL WHERE connection_id=?").run(id)); }
  close() { this.stopped=true; if(this.timer)clearInterval(this.timer); this.collector.close(); }
}
