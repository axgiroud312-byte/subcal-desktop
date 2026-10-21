import { createWalletAdapters, type WalletTemplate } from './wallet-adapters';
import { hashKeySubject, type HttpFetchFn } from './http-adapters';
import { AdapterError, type CollectInput, type ProviderAdapter } from './types';

export const RELAY_TEMPLATES: readonly WalletTemplate[] = ['new-api-key', 'new-api-account', 'one-api-key', 'sub2api-key', 'sub2api-account', 'credit-grants'];
const source = 'subcal-explicit-relay';

/** Approval is created by the main-process add action and persisted in the vault.
 * No endpoint discovery, model calls or protocol fallback are performed. */
export function approveRelayCredential(raw: string) {
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw); } catch { throw new AdapterError('AUTH_REQUIRED', '请填写站点、面板类型与访问凭据'); }
  if (!value || !RELAY_TEMPLATES.includes(value.template as WalletTemplate)) throw new AdapterError('AUTH_REQUIRED', '请选择实际使用的面板类型');
  const template = value.template as WalletTemplate;
  const origin = typeof value.origin === 'string' ? value.origin.trim() : '';
  const token = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
  const userId = typeof value.userId === 'string' ? value.userId.trim() : '';
  if (!token || /\s/.test(token) || template === 'new-api-account' && !/^\d+$/.test(userId)) throw new AdapterError('AUTH_REQUIRED', '访问凭据或 New API 用户 ID 无效');
  // The factory validates exact HTTPS origin and fixed protocol before approval.
  const adapter = createWalletAdapters({ approvedOrigins: [{ origin, template, source }] }).at(-1)!;
  const canonical = new URL(adapter.manifest.officialSourceUrl).origin;
  const subject = hashKeySubject('relay-wallet', `${canonical}\0${template}\0${userId}\0${token}`);
  const alias = `${template} (${new URL(canonical).hostname})`;
  return { providerId: 'relay-wallet', subject, alias, secret: JSON.stringify({ origin: canonical, approvedOrigin: canonical, template, source, accessToken: token, userId, subject, alias, management: 'static' }) };
}

export function createRelayAccountAdapter(fetchFn?: HttpFetchFn): ProviderAdapter {
  const base = createWalletAdapters()[0];
  return {
    ...base,
    manifest: { ...base.manifest, id: 'relay-wallet', product: '中转站余额', brand: '中转站', region: '用户指定站点', authMode: 'api_key', allowedHosts: [], officialSourceUrl: '', permissions: '仅用户明确选择的面板协议及 HTTPS 站点；固定只读查询，不探测模型或自动切换协议。' },
    async collect(input: CollectInput) {
      let c: Record<string, unknown>;
      try { c = JSON.parse(input.secret ?? ''); } catch { throw new AdapterError('AUTH_REQUIRED', '请重新添加中转站凭据'); }
      if (!c || c.source !== source || c.origin !== c.approvedOrigin || !RELAY_TEMPLATES.includes(c.template as WalletTemplate)) throw new AdapterError('AUTH_REQUIRED', '站点与面板类型尚未确认');
      const adapter = createWalletAdapters({ fetchFn, approvedOrigins: [{ origin: String(c.origin), template: c.template as WalletTemplate, source }] }).at(-1)!;
      return adapter.collect(input);
    },
    probe(input) { return this.collect(input); },
    normalize() { throw new AdapterError('UNSUPPORTED', '中转响应必须按已确认面板协议解析'); },
    describeRecovery(error) { return base.describeRecovery(error); },
    async disconnect() {},
  };
}
