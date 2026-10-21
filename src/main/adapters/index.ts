import { CodexLocalAdapter } from './codex-adapter';
import { CopilotLocalAdapter } from './copilot-adapter';
import { DeepSeekBalanceAdapter, KimiPlatformCnAdapter } from './http-adapters';
import { AdapterError, type ProviderAdapter } from './types';
export { CodexHttpAdapter, ClaudeOAuthAdapter, CopilotHttpAdapter, OpenRouterCreditsAdapter, OpenRouterCompositeAdapter, parseHttpCredential, copilotUsageHeaders } from './credential-adapters';
export { hashKeySubject } from './http-adapters';
import { CodexHttpAdapter, ClaudeOAuthAdapter, CopilotHttpAdapter, OpenRouterCreditsAdapter, OpenRouterCompositeAdapter } from './credential-adapters';
import { CursorAdapter, DevinAdapter, OpenCodeGoAdapter } from './priority-adapters';
import { extendedAdapters } from './extended-adapters';
import { controlAdapters } from './control-adapters';
import { regionalAdapters } from './regional-adapters';
import { remoteAccountAdapter } from './remote-account-adapter';
import { walletAdapters } from './wallet-adapters';
import { signedAdapters } from './signed-adapters';
import { desktopServiceAdapters } from './desktop-service-adapters';
import { zcodeAdapters } from './zcode-adapter';
import { createRelayAccountAdapter } from './relay-account-adapter';

/** Explicit credential-backed entry point, independent of local CLI/SDK installs. */
export function getCredentialAdapter(id: string): ProviderAdapter {
  const adapter = [...adapters, new OpenRouterCreditsAdapter()].find(a => a.manifest.id === id);
  if (!adapter) throw new AdapterError('UNSUPPORTED', '不支持的凭据查询服务');
  return adapter;
}

function preferCredential(direct: ProviderAdapter, local: ProviderAdapter): ProviderAdapter {
  return { manifest: direct.manifest, probe: input => input.secret ? direct.probe(input) : local.probe(input),
    collect: input => input.secret ? direct.collect(input) : local.collect(input),
    normalize: (raw, at) => direct.normalize(raw, at), describeRecovery: error => direct.describeRecovery(error), disconnect: () => direct.disconnect() };
}
/** Discovery already binds ZCode site/org/project/device into its subject.
 * Keep that external-source identity for refreshExternal; the standalone adapter
 * still derives its own isolated pool identity from the full credential. */
export function bindZCodeSource(adapter: ProviderAdapter): ProviderAdapter {
  const collect: ProviderAdapter['collect'] = async input => {
    let envelope: Record<string, unknown> = {};
    try { envelope = JSON.parse(input.secret || '{}'); } catch { /* adapter reports malformed input */ }
    if (envelope?.management !== 'external' || !envelope.locator || typeof envelope.subject !== 'string') return adapter.collect(input);
    if (input.expectedSubject && input.expectedSubject !== envelope.subject) throw new AdapterError('ACCOUNT_MISMATCH', 'ZCode 来源账号已变化');
    const output = await adapter.collect({ ...input, expectedSubject: undefined });
    return { ...output, account: { ...output.account, subject: envelope.subject } };
  };
  return { manifest: adapter.manifest, probe: collect, collect, normalize: (raw, at) => adapter.normalize(raw, at), describeRecovery: e => adapter.describeRecovery(e), disconnect: () => adapter.disconnect() };
}
const adapters: ProviderAdapter[] = [new DeepSeekBalanceAdapter(), new KimiPlatformCnAdapter(), new OpenRouterCompositeAdapter(),
  preferCredential(new CodexHttpAdapter(), new CodexLocalAdapter()), preferCredential(new CopilotHttpAdapter(), new CopilotLocalAdapter()), new ClaudeOAuthAdapter(),
  new CursorAdapter(), new DevinAdapter(), new OpenCodeGoAdapter(), ...extendedAdapters, ...regionalAdapters, ...walletAdapters, ...signedAdapters, ...desktopServiceAdapters, ...zcodeAdapters.map(bindZCodeSource), ...controlAdapters.filter(a=>a.manifest.id!=='remote-magpie'), remoteAccountAdapter, createRelayAccountAdapter()];
export const manifests = adapters.map(adapter => adapter.manifest);
export function getAdapter(id: string): ProviderAdapter {
  const adapter = adapters.find(item => item.manifest.id === id);
  if (!adapter) throw new AdapterError('UNSUPPORTED', '不支持的服务');
  return adapter;
}
