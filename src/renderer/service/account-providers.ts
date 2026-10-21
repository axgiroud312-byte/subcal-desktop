export const PROVIDERS = [
  { id: 'codex-local', name: 'Codex', mode: 'device' },
  { id: 'claude-local', name: 'Claude Code', mode: 'external' },
  { id: 'copilot-local', name: 'GitHub Copilot', mode: 'device' },
  { id: 'deepseek-balance', name: 'DeepSeek API', mode: 'api_key' },
  { id: 'kimi-platform-cn', name: 'Kimi API', mode: 'api_key' },
  { id: 'openrouter-key', name: 'OpenRouter', mode: 'api_key' },
] as const;
