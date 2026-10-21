import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { AdapterError, type AdapterErrorCode, type CollectInput, type CollectOutput } from './adapters/types';
import { getAdapter } from './adapters';
import { terminateProcessTree } from './adapters/runtime';

export class Collector {
  private active = new Map<string, { child: ChildProcess; cancel: () => void }>();
  collect(adapterId: string, input: CollectInput): Promise<CollectOutput> {
    if (input.signal?.aborted) return Promise.reject(new AdapterError('CANCELLED', '查询已取消'));
    if (this.active.has(input.connectionId)) return Promise.reject(new AdapterError('RATE_LIMITED', '此连接正在查询，请稍候'));
    const manifest = getAdapter(adapterId).manifest;
    return new Promise((resolve, reject) => {
      const child = fork(path.join(__dirname, 'collector-worker.cjs'), [], { execPath: process.execPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
      let settled = false;
      const finish = (error?: AdapterError, result?: CollectOutput) => {
        if (settled) return; settled = true;
        clearTimeout(timer); input.signal?.removeEventListener('abort', cancel);
        this.active.delete(input.connectionId);
        terminateProcessTree(child);
        if (error) reject(error); else resolve(result!);
      };
      const cancel = () => finish(new AdapterError('CANCELLED', '查询已取消'));
      const timer = setTimeout(() => finish(new AdapterError('TIMEOUT', '采集超时，已停止查询')), (input.timeoutMs ?? manifest.timeoutMs) + 5000);
      this.active.set(input.connectionId, { child, cancel });
      input.signal?.addEventListener('abort', cancel, { once: true });
      child.once('error', () => finish(new AdapterError('UPSTREAM_UNAVAILABLE', '无法启动采集进程')));
      child.once('exit', () => finish(new AdapterError('UPSTREAM_UNAVAILABLE', '采集进程已退出，旧数据保留')));
      child.on('message', (message: { ok?: boolean; result?: CollectOutput; error?: { code: AdapterErrorCode; message: string; options?: { retryAfterMs?: number; httpStatus?: number } } }) => {
        if (message.ok && message.result) finish(undefined, message.result);
        else if (message.error) finish(new AdapterError(message.error.code, message.error.message, message.error.options));
        else finish(new AdapterError('SCHEMA_CHANGED', '采集结果结构无效'));
      });
      const { signal: _signal, ...serializable } = input;
      child.send({ type: 'collect', adapterId, input: serializable }, error => { if (error) finish(new AdapterError('UPSTREAM_UNAVAILABLE', '无法发送采集任务')); });
    });
  }
  cancel(connectionId: string) { this.active.get(connectionId)?.cancel(); }
  close() { for (const task of [...this.active.values()]) task.cancel(); }
}
