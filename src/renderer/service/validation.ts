import { scenarioIds, type Store } from '../../shared/types';
import { dateValid, validateSubscription } from '../../shared/rules';
type Check = (value: unknown) => boolean;
const text:Check = v=>typeof v==='string' && v.length<=10000;
const id:Check = v=>typeof v==='string' && /^[\w.:-]{1,160}$/.test(v);
const bool:Check=v=>typeof v==='boolean';
const number:Check=v=>typeof v==='number'&&Number.isFinite(v);
const integer:Check=v=>number(v)&&Number.isSafeInteger(v)&&Number(v)>=0;
const date:Check=v=>typeof v==='string'&&dateValid(v);
const instant:Check=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v));
const nullable=(check:Check):Check=>v=>v===null||check(v);
const optional=(check:Check):Check=>v=>v===undefined||check(v);
const values=(...list:unknown[]):Check=>v=>list.includes(v);
const list=(check:Check,max=1000):Check=>v=>Array.isArray(v)&&v.length<=max&&v.every(check);
const object=(shape:Record<string,Check>):Check=>v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>Object.hasOwn(shape,k))&&Object.entries(shape).every(([k,c])=>c((v as Record<string,unknown>)[k]));
const record=(check:Check,key:Check=text):Check=>v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).every(([k,x])=>key(k)&&check(x));
const decimal:Check=v=>typeof v==='string'&&/^-?\d{1,12}(\.\d{1,6})?$/.test(v);
const currency:Check=v=>typeof v==='string'&&/^[A-Z]{3}$/.test(v);
const zone:Check=v=>{try{if(typeof v!=='string')return false;new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}};
const field=(value:Check)=>object({value:nullable(value),availability:values('known','unfetched','unsupported','na','denied','unlimited'),source:text,observedAt:nullable(instant),dataOrigin:values('demo'),locked:optional(bool),proposed:optional(value)});
const metric=object({id,label:text,unit:text,remaining:field(decimal),total:nullable(decimal),resetAt:nullable(instant),staleAfterMinutes:v=>number(v)&&Number(v)>0});
const eventShape={id,subscriptionId:id,product:text,account:text,kind:values('renewal','start','expiry','trial','reset'),date,instant:optional(instant),timezone:zone,expected:bool,source:text,revision:integer,dataOrigin:values('demo')};
const remote=object({...eventShape,managed:bool,baselineDate:date,suppressed:bool,deleted:bool});
const subscription=object({id,revision:integer,product:text,brand:text,kind:values('window','wallet','manual'),account:text,region:text,organization:text,plan:field(text),price:field(decimal),currency,cycle:values('monthly','yearly','days','once','irregular','none'),intervalDays:integer,anchorDate:nullable(date),timezone:zone,startDate:field(date),renewalDate:field(date),paidThrough:field(date),trialEnd:field(date),lifecycle:values('active','trial','ending','expired','cancelled','pending','archived'),autoRenew:values('on','off','unknown'),billingGroupId:nullable(id),quotaPoolId:nullable(id),possibleSharedWallet:bool,metrics:list(metric,50),connectionId:nullable(id),website:text,reminder:values('none','local','external'),pinned:bool,notes:text,scheduleOverrides:optional(record(date,id)),archivedFrom:optional(values('active','trial','ending','expired','cancelled','pending')),history:list(object({at:instant,text,dataOrigin:values('demo')}),500)});
const connection=object({id,provider:text,account:text,region:text,state:values('ready','refreshing','partial','auth','denied','rate_limited','offline','runtime_missing','schema_changed','paused','disconnected'),generation:integer,fields:list(text,50),unsupported:list(text,50),version:text,lastAttempt:nullable(instant),lastSuccess:nullable(instant),nextAllowed:nullable(instant),error:nullable(object({code:text,message:text,action:text})),runs:integer});
const target=object({id:values('google','eventkit','icloud-caldav'),name:text,account:text,location:text,state:values('ready','paused','readonly','missing','auth'),stage:values('idle','queued','written','verified','failed'),revision:integer,remote:list(remote,6000),message:text});
const space=object({revision:integer,now:instant,subscriptions:list(subscription,300),connections:list(connection,100),targets:list(target,3),offline:bool});
const preferences=object({theme:values('light','dark','system'),density:values('comfortable','compact'),quotaView:values('remaining','used'),timezone:zone,reducedMotion:bool,closeToTray:bool,reminder:values('none','local','external'),walletThresholds:record(decimal,currency),order:list(id,500)});
const storeCheck=object({schemaVersion:values(1),active:values(...scenarioIds),spaces:record(space,values(...scenarioIds)),preferences,counter:integer});
export function parseStore(text:string):Store {
  if(new TextEncoder().encode(text).byteLength>2*1024*1024)throw new Error('文件超过 2 MB，未导入');
  let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new Error('文件不是有效 JSON，当前演示资料未更改');}
  if((parsed as {schemaVersion?:unknown})?.schemaVersion!==1)throw new Error('备份版本不受支持，需要 schemaVersion 1');
  if(!storeCheck(parsed))throw new Error('备份结构或字段无效；只接受 SubCal 演示备份');
  const result=parsed as Store;
  if(!result.spaces[result.active])throw new Error('备份缺少当前演示空间');
  for(const s of Object.values(result.spaces)){
    if(s.targets.length!==3||!['google','eventkit','icloud-caldav'].every(id=>s.targets.some(t=>t.id===id)))throw new Error('备份必须包含三种明确的模拟日历目标');
    if(new Set(s.subscriptions.map(x=>x.id)).size!==s.subscriptions.length || new Set(s.connections.map(x=>x.id)).size!==s.connections.length || new Set(s.targets.map(x=>x.id)).size!==s.targets.length)throw new Error('备份包含重复身份');
    for(const sub of s.subscriptions){
      if(Object.keys(validateSubscription(sub)).length)throw new Error(`订阅「${sub.product}」包含无效日期、金额或网址`);
      for(const key of ['price','plan','startDate','renewalDate','paidThrough','trialEnd'] as const)if(sub[key].availability==='known' && sub[key].value===null)throw new Error('已知字段不能是空值');
      for(const m of sub.metrics)if(m.remaining.availability==='known'&&m.remaining.value===null)throw new Error('已知额度不能是空值');
    }
  }
  return result;
}
