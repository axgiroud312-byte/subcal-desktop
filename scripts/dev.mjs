/**
 * SubCal 前端预览开发启动器（npm run dev）。
 *
 * 1. 用 esbuild 把 src/main / src/preload 编译成 dist-electron/main.cjs 与 preload.cjs（最小产物）。
 * 2. 通过 Vite library API 启动开发服务器（读取 vite.config.ts，127.0.0.1:5173）。
 * 3. 以 SUBCAL_DEV_URL 指向该服务器启动 Electron；显式移除 ELECTRON_RUN_AS_NODE。
 * 4. Electron 退出时关闭 Vite；Ctrl+C 时同时结束两者。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createServer } from 'vite';

// electron 的可执行文件路径在 require 时解析；二进制未下载（postinstall 未完成）时给出明确提示
const require = createRequire(import.meta.url);
let electronBinary;
try {
  electronBinary = require('electron');
} catch {
  console.error('[dev] 未找到 Electron 可执行文件：请先完成依赖安装（npm install，需下载 Electron 二进制）。');
  process.exit(1);
}

const ESBUILD_COMMON = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'warning',
};

async function main() {
  console.log('[dev] 编译 Electron 主进程与 preload…');
  await build({
    ...ESBUILD_COMMON,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist-electron/main.cjs',
  });
  await build({
    ...ESBUILD_COMMON,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
  });

  console.log('[dev] 启动 Vite 开发服务器…');
  let server;
  let runningPreview = false;
  try {
    const response = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(800) });
    runningPreview = (await response.text()).includes('<title>SubCal · 桌面前端预览</title>');
  } catch { /* 首次启动 */ }
  if (!runningPreview) {
    server = await createServer();
    await server.listen();
  } else {
    console.log('[dev] 已有 SubCal 预览服务，正在打开现有窗口…');
  }
  const devUrl = server?.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5173/';
  console.log(`[dev] Vite: ${devUrl}`);

  const env = { ...process.env, SUBCAL_DEV_URL: devUrl };
  // 某些终端/IDE 会注入 ELECTRON_RUN_AS_NODE，会让 Electron 退化为纯 Node，必须移除
  delete env.ELECTRON_RUN_AS_NODE;

  console.log('[dev] 启动 Electron 窗口（关闭窗口默认最小化到托盘，托盘菜单可退出）…');
  const child = spawn(electronBinary, ['.'], {
    stdio: 'inherit',
    env,
    cwd: process.cwd(),
  });

  let closing = false;
  const shutdown = async (code) => {
    if (closing) return;
    closing = true;
    try {
      child.kill();
    } catch {
      /* 已退出 */
    }
    try {
      await server?.close();
    } catch {
      /* 已关闭 */
    }
    process.exit(code ?? 0);
  };

  child.on('exit', (code, signal) => {
    void shutdown(code ?? (signal ? 1 : 0));
  });
  child.on('error', (err) => {
    console.error('[dev] Electron 启动失败:', err);
    void shutdown(1);
  });
  process.on('SIGINT', () => void shutdown(130));
  process.on('SIGTERM', () => void shutdown(143));
}

main().catch((err) => {
  console.error('[dev] 启动失败:', err);
  process.exit(1);
});
