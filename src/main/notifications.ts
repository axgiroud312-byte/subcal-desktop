import { randomUUID } from 'node:crypto';
import type { SubCalDatabase } from './db/database';
import { dateInZone, daysBetween, freshness, compareMetricDecimal, projectEvents } from '../shared/rules';

export interface NotificationPort { available():boolean; show(title:string,body:string):void }
export class NotificationService {
  private timer?:ReturnType<typeof setInterval>;
  constructor(private db:SubCalDatabase,private port:NotificationPort,private now:()=>number=Date.now) {}
  start() {this.tick();this.timer=setInterval(()=>this.tick(),60000);this.timer.unref?.();}
  close() {if(this.timer)clearInterval(this.timer);}
  tick() {
    if(this.db.getStorageError())return;
    const prefs=this.db.getPreferences(),now=new Date(this.now()).toISOString();
    if(!this.port.available()){this.db.setSetting('notificationStatus','unavailable');return;}
    this.db.setSetting('notificationStatus','available_delivery_not_confirmed');
    if(prefs.notificationsMuted||prefs.reminder!=='local')return;
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:prefs.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));
    if(prefs.dndStart&&prefs.dndEnd&&prefs.dndStart!==prefs.dndEnd) {
      const quiet=prefs.dndStart<prefs.dndEnd?parts>=prefs.dndStart&&parts<prefs.dndEnd:parts>=prefs.dndStart||parts<prefs.dndEnd;
      if(quiet)return;
    }
    const subs=this.db.listSubscriptions().filter(s=>s.lifecycle!=='archived'&&s.reminder==='local');
    const notices:{key:string;rule:string;entity:string;window:string;body:string}[]=[];
    for(const event of projectEvents(subs,now)) {
      if(!['renewal','expiry','trial'].includes(event.kind))continue;
      const delta=daysBetween(dateInZone(now,event.timezone),event.date);
      const owner=subs.find(s=>s.id===event.subscriptionId);
      const lead=owner?.reminderLeadDays??prefs.reminderLeadDays??3;
      if(delta<0||delta>lead)continue;
      notices.push({key:`event:${event.id}:${event.date}:${lead}`,rule:'upcoming',entity:event.id,window:event.date,body:`${event.product} · ${event.date} ${event.kind==='renewal'?'计划续费':'即将到期'}`});
    }
    for(const sub of subs)for(const m of sub.kind==='wallet'?sub.metrics.slice(0,1):sub.metrics) {
      if(m.remaining.availability!=='known'||m.remaining.value===null||freshness(m,now)!=='fresh')continue;
      const threshold=m.unit==='%'?'20':prefs.walletThresholds[m.unit];if(threshold===undefined)continue;
      try {if(compareMetricDecimal(m.remaining.value,threshold)>0)continue;}catch{continue;}
      // No reset means a persistent threshold episode, never one notification per sample.
      const window=(m.resetObservation?.availability==='known'?m.resetObservation.value?.value:undefined)??m.resetAt??'no-known-reset';
      notices.push({key:`low:${m.poolId??sub.quotaPoolId??sub.id}:${m.id}:${window}:${threshold}`,rule:'low',entity:`${sub.id}:${m.id}`,window,body:`${sub.product} · ${m.label} 剩余 ${m.remaining.value}${m.unit}`});
    }
    const pending=notices.filter(n=>!this.db.rawPrepare('SELECT id FROM notification_deliveries WHERE dedupe_key=?').get(n.key));
    if(!pending.length)return;
    // Claim before contacting OS. A crash may lose a notice, never replay a burst.
    this.db.writeTransaction(()=>{for(const n of pending)this.db.rawPrepare("INSERT OR IGNORE INTO notification_deliveries(id,dedupe_key,rule,occurrence_or_meter,window_key,scheduled_at,state) VALUES(?,?,?,?,?,?,'submitted')").run(randomUUID(),n.key,n.rule,n.entity,n.window,this.now());});
    try {this.port.show(pending.length===1?'SubCal 提醒':`SubCal · ${pending.length} 项提醒`,pending.slice(0,3).map(n=>n.body).join('\n')+(pending.length>3?'\n打开应用查看其余事项':''));}
    catch {this.db.setSetting('notificationStatus','failed');this.db.writeTransaction(()=>{for(const n of pending)this.db.rawPrepare("UPDATE notification_deliveries SET state='failed' WHERE dedupe_key=?").run(n.key);});}
  }
}
