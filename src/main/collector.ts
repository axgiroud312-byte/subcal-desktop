import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { AdapterError, type AdapterErrorCode, type CollectInput, type CollectOutput } from './adapters/types';
import { getAdapter } from './adapters';
import { terminateProcessTree } from './adapters/runtime';

export class Collector {
  private active = new Map<string, { child: ChildProcess; cancel: () => void }>();
  private epochs=new Map<string,number>();
  private closed=false;
  constructor(private resolveProxy?:(url:string)=>Promise<string>) {}
  async collect(adapterId: string, input: CollectInput): Promise<CollectOutput> {
    if (input.signal?.aborted) return Promise.reject(new AdapterError('CANCELLED', '查询已取消'));
    if (this.active.has(input.connectionId)) return Promise.reject(new AdapterError('RATE_LIMITED', '此连接正在查询，请稍候'));
    const manifest = getAdapter(adapterId).manifest;
    const epoch=this.epochs.get(input.connectionId)??0;
    let proxyUrl=`https://${manifest.allowedHosts[0]}/`;
    if(adapterId==='remote-magpie'){
      try{const auth=JSON.parse(input.secret??'');if(auth.approvedOrigin===auth.origin)proxyUrl=auth.origin;}catch{/* worker reports invalid credentials */}
    }
    const proxy=this.resolveProxy?await this.resolveProxy(proxyUrl):undefined;
    if(this.closed||(this.epochs.get(input.connectionId)??0)!==epoch)throw new AdapterError('CANCELLED','查询已取消');
    const env:NodeJS.ProcessEnv={...process.env,ELECTRON_RUN_AS_NODE:'1'};
    if(proxy!==undefined) {
      // Electron resolves the user's system/PAC proxy. Node 24's built-in fetch
      // otherwise ignores it when Electron runs this isolated worker as Node.
      for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])delete env[key];
      const first=proxy.split(';')[0].trim();
      if(first!=='DIRECT') {
        const match=/^(PROXY|HTTPS)\s+([^\s]+)$/.exec(first);
        if(!match)throw new AdapterError('NETWORK_OFFLINE','当前系统代理类型不支持，请使用 HTTP 或 HTTPS 代理');
        env.HTTPS_PROXY=`${match[1]==='HTTPS'?'https':'http'}://${match[2]}`;
        env.HTTP_PROXY=env.HTTPS_PROXY;
      }
      env.NODE_USE_ENV_PROXY='1';
    }
    return new Promise((resolve, reject) => {
      const child = fork(path.join(__dirname, 'collector-worker.cjs'), [], { execPath: process.execPath,
        env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
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
  cancel(connectionId: string) { this.epochs.set(connectionId,(this.epochs.get(connectionId)??0)+1);this.active.get(connectionId)?.cancel(); }
  close() { this.closed=true;for (const task of [...this.active.values()]) task.cancel(); }
}
