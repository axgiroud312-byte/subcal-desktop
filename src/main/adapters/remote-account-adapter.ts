import { createControlAdapters } from './control-adapters';
import { AdapterError, type CollectInput, type ProviderAdapter } from './types';
export function remoteOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new AdapterError('AUTH_REQUIRED', '请填写远端 Magpie 的 HTTPS 地址');
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) throw new Error();
    return u.origin;
  } catch { throw new AdapterError('AUTH_REQUIRED', '远端地址需为 HTTPS 站点，不包含账号、端口或路径'); }
}
const base = createControlAdapters().find(a=>a.manifest.id==='remote-magpie')!;
/** The origin is approved by the explicit add-account action, not discovered
 * from a remote response, redirect, diagnostic or arbitrary JSONPath. */
export const remoteAccountAdapter: ProviderAdapter = {
  ...base,
  async collect(input: CollectInput) {
    let c: Record<string, unknown>; try { c=JSON.parse(input.secret??''); } catch { throw new AdapterError('AUTH_REQUIRED','请填写远端地址与访问 Key'); }
    const origin=remoteOrigin(c.origin);
    if(c.approvedOrigin!==origin)throw new AdapterError('AUTH_REQUIRED','此远端地址尚未确认，未发送凭据');
    return createControlAdapters({remoteOrigins:[origin]}).find(a=>a.manifest.id==='remote-magpie')!.collect(input);
  },
  probe(input) { return this.collect(input); },
};
