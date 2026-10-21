import type { CalendarEvent, Field, Metric, Preferences, Subscription } from './types';

export function dateValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y,m,0)).getUTCDate();
}
export function dateInZone(instant: string, zone = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
  return ['year','month','day'].map(k => parts.find(p=>p.type===k)!.value).join('-');
}
export function daysBetween(from: string, to: string): number {
  // Civil dates are converted to ordinal days; never divide elapsed zoned instants.
  const ordinal = (s: string) => { const [y,m,d] = s.split('-').map(Number); return Date.UTC(y,m-1,d) / 86400000; };
  return ordinal(to) - ordinal(from);
}
export function addDays(date: string, days: number): string {
  const [y,m,d] = date.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
}
export function anchoredDate(anchor: string, cycle: Subscription['cycle'], index: number, intervalDays = 30): string {
  const [y,m,d] = anchor.split('-').map(Number);
  if (cycle === 'days') return addDays(anchor,index*intervalDays);
  if (cycle !== 'monthly' && cycle !== 'yearly') return anchor;
  const offset = cycle === 'monthly' ? index : index*12;
  const target = new Date(Date.UTC(y,m-1+offset,1));
  const day = Math.min(d,new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate());
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export const fieldLabels: Record<Field<unknown>['availability'],string> = {known:'',unfetched:'尚未获取',unsupported:'当前读取方式未提供此项',na:'不适用',denied:'当前权限无法读取',unlimited:'无限量（示例）'};
export function fieldText(field: Field<string>): string { return field.availability === 'known' && field.value !== null ? field.value : fieldLabels[field.availability] || '尚未获取'; }
export function money(value: string | null, currency: string): string {
  if (value === null) return '金额待补充';
  return new Intl.NumberFormat('zh-CN',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:6}).format(Number(value));
}
export function decimal(value: string): bigint {
  if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(value)) throw new Error('金额请填写最多 12 位整数、6 位小数');
  const neg=value.startsWith('-'); const [whole,frac='']=value.replace('-','').split('.');
  return (BigInt(whole)*1000000n+BigInt(frac.padEnd(6,'0')))*(neg?-1n:1n);
}
export function decimalText(value: bigint): string { const sign=value<0n?'-':''; const n=value<0n?-value:value; return `${sign}${n/1000000n}.${String(n%1000000n).padStart(6,'0')}`; }
export function monthlySummary(subs: Subscription[]) {
  const seen=new Set<string>(); const sums:Record<string,bigint>={}; let unknown=0; let recurring=0;
  for (const s of subs) {
    if (s.lifecycle==='archived' || s.lifecycle==='cancelled' || s.lifecycle==='expired' || !['monthly','yearly','days'].includes(s.cycle) || s.kind==='wallet') continue;
    const key=s.billingGroupId||s.id; if(seen.has(key))continue; seen.add(key); recurring++;
    if(s.price.value===null || s.price.availability!=='known'){unknown++;continue;}
    const value=decimal(s.price.value); const monthly=s.cycle==='yearly'?value/12n:s.cycle==='days'?value*365n/(12n*BigInt(s.intervalDays)):value;
    sums[s.currency]=(sums[s.currency]||0n)+monthly;
  }
  return {totals:Object.entries(sums).map(([currency,n])=>({currency,amount:decimalText(n)})),unknown,recurring};
}
export function freshness(metric: Metric, now: string): 'fresh' | 'stale' | 'past_reset' {
  if(metric.resetAt && metric.resetAt<=now)return 'past_reset';
  if(!metric.remaining.observedAt || (Date.parse(now)-Date.parse(metric.remaining.observedAt))/60000>metric.staleAfterMinutes)return 'stale';
  return 'fresh';
}
export function isLow(s: Subscription, now: string, prefs: Preferences): boolean {
  const metrics=s.kind==='wallet'?s.metrics.slice(0,1):s.metrics;
  return metrics.some(m=>m.remaining.availability==='known' && m.remaining.value!==null && freshness(m,now)==='fresh' && (m.unit==='%' ? Number(m.remaining.value)<=20 : prefs.walletThresholds[m.unit]!==undefined && decimal(m.remaining.value)<=decimal(prefs.walletThresholds[m.unit])));
}
export function renewalText(s: Subscription, now: string): string {
  if(s.kind==='wallet' && s.cycle==='none')return '不适用 · 按量余额/预算';
  if(s.lifecycle==='ending' || s.autoRenew==='off')return s.paidThrough.value ? `${s.paidThrough.value} 到期 · 不续费` : '已记录不续费 · 有效期待补充';
  if(s.lifecycle==='trial' && s.trialEnd.value)return `${s.trialEnd.value} 试用结束`;
  if(!s.renewalDate.value)return '续费日期待补充';
  const days=daysBetween(dateInZone(now,s.timezone),s.renewalDate.value);
  return days<=0 ? `${s.renewalDate.value} · 已到计划续费日，待确认` : `${s.renewalDate.value} · ${days} 天后计划续费`;
}
export function projectEvents(subs: Subscription[], now: string, includeReset=false): CalendarEvent[] {
  const result:CalendarEvent[]=[]; const seen=new Set<string>();
  for(const s of subs){
    const group=s.billingGroupId||s.id;
    const push=(kind:CalendarEvent['kind'],date:string,field:Field<string>,index=0,instant?:string)=>{
      const id=`${kind==='renewal'?group:s.id}:${kind}:${index}`;
      if(seen.has(id))return; seen.add(id);
      result.push({id,subscriptionId:s.id,product:s.product,account:s.account,kind,date:s.scheduleOverrides?.[id]||date,instant,timezone:s.timezone,expected:kind==='renewal',source:s.scheduleOverrides?.[id]?'用户逐次改期（演示记录）':field.source,revision:s.revision,dataOrigin:'demo'});
    };
    if(s.startDate.value)push('start',s.startDate.value,s.startDate);
    if(s.paidThrough.value)push('expiry',s.paidThrough.value,s.paidThrough);
    if(s.trialEnd.value)push('trial',s.trialEnd.value,s.trialEnd);
    if(s.renewalDate.value && s.autoRenew!=='off' && !['ending','cancelled','expired'].includes(s.lifecycle)){
      const first=s.renewalDate.value; const anchor=s.anchorDate||first; const horizon=anchoredDate(dateInZone(now,s.timezone),'yearly',1);
      let offset=0;
      if(['monthly','yearly','days'].includes(s.cycle))while(offset<1000 && anchoredDate(anchor,s.cycle,offset,s.intervalDays)<first)offset++;
      for(let i=0;i<400;i++){
        const date=i===0?first:anchoredDate(anchor,s.cycle,offset+i,s.intervalDays);
        if(i>0 && (date>horizon || ['once','irregular','none'].includes(s.cycle)))break;
        push('renewal',date,s.renewalDate,i);
      }
    }
    if(includeReset)s.metrics.forEach((m,i)=>{if(m.resetAt)push('reset',dateInZone(m.resetAt,s.timezone),m.remaining,i,m.resetAt);});
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export function upcomingSummary(subs: Subscription[], now: string) {
  const seen=new Set<string>(); const sums:Record<string,bigint>={}; let unknown=0;
  for(const e of projectEvents(subs,now)){
    if(e.kind!=='renewal')continue;
    const s=subs.find(s=>s.id===e.subscriptionId)!; if(s.lifecycle==='archived' || s.kind==='wallet')continue;
    const delta=daysBetween(dateInZone(now,s.timezone),e.date); if(delta<0 || delta>30 || seen.has(e.id))continue; seen.add(e.id);
    if(s.price.value===null)unknown++; else sums[s.currency]=(sums[s.currency]||0n)+decimal(s.price.value);
  }
  return {totals:Object.entries(sums).map(([currency,n])=>({currency,amount:decimalText(n)})),unknown};
}
export function validateSubscription(s: Partial<Subscription>): Record<string,string> {
  const errors:Record<string,string>={};
  if(!s.product?.trim())errors.product='请填写产品名称';
  if(s.price?.value!==null && s.price?.value!==undefined){try{if(decimal(s.price.value)<0n)errors.price='订阅价格不能为负数';}catch{errors.price='请填写有效金额（最多 6 位小数）';}}
  if(s.cycle==='days' && (!Number.isInteger(s.intervalDays)||s.intervalDays!<1||s.intervalDays!>36500))errors.intervalDays='周期天数请填写 1 至 36500 的整数';
  if(s.currency && !/^[A-Z]{3}$/.test(s.currency))errors.currency='币种请填写三位大写代码，例如 CNY 或 USD';
  if(s.anchorDate && !dateValid(s.anchorDate))errors.anchorDate='账期锚点必须是有效日期';
  for(const key of ['billingGroupId','quotaPoolId'] as const)if(s[key]&&!/^[\w.:-]{1,160}$/.test(s[key]!))errors[key]='共享标识请使用字母、数字、短横线或下划线';
  for(const m of s.metrics??[]) {
    if(m.unit!=='%'&&!/^[A-Z]{3}$/.test(m.unit))errors[`metric_${m.id}`]='指标单位请填写 % 或三位币种代码';
    if(m.remaining.value!==null){try{decimal(m.remaining.value);if(m.unit==='%'&&(Number(m.remaining.value)<0||Number(m.remaining.value)>100))errors[`metric_${m.id}`]='百分比必须在 0 至 100 之间';}catch{errors[`metric_${m.id}`]='指标数值格式无效';}}
  }
  for(const key of ['startDate','renewalDate','paidThrough','trialEnd'] as const){const value=s[key]?.value; if(value && !dateValid(value))errors[key]='请填写 1900—2200 年间的有效日期';}
  for(const key of ['paidThrough','trialEnd','renewalDate'] as const){if(s.startDate?.value&&s[key]?.value&&s[key]!.value!<s.startDate.value)errors[key]='日期不能早于开始日';}
  if(s.timezone){try{new Intl.DateTimeFormat('zh-CN',{timeZone:s.timezone});}catch{errors.timezone='时区无效';}}
  if(s.website){try{const u=new URL(s.website);if(u.protocol!=='https:'||u.username||u.password)errors.website='官网地址仅接受不含凭据的 HTTPS 链接';}catch{errors.website='请填写完整 HTTPS 网址';}}
  return errors;
}
