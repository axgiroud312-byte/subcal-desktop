import { z } from 'zod';
import { ALLOWED_IPC_METHODS } from './bridge';
import { dateValid, validateSubscription } from './rules';
import { SERVICE_ACCESS } from './service-access';

const id = z.string().min(1).max(200);
const text = z.string().max(10000);
const instant = z.string().datetime({ offset: true });
const date = z.string().refine(dateValid, '日期无效');
const zone = z.string().max(100).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, '时区无效');
const evidence = z.enum(['reported','derived','configured','cached']);
export const fieldSchema = z.object({ value: text.nullable(), availability: z.enum(['known','unfetched','unsupported','na','denied','unlimited']), source: text, observedAt: instant.nullable(), dataOrigin: z.enum(['demo','manual','official_api','local_client','calendar','imported','computed']), locked: z.boolean().optional(), proposed: text.optional(), evidence:evidence.optional(), providerAt:instant.nullable().optional() }).strict();
export const entitlementDateSchema = z.discriminatedUnion('precision', [z.object({precision:z.literal('day'),value:date}).strict(),z.object({precision:z.literal('instant'),value:instant}).strict()]);
const dateField = fieldSchema.extend({value:entitlementDateSchema.nullable(),proposed:entitlementDateSchema.optional()});
export const entitlementsSchema = z.object({membershipExpiresAt:dateField.optional(),billingPeriodEnd:dateField.optional(),nextBillingStart:dateField.optional(),autoRenew:fieldSchema.extend({value:z.boolean().nullable(),proposed:z.boolean().optional()}).optional(),listPrice:fieldSchema.optional(),listPriceCurrency:z.string().regex(/^[A-Z]{3}$/).optional()}).strict();
export const balanceSchema = z.object({id,label:text,scope:z.enum(['account','key']),kind:z.enum(['total','cash','grant','credit','budget','usage']),currency:z.string().min(1).max(80),amount:fieldSchema,expiresAt:dateField.optional(),poolId:id.optional()}).strict();
export const metricSchema = z.object({ id, label: text, unit: z.string().min(1).max(80), remaining: fieldSchema, total: text.nullable(), resetAt: z.union([instant,date]).nullable(), staleAfterMinutes: z.number().positive().max(525600),used:fieldSchema.optional(),totalObservation:fieldSchema.optional(),resetObservation:dateField.optional(),windowStart:dateField.optional(),windowEnd:dateField.optional(),windowMinutes:z.number().positive().optional(),scope:z.enum(['account','key','organization','model','seat']).optional(),models:z.array(text).max(1000).optional(),poolId:id.optional(),evidence:evidence.optional() }).strict();
export const subscriptionInputSchema = z.object({
  product: z.string().trim().min(1).max(200), brand: z.string().max(200), kind: z.enum(['window','wallet','manual']), account: text, region: text, organization: text,
  plan: fieldSchema, price: fieldSchema, currency: z.string().regex(/^[A-Z]{3}$/), cycle: z.enum(['monthly','yearly','days','once','irregular','none']), intervalDays: z.number().int().min(1).max(36500), anchorDate: date.nullable(), timezone: zone,
  entitlements:entitlementsSchema.optional(),balances:z.array(balanceSchema).max(500).optional(),management:z.enum(['automatic','manual']).optional(),credentialExpiresAt:dateField.optional(),
  startDate: fieldSchema, renewalDate: fieldSchema, paidThrough: fieldSchema, trialEnd: fieldSchema, lifecycle: z.enum(['active','trial','ending','expired','cancelled','pending','archived']), autoRenew: z.enum(['on','off','unknown']), billingGroupId: id.nullable(), quotaPoolId: id.nullable(), possibleSharedWallet: z.boolean(), metrics: z.array(metricSchema).max(200), connectionId: id.nullable(), website: z.string().max(2048), reminder: z.enum(['none','local','external']), pinned: z.boolean(), notes: text, scheduleOverrides: z.record(id,date).optional(), archivedFrom: z.enum(['active','trial','ending','expired','cancelled','pending']).optional(),
}).strict();
export const subscriptionSchema = subscriptionInputSchema.extend({ id, revision: z.number().int().positive(), history: z.array(z.object({ at: instant, text, dataOrigin: fieldSchema.shape.dataOrigin }).strict()).max(10000) }).superRefine((s, ctx) => { for (const [path,message] of Object.entries(validateSubscription(s))) ctx.addIssue({ code:'custom', path:[path], message }); });
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const preferencesSchema = z.object({ theme:z.enum(['light','dark','system']), density:z.enum(['comfortable','compact']), quotaView:z.enum(['remaining','used']), timezone:zone, reducedMotion:z.boolean(), closeToTray:z.boolean(), reminder:z.enum(['none','local','external']), dndStart:clock.optional(), dndEnd:clock.optional(), notificationsMuted:z.boolean().optional(), walletThresholds:z.record(z.string().max(80),z.string().regex(/^\d{1,12}(\.\d{1,6})?$/)), order:z.array(id).max(10000) }).strict();
const probe = z.object({ id, connectionId:id, generation:z.number().int().positive(), account:text, fields:z.array(text).max(200), samples:z.array(text).max(200) }).strict();
const backend = z.enum(['google','eventkit','icloud-caldav']);
export const paramSchemas = {
  'accounts.discover':z.object({}).strict(),
  'accounts.add':z.object({candidateId:id.optional(),providerId:id.refine(v=>['deepseek-balance','kimi-platform-cn','openrouter-key',...SERVICE_ACCESS.filter(s=>s.mode==='api_key').map(s=>s.id)].includes(v),'此服务尚不支持填写 Key').optional(),secret:z.string().trim().min(4).max(4096).optional()}).strict().refine(p=>Boolean(p.candidateId)!==Boolean(p.providerId&&p.secret),'请选择账号或填写 Key'),
  'accounts.loginStart':z.object({providerId:z.enum(['codex-local','copilot-local'])}).strict(),
  'accounts.loginPoll':z.object({id}).strict(),
  'subscriptions.snapshot':z.object({}).strict(),
  'subscriptions.create':z.object({ input:subscriptionInputSchema }).strict(),
  'subscriptions.update':z.object({ id, patch:subscriptionInputSchema.partial() }).strict(),
  'subscriptions.archive':z.object({ id, archived:z.boolean(), removeFuture:z.boolean() }).strict(),
  'subscriptions.remove':z.object({ id, removeFuture:z.boolean() }).strict(),
  'subscriptions.undo':z.object({ token:id }).strict(),
  'subscriptions.reorder':z.object({ ids:z.array(id).max(10000) }).strict(),
  'subscriptions.resolveField':z.object({ id, field:z.enum(['renewalDate','price','plan']), accept:z.boolean() }).strict(),
  'preferences.set':z.object({ patch:preferencesSchema.partial() }).strict(),
  'connections.beginAuth':z.object({ provider:id, subscriptionId:id.optional() }).strict(),
  'connections.saveCredential':z.object({ connectionId:id, secret:z.string().trim().min(4).max(4096) }).strict(),
  'connections.deleteCredential':z.object({ connectionId:id }).strict(),
  'connections.probe':z.object({ id, profile:z.string().max(200) }).strict(),
  'connections.bind':z.object({ probe }).strict(),
  'connections.pause':z.object({ id:id.optional() }).strict(),
  'connections.disconnect':z.object({ id, removeCredential:z.boolean() }).strict(),
  'collections.refresh':z.object({ id:id.optional() }).strict(),
  'collections.diagnose':z.object({ id:id.optional() }).strict(),
  'calendars.events':z.object({ includeReset:z.boolean() }).strict(),
  'calendars.previewSync':z.object({ backend }).strict(),
  'calendars.sync':z.object({ previewId:id, failAfterWrite:z.boolean() }).strict(),
  'calendars.targetState':z.object({ backend, state:z.enum(['ready','paused','readonly','missing','auth']) }).strict(),
  'calendars.resolveConflict':z.object({ backend,eventId:id,choice:z.enum(['local','remote','unlink']) }).strict(),
  'calendars.simulateExternal':z.object({ backend,eventId:id,kind:z.enum(['move','delete']) }).strict(),
  'data.export':z.object({}).strict(),
  'data.importPreview':z.object({ text:z.string().max(2*1024*1024) }).strict(),
  'data.importCommit':z.object({ id,text:z.string().max(2*1024*1024) }).strict(),
};
export const requestSchema = z.object({ version:z.literal(1), requestId:id, method:z.enum(ALLOWED_IPC_METHODS), params:z.unknown(), expectedRevision:z.number().int().positive().optional(), idempotencyKey:id.optional() }).strict();
export function parseRequest(raw: unknown) { const req=requestSchema.parse(raw); return { ...req, params:paramSchemas[req.method].parse(req.params) }; }
