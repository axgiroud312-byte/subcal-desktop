import { SERVICE_ACCESS, EXISTING_LOGIN_SERVICES } from '../../shared/service-access';
export const PROVIDERS = [
  { id: 'codex-local', name: 'Codex', mode: 'device' },
  { id: 'claude-local', name: 'Claude Code', mode: 'external' },
  { id: 'copilot-local', name: 'GitHub Copilot', mode: 'device' },
  { id: 'deepseek-balance', name: 'DeepSeek API', mode: 'api_key' },
  { id: 'kimi-platform-cn', name: 'Kimi API', mode: 'api_key' },
  { id: 'openrouter-key', name: 'OpenRouter', mode: 'api_key' },
  ...SERVICE_ACCESS,
  ...EXISTING_LOGIN_SERVICES,
] as const;
