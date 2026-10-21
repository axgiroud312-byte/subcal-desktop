import { CodexLocalAdapter } from './codex-adapter';
import { CopilotLocalAdapter } from './copilot-adapter';
import { DeepSeekBalanceAdapter, KimiPlatformCnAdapter } from './http-adapters';
import { AdapterError, type ProviderAdapter } from './types';
export { CodexHttpAdapter, ClaudeOAuthAdapter, CopilotHttpAdapter, OpenRouterCreditsAdapter, OpenRouterCompositeAdapter, parseHttpCredential, copilotUsageHeaders } from './credential-adapters';
export { hashKeySubject } from './http-adapters';
import { CodexHttpAdapter, ClaudeOAuthAdapter, CopilotHttpAdapter, OpenRouterCreditsAdapter, OpenRouterCompositeAdapter } from './credential-adapters';

/** Explicit credential-backed entry point, independent of local CLI/SDK installs. */
export function getCredentialAdapter(id: string): ProviderAdapter {
  const adapter = [new CodexHttpAdapter(), new ClaudeOAuthAdapter(), new CopilotHttpAdapter(), new OpenRouterCreditsAdapter(), new DeepSeekBalanceAdapter(), new KimiPlatformCnAdapter(), new OpenRouterCompositeAdapter()].find(a => a.manifest.id === id);
  if (!adapter) throw new AdapterError('UNSUPPORTED', '不支持的凭据查询服务');
  return adapter;
}

function preferCredential(direct: ProviderAdapter, local: ProviderAdapter): ProviderAdapter {
  return { manifest: direct.manifest, probe: input => input.secret ? direct.probe(input) : local.probe(input),
    collect: input => input.secret ? direct.collect(input) : local.collect(input),
    normalize: (raw, at) => direct.normalize(raw, at), describeRecovery: error => direct.describeRecovery(error), disconnect: () => direct.disconnect() };
}
const adapters: ProviderAdapter[] = [new DeepSeekBalanceAdapter(), new KimiPlatformCnAdapter(), new OpenRouterCompositeAdapter(),
  preferCredential(new CodexHttpAdapter(), new CodexLocalAdapter()), preferCredential(new CopilotHttpAdapter(), new CopilotLocalAdapter()), new ClaudeOAuthAdapter()];
export const manifests = adapters.map(adapter => adapter.manifest);
export function getAdapter(id: string): ProviderAdapter {
  const adapter = adapters.find(item => item.manifest.id === id);
  if (!adapter) throw new AdapterError('UNSUPPORTED', '不支持的服务');
  return adapter;
}
