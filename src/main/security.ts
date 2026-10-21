import path from 'node:path';
import type { TraySummary } from '../shared/bridge';

/**
 * 显式配置的官方域名清单。Renderer 只能打开这些域名（含子域）的 HTTPS 页面。
 * 新增域名前必须核对归属，不允许凭调用方传入任意地址。
 */
export const OFFICIAL_HTTPS_DOMAINS: readonly string[] = [
  'openai.com',
  'chatgpt.com',
  'anthropic.com',
  'claude.ai',
  'claude.com',
  'google.com',
  'apple.com',
  'icloud.com',
  'microsoft.com',
  'live.com',
  'microsoftonline.com',
  'github.com',
  'deepseek.com',
  'moonshot.cn',
  'kimi.com',
  'openrouter.ai',
  'cursor.com',
  'devin.ai',
  'factory.ai',
  'workos.com',
  'x.ai',
  'grok.com',
  'perplexity.ai',
  'minimax.io',
  'minimax.cn',
  'kiro.dev',
  'qoder.com',
  'qoder.cn',
  'tencent.com',
  'workbuddy.ai',
  'trae.cn',
  'trae.ai',
  'huaweicloud.com',
  'z.ai',
];

/** 导入备份的大小上限：2MB（FE-009）。 */
export const OPEN_FILE_MAX_BYTES = 2 * 1024 * 1024;
/** 导出备份的大小上限（演示资料远小于此，防御性限制）。 */
export const SAVE_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** 托盘摘要里单条文本的最大长度，避免超长菜单。 */
const TRAY_TEXT_MAX = 120;
/** 托盘最多显示的置顶条数（FE-009）。 */
export const TRAY_PINNED_MAX = 5;

function isIpLiteralHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * 校验“官方 HTTPS 链接”。通过则返回规范化后的 URL 字符串，否则抛出中文错误。
 * 拒绝：非 https、IP 字面量、带凭据、非标准端口、清单外域名。
 */
export function assertOfficialHttpsUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    throw new Error('链接格式无效');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('链接格式无效');
  }
  if (url.protocol !== 'https:') {
    throw new Error('仅允许打开 HTTPS 官方链接');
  }
  if (url.username || url.password) {
    throw new Error('不允许打开带凭据的链接');
  }
  if (url.port && url.port !== '443') {
    throw new Error('不允许打开非标准端口的链接');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || isIpLiteralHost(host)) {
    throw new Error('不允许打开本机或 IP 地址链接');
  }
  const allowed = OFFICIAL_HTTPS_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (!allowed) {
    throw new Error('该域名不在官方允许清单中，已阻止打开');
  }
  return url.toString();
}

/**
 * 校验开发服务器 URL：仅允许本机回环地址的 http(s)。
 * 返回规范化 URL；不合法返回 null（调用方回退默认值）。
 */
export function normalizeLoopbackDevUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const loopback =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]';
    if ((url.protocol === 'http:' || url.protocol === 'https:') && loopback) {
      return url.href;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

/** 把渲染层给的文件名清洗成安全的本地文件名（不含路径、非法字符与控制字符）。 */
export function sanitizeExportFileName(raw: unknown): string {
  const fallback = 'subcal-backup.json';
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const cleaned = path
    .basename(raw)
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? '_' : ch))
    .join('')
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

function needString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`托盘摘要字段 ${name} 必须是字符串`);
  }
  return value.slice(0, TRAY_TEXT_MAX);
}

function needBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`托盘摘要字段 ${name} 必须是布尔值`);
  }
  return value;
}

/**
 * 主进程侧权威校验托盘摘要（与 src/shared/bridge.ts 的 TraySummary 合同一致）。
 * pinned 最多保留五条，reconnectCount 收敛到 0..999。
 */
export function sanitizeTraySummary(input: unknown): TraySummary {
  if (typeof input !== 'object' || input === null) {
    throw new Error('托盘摘要必须是对象');
  }
  const o = input as Record<string, unknown>;
  const nextRenewal = needString(o.nextRenewal, 'nextRenewal');
  if (!Array.isArray(o.pinned)) {
    throw new Error('托盘摘要字段 pinned 必须是字符串数组');
  }
  const pinned = o.pinned
    .slice(0, TRAY_PINNED_MAX)
    .map((item, index) => needString(item, `pinned[${index}]`));
  const count = o.reconnectCount;
  if (!Number.isInteger(count) || (count as number) < 0) {
    throw new Error('托盘摘要字段 reconnectCount 必须是非负整数');
  }
  const reconnectCount = Math.min(count as number, 999);
  const paused = needBoolean(o.paused, 'paused');
  const closeToTray = needBoolean(o.closeToTray, 'closeToTray');
  return { nextRenewal, pinned, reconnectCount, paused, closeToTray };
}
