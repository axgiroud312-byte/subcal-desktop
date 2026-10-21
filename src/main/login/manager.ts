import { randomUUID } from 'node:crypto';
import type { AccountCredential } from '../account-access';
import type { LoginFlow, LoginOptions } from './types';

export interface LoginTicket {
  id: string; userCode: string; verificationUri: string; intervalSeconds: number; expiresAt: number;
  instructions?: string; requiresCode?: boolean;
}
type Record = { providerId: string; flow: LoginFlow; nextPoll: number; result?: AccountCredential; running?: Promise<LoginResult>; timer: ReturnType<typeof setTimeout> };
type LoginResult = { status: 'pending' | 'complete' | 'expired'; credential?: AccountCredential };
export type LoginFactory = (providerId: string, options: LoginOptions) => Promise<LoginFlow>;

/** Owns pending browser logins, never exposes tokens or verifier/state to IPC. */
export class BrowserLoginManager {
  private readonly records = new Map<string, Record>();
  private readonly starting = new Map<string, AbortController>();
  constructor(private readonly factory: LoginFactory, private readonly options: LoginOptions) {}
  has(id: string) { return this.records.has(id); }
  ownsUrl(url: string) { return [...this.records.values()].some(r=>r.flow.expiresAt>this.options.now() && r.flow.url===url && !r.result); }
  async openUrl(url: string): Promise<boolean> {
    const record=[...this.records.values()].find(r=>r.flow.expiresAt>this.options.now()&&r.flow.url===url&&!r.result);
    if(!record?.flow.open)return false;
    await record.flow.open();return true;
  }
  async start(providerId: string): Promise<LoginTicket> {
    this.starting.get(providerId)?.abort();
    for (const [id, record] of this.records) if (record.providerId === providerId) this.cancel(id);
    const controller = new AbortController(); this.starting.set(providerId, controller);
    let flow: LoginFlow;
    try { flow = await this.factory(providerId, { ...this.options, signal: controller.signal }); }
    catch (error) { if(this.starting.get(providerId)===controller)this.starting.delete(providerId); throw error; }
    if (controller.signal.aborted || this.starting.get(providerId)!==controller) { flow.cancel(); throw new Error('登录已取消或被新登录替代'); }
    this.starting.delete(providerId);
    let parsed: URL;
    try { parsed = new URL(flow.url); } catch { flow.cancel();throw new Error('登录服务未提供有效的授权页面'); }
    const localPage=parsed.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);
    if ((!localPage && (parsed.protocol!=='https:' || Boolean(parsed.port&&parsed.port!=='443'))) || parsed.username || parsed.password || !Number.isFinite(flow.expiresAt) || flow.expiresAt <= this.options.now()) { flow.cancel(); throw new Error('登录服务未提供有效的授权页面'); }
    const id = randomUUID();
    const timer = setTimeout(()=>this.cancel(id), Math.min(flow.expiresAt-this.options.now(), 30*60*1000)); timer.unref?.();
    this.records.set(id, { providerId, flow, nextPoll:this.options.now(), timer });
    return { id, userCode:flow.userCode??'', verificationUri:flow.url, expiresAt:flow.expiresAt, intervalSeconds:Math.max(1,flow.intervalSeconds), instructions:flow.instructions, requiresCode:Boolean(flow.submit) };
  }
  poll(id: string): Promise<LoginResult> {
    const record = this.records.get(id);
    if (!record || record.flow.expiresAt<=this.options.now()) { this.cancel(id); return Promise.resolve({status:'expired'}); }
    if (record.result) return Promise.resolve({status:'complete',credential:{...record.result}});
    if (record.running) return record.running;
    if (record.nextPoll>this.options.now()) return Promise.resolve({status:'pending'});
    record.nextPoll=this.options.now()+Math.max(1,record.flow.intervalSeconds)*1000;
    const task = record.flow.poll().then(credential=>{
      if(this.records.get(id)!==record || record.flow.expiresAt<=this.options.now()) { this.cancel(id); return {status:'expired'} as LoginResult; }
      if(!credential)return {status:'pending'} as LoginResult;
      if(credential.providerId!==record.providerId || !credential.subject || !credential.secret){this.cancel(id);throw new Error('登录返回的账号与所选服务不一致');}
      record.result=credential;
      record.flow.cancel();
      return {status:'complete',credential:{...credential}} as LoginResult;
    }).catch(error=>{this.cancel(id);throw error;}).finally(()=>{if(record.running===task)record.running=undefined;});
    record.running=task; return task;
  }
  async submit(id: string, code: string) {
    const record=this.records.get(id);
    if(!record || record.flow.expiresAt<=this.options.now() || !record.flow.submit)throw new Error('此登录不接受验证码或已经过期');
    await record.flow.submit(code);
  }
  cancel(id: string) {
    const record=this.records.get(id); if(!record)return;
    this.records.delete(id);clearTimeout(record.timer);record.flow.cancel();record.result=undefined;
  }
  close() { for(const controller of this.starting.values())controller.abort();this.starting.clear();for(const id of this.records.keys())this.cancel(id); }
}
