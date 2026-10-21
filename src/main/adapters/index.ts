import { CodexLocalAdapter } from './codex-adapter';
import { CopilotLocalAdapter } from './copilot-adapter';
import { DeepSeekBalanceAdapter, KimiPlatformCnAdapter, OpenRouterKeyAdapter } from './http-adapters';
import { AdapterError, type ProviderAdapter } from './types';

const adapters: ProviderAdapter[] = [new DeepSeekBalanceAdapter(), new KimiPlatformCnAdapter(), new OpenRouterKeyAdapter(), new CodexLocalAdapter(), new CopilotLocalAdapter()];
export const manifests = adapters.map(adapter => adapter.manifest);
export function getAdapter(id: string): ProviderAdapter {
  const adapter = adapters.find(item => item.manifest.id === id);
  if (!adapter) throw new AdapterError('UNSUPPORTED', '不支持的服务');
  return adapter;
}
