import type { CalendarTarget, Connection, Field, Metric, Preferences, ScenarioId, Space, Subscription } from '../../shared/types';
import { projectEvents } from '../../shared/rules';
export const DEMO_NOW = '2026-10-20T01:00:00.000Z';
export const scenarioNames: Record<ScenarioId,string> = {
  empty_first_run:'首次空白',normal_mixed:'标准混合',multi_account_shared:'多账号与独立共享关系',unknown_and_na:'未知与不适用',zero_vs_unfetched:'明确零值与尚未获取',stale_and_past_reset:'过时与已过重置点',partial_success:'部分成功',auth_and_locked_fields:'认证失效与人工锁定',rate_limited:'限流与合并',offline_recovery:'离线与恢复',date_boundaries:'月末、闰年与时区',calendar_conflicts:'日历冲突与阶段',
};
export const defaultPreferences: Preferences = {theme:'light',density:'comfortable',quotaView:'remaining',timezone:'Asia/Shanghai',reducedMotion:false,closeToTray:true,reminder:'local',walletThresholds:{CNY:'10.00',USD:'5.00'},order:[],workspaceName:'示例工作区',statisticsCurrency:'CNY',monthlyBudgets:{},reminderLeadDays:3,categories:['AI 工具','生产力','影音娱乐','云存储','其他']};
export function demoField(value: string|null, source='手动记录（示例）', availability:Field<string>['availability']=value===null?'unfetched':'known'): Field<string> {
  return {value,availability,source,observedAt:value===null?null:'2026-10-19T01:00:00.000Z',dataOrigin:'demo'};
}
function metric(id:string,label:string,value:string|null,unit='%',resetAt:string|null=null,availability?:Field<string>['availability']):Metric {
  return {id,label,unit,remaining:{...demoField(value,'模拟官方读取',availability),observedAt:value===null?null:'2026-10-20T00:55:00.000Z'},total:unit==='%'?'100':null,resetAt,staleAfterMinutes:unit==='%'?30:120};
}
export function emptySubscription(product=''): Omit<Subscription,'id'|'revision'|'history'> {
  return {product,brand:product,kind:'manual',account:'个人示例账号',region:'未指定',organization:'个人',plan:demoField(null),price:demoField(null),currency:'USD',cycle:'monthly',intervalDays:30,anchorDate:null,timezone:'Asia/Shanghai',startDate:demoField(null),renewalDate:demoField(null),paidThrough:demoField(null),trialEnd:demoField(null),lifecycle:'active',autoRenew:'unknown',billingGroupId:null,quotaPoolId:null,possibleSharedWallet:false,metrics:[],connectionId:null,website:'',reminder:'local',category:'其他',pinned:false,notes:''};
}
function baseSubscription(id:string,product:string,patch:Partial<Subscription>): Subscription { return {...emptySubscription(product),id,revision:1,history:[],...patch}; }
function connection(id:string,provider:string,fields:string[],unsupported:string[]):Connection { return {id,provider,account:'个人示例账号',region:provider==='Kimi API'?'中国大陆':'全球示例',state:'ready',generation:1,fields,unsupported,version:'preview-1.0（模拟）',lastAttempt:'2026-10-20T00:55:00.000Z',lastSuccess:'2026-10-20T00:55:00.000Z',nextAllowed:null,error:null,runs:0}; }
export function makeScenario(id:ScenarioId):Space {
  const subscriptions:Subscription[]=[
    baseSubscription('codex','Codex',{brand:'OpenAI',kind:'window',plan:demoField('ChatGPT Plus 权益'),price:demoField('20.00'),renewalDate:{...demoField('2026-11-03'),locked:true},anchorDate:'2026-11-03',billingGroupId:'billing-openai',quotaPoolId:'pool-codex',connectionId:'codex-local',pinned:true,website:'https://chatgpt.com/',metrics:[metric('short','5 小时额度','35','%','2026-10-20T13:00:00.000Z'),metric('week','每周额度','62','%','2026-10-23T01:00:00.000Z')]}),
    baseSubscription('deepseek','DeepSeek API',{brand:'DeepSeek',kind:'wallet',plan:demoField('按量钱包'),cycle:'none',currency:'CNY',renewalDate:demoField(null,'按量钱包','na'),quotaPoolId:'pool-deepseek',connectionId:'deepseek-balance',pinned:true,website:'https://platform.deepseek.com/',metrics:[metric('total','可用总余额','86.40','CNY'),metric('cash','充值余额','80.00','CNY'),metric('gift','赠送余额','6.40','CNY')]}),
    baseSubscription('claude','Claude Pro',{brand:'Anthropic',plan:demoField('Pro'),price:demoField('20.00'),renewalDate:demoField('2026-10-22'),anchorDate:'2026-10-22',autoRenew:'on',website:'https://claude.ai/',metrics:[metric('manual','额度与用量',null,'%',null,'unsupported')]}),
    baseSubscription('copilot','GitHub Copilot',{brand:'GitHub',kind:'window',plan:demoField('Pro'),price:demoField('10.00'),renewalDate:demoField('2026-11-01'),anchorDate:'2026-11-01',quotaPoolId:'pool-copilot',connectionId:'copilot-local',website:'https://github.com/settings/copilot',metrics:[metric('completion','代码补全',null,'%',null,'unlimited'),metric('premium','高级交互','78','%','2026-11-01T00:00:00.000Z')]}),
    baseSubscription('kimi','Kimi API',{brand:'Kimi',kind:'wallet',plan:demoField('国内站 API 钱包'),cycle:'none',currency:'CNY',renewalDate:demoField(null,'按量钱包','na'),quotaPoolId:'pool-kimi',connectionId:'kimi-platform-cn',website:'https://platform.moonshot.cn/',metrics:[metric('available','可用余额','142.10','CNY'),metric('cash','充值余额','122.10','CNY'),metric('voucher','赠送余额','20.00','CNY')]}),
    baseSubscription('openrouter','OpenRouter',{brand:'OpenRouter',kind:'wallet',plan:demoField('Key 预算 · 非账户资金'),cycle:'none',renewalDate:demoField(null,'Key 预算','na'),quotaPoolId:'pool-router',connectionId:'openrouter-key',website:'https://openrouter.ai/settings/keys',metrics:[{...metric('budget','剩余预算','23.75','USD','2026-11-01T00:00:00.000Z'),total:'50.00'}]}),
    baseSubscription('chatgpt','ChatGPT Plus',{brand:'OpenAI',plan:demoField('Plus · 共用付款'),price:demoField('20.00'),renewalDate:demoField('2026-11-03'),anchorDate:'2026-11-03',billingGroupId:'billing-openai',quotaPoolId:null,website:'https://chatgpt.com/',metrics:[metric('chat','聊天额度',null,'%',null,'unsupported')]}),
  ];
  const connections=[connection('codex-local','Codex',['实际额度、重置时间'],['消费者聊天总额度、会员扣费日期']),connection('copilot-local','GitHub Copilot',['quotaSnapshots、剩余、重置日'],['个人会员续费日期']),connection('deepseek-balance','DeepSeek API',['充值、赠送、可用余额与币种'],['会员账期']),connection('kimi-platform-cn','Kimi API',['充值、赠送与可用余额'],['Kimi Code 会员额度、国际站钱包']),connection('openrouter-key','OpenRouter',['Key 限额、用量与预算'],['账户总资金、订阅扣费日'])];
  const targets:CalendarTarget[]=[
    {id:'google',name:'SubCal · Google 示例日历',account:'Google 示例账号',location:'Google 专用日历 · calendar.app.created',state:'ready',stage:'idle',revision:1,remote:[],message:'尚未执行模拟同步'},
    {id:'eventkit',name:'SubCal · macOS 示例日历',account:'Apple 示例账号',location:'iCloud（macOS 演示案例）',state:'ready',stage:'idle',revision:1,remote:[],message:'本机读回不等于 iCloud 云端确认'},
    {id:'icloud-caldav',name:'SubCal · iCloud 示例日历',account:'Apple 示例账号',location:'Windows → iCloud CalDAV 专用日历',state:'ready',stage:'idle',revision:1,remote:[],message:'尚未执行模拟同步'},
  ];
  const space:Space={revision:1,now:DEMO_NOW,subscriptions,connections,targets,offline:false};
  if(id==='empty_first_run'){space.subscriptions=[];space.connections=[];}
  if(id==='multi_account_shared'){
    for(let n=2;n<=3;n++)subscriptions.push({...structuredClone(subscriptions[4]),id:`kimi-${n}`,account:`团队示例账号 ${n}`,quotaPoolId:`pool-kimi-${n}`,connectionId:null,metrics:[metric(`balance-${n}`,'可用余额',`${n*50}.00`,'CNY')]});
    subscriptions.push({...structuredClone(subscriptions[1]),id:'deepseek-key2',account:'第二个示例 Key',possibleSharedWallet:true,connectionId:null});
    subscriptions[1].possibleSharedWallet=true;
    subscriptions.push(baseSubscription('kimi-code','Kimi Code',{brand:'Kimi',kind:'window',plan:demoField('共享额度示例'),currency:'CNY',price:demoField('49.00'),renewalDate:demoField('2026-10-27'),anchorDate:'2026-10-27',quotaPoolId:'pool-kimi-membership',metrics:[metric('credits','会员额度','60','%')]}));
    subscriptions.push(baseSubscription('kimi-member','Kimi 会员',{brand:'Kimi',kind:'window',plan:demoField('共享额度示例'),currency:'CNY',price:demoField('49.00'),renewalDate:demoField('2026-10-27'),anchorDate:'2026-10-27',quotaPoolId:'pool-kimi-membership',billingGroupId:'billing-kimi',metrics:[metric('credits','会员额度','60','%')]}));
    subscriptions.find(s=>s.id==='kimi-code')!.billingGroupId='billing-kimi';
  }
  if(id==='unknown_and_na'){subscriptions.push(baseSubscription('custom','新服务 · 日期待补充',{}));subscriptions[0].renewalDate=demoField(null);subscriptions[0].metrics[0].remaining=demoField(null,'模拟缺失字段','unfetched');}
  if(id==='zero_vs_unfetched'){subscriptions[1].metrics=[metric('total','可用总余额','0.00','CNY')];subscriptions[0].metrics[0].remaining=demoField('0','模拟官方读取');subscriptions[0].metrics[0].remaining.observedAt='2026-10-20T00:58:00.000Z';subscriptions[4].metrics=[metric('available','可用余额',null,'CNY')];}
  if(id==='stale_and_past_reset'){
    subscriptions[0].metrics[0].remaining.value='5'; subscriptions[0].metrics[0].resetAt='2026-10-20T00:45:00.000Z';
    for(const s of subscriptions)for(const m of s.metrics)if(m.remaining.value!==null)m.remaining.observedAt='2026-10-19T21:00:00.000Z';
  }
  if(id==='partial_success'){connections[2].state='partial';connections[2].error={code:'PARTIAL',message:'余额可更新，套餐字段解析失败（模拟）',action:'核对字段来源或再次模拟刷新'};}
  if(id==='auth_and_locked_fields'){
    connections[0].state='auth';connections[0].error={code:'AUTH_REQUIRED',message:'示例会话已过期，旧额度保留（模拟）',action:'模拟重新连接'};subscriptions[0].renewalDate.proposed='2026-11-05';
    connections[1].state='runtime_missing';connections[1].error={code:'RUNTIME_MISSING',message:'缺少官方运行时（模拟）',action:'模拟安装完成并重新探测'};
    connections[2].state='denied';connections[2].error={code:'PERMISSION_DENIED',message:'该示例身份无读取权限（模拟）',action:'选择有权限的示例身份'};
    connections[4].state='schema_changed';connections[4].error={code:'SCHEMA_CHANGED',message:'数据结构已变化，旧值保留（模拟）',action:'模拟适配器恢复或暂停'};
  }
  if(id==='rate_limited'){connections[0].state='rate_limited';connections[0].nextAllowed='2026-10-20T01:05:00.000Z';connections[0].error={code:'RATE_LIMITED',message:'模拟限流，09:05（上海）后允许重试',action:'推进演示时钟 5 分钟'};}
  if(id==='offline_recovery'){space.offline=true;for(const c of connections)c.state='offline';}
  if(id==='date_boundaries'){
    space.now='2027-02-28T01:00:00.000Z';
    space.subscriptions=[baseSubscription('month-end','月末会员',{price:demoField('20'),renewalDate:demoField('2027-02-28'),anchorDate:'2027-01-31'}),baseSubscription('leap','闰年年费',{price:demoField('120'),cycle:'yearly',renewalDate:demoField('2027-02-28'),anchorDate:'2024-02-29'}),baseSubscription('dst','纽约时区会员',{price:demoField('9'),timezone:'America/New_York',startDate:demoField('2027-03-13'),renewalDate:demoField('2027-03-14'),anchorDate:'2027-03-14'}),baseSubscription('date-line','奥克兰日期会员',{timezone:'Pacific/Auckland',price:demoField('5'),renewalDate:demoField('2027-03-01'),anchorDate:'2027-03-01'})];space.connections=[];
  }
  if(id==='calendar_conflicts'){
    const events=projectEvents(subscriptions,space.now).filter(e=>e.kind==='renewal');
    for(const target of targets){target.remote=events.map(e=>({...e,managed:true,baselineDate:e.date,suppressed:false,deleted:false}));target.stage='verified';}
    const r=targets[0].remote.find(e=>e.subscriptionId==='claude')!;r.date='2026-10-25';
    const removed=targets[2].remote.find(e=>e.subscriptionId==='codex')!;removed.deleted=true;removed.suppressed=true;
    targets[1].state='readonly';targets[1].message='目标只读（模拟），请核对后恢复';
  }
  return space;
}
