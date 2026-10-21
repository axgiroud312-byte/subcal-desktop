import fs from 'node:fs/promises';
import path from 'node:path';

/** 桌面壳自身需要持久化的偏好（FE-009 托盘部分）。 */
export interface ShellPrefs {
  /** 关闭窗口时最小化到托盘；默认 true。 */
  closeToTray: boolean;
  /** 首次“关闭到托盘”说明对话框是否已展示过。 */
  closeToTrayExplained: boolean;
}

export const DEFAULT_SHELL_PREFS: ShellPrefs = {
  closeToTray: true,
  closeToTrayExplained: false,
};

/**
 * 读取持久化偏好。文件缺失、损坏或字段类型不符时安全回退默认值，
 * 绝不让一个坏文件阻止应用启动。
 */
export async function loadShellPrefs(file: string): Promise<ShellPrefs> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data: unknown = JSON.parse(raw);
    if (typeof data === 'object' && data !== null) {
      const o = data as Record<string, unknown>;
      return {
        closeToTray:
          typeof o.closeToTray === 'boolean'
            ? o.closeToTray
            : DEFAULT_SHELL_PREFS.closeToTray,
        closeToTrayExplained:
          typeof o.closeToTrayExplained === 'boolean'
            ? o.closeToTrayExplained
            : DEFAULT_SHELL_PREFS.closeToTrayExplained,
      };
    }
  } catch {
    /* 文件不存在或已损坏：使用默认值 */
  }
  return { ...DEFAULT_SHELL_PREFS };
}

/**
 * 安全写入偏好：先写临时文件再改名，避免半写状态；
 * 失败只告警不抛出（偏好丢失不应拖垮预览）。
 */
export async function saveShellPrefs(file: string, prefs: ShellPrefs): Promise<void> {
  try {
    const tmp = `${file}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    console.warn('[SubCal] 桌面壳偏好保存失败，本次运行仍继续:', err);
  }
}
