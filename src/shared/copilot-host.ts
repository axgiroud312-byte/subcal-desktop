/** MIT mapping: Magpie ba319a7587923fc7a4ea3859658244d591261a59
 * internal/provider/copilot_ghe.go, Copyright (c) 2026 yetone. */
export function copilotHost(value: string): string {
  const raw = value.trim().toLowerCase();
  let host = raw.replace(/\/$/, '');
  if (raw.includes('://')) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new Error('Copilot 主机无效');
    host = url.hostname;
  }
  if (!host || host === 'github.com' || host === 'www.github.com') return 'github.com';
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ghe\.com$/.test(host)) return host;
  throw new Error('仅支持 github.com 或企业的 <名称>.ghe.com');
}
