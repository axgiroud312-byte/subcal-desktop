import { useEffect, useState } from 'react';
import { Download, KeyRound, Pause, Play, Plus, RefreshCw, Unplug } from 'lucide-react';
import type { PageProps } from '../contracts';
import type { Connection } from '../../shared/types';
import { BrandIcon, Modal, StatusBadge, connectionStateMeta, formatDateTime } from '../components/ui';
import { AddSubscription } from '../components/AddSubscription';
import { Button } from '../components/ui/button';
import { PROVIDERS } from '../service/account-providers';
import './connections.css';

export { PROVIDERS } from '../service/account-providers';

export function ConnectionsPage({ snapshot, client, notify, onOpen, focusId }: PageProps & { focusId?: string }) {
  const [adding, setAdding] = useState<{ provider?: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);
  const allPaused = snapshot.connections.length > 0 && snapshot.connections.every(c => c.state === 'paused' || c.state === 'disconnected');

  useEffect(() => {
    if (!focusId) return;
    const id = snapshot.subscriptions.find(s => s.id === focusId)?.connectionId ?? focusId;
    document.getElementById(`connection-${id}`)?.scrollIntoView({ block: 'center' });
  }, [focusId, snapshot.connections.length]);

  const run = async (action: () => Promise<unknown>, message?: string) => {
    try { await action(); if (message) notify(message); } catch (e) { notify((e as Error).message); }
  };

  return <div className="conn-page">
    <div className="conn-header-bar">
      <h2 className="conn-page-title">连接</h2>
      <div className="row">
        {snapshot.connections.length > 0 && <>
          <Button variant="outline" onClick={() => void run(async () => notify(await client.refresh()))}><RefreshCw />刷新全部</Button>
          <Button variant="outline" onClick={() => void run(() => client.pause(), '已更新自动更新状态')}>{allPaused ? <Play /> : <Pause />}{allPaused ? '恢复更新' : '暂停更新'}</Button>
        </>}
        <Button onClick={() => setAdding({})}><Plus />添加账号</Button>
      </div>
    </div>
    {snapshot.connections.length === 0 ? <section className="panel empty"><h3>尚未添加账号</h3><Button variant="outline" onClick={() => setAdding({})}>添加账号</Button></section> : <section className="conn-grid" aria-label="连接列表">
      {snapshot.connections.map(c => {
        const meta = connectionStateMeta(c.state);
        const provider = PROVIDERS.find(p => p.id === c.adapterId || p.id === c.provider || p.name === c.provider);
        return <article className="conn-card" id={`connection-${c.id}`} key={c.id} data-focused={focusId === c.id}>
          <header className="conn-card-header"><div className="conn-identity"><div className="conn-title-row"><BrandIcon product={provider?.name || c.provider} /><strong className="conn-provider-name">{provider?.name || c.provider}</strong></div><span className="conn-account-meta">{c.account || '账号待确认'}</span></div><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></header>
          {c.credentialMask && <span className="muted"><KeyRound className="inline-icon" /> {c.credentialMask}</span>}
          <div className="conn-time-strip"><span>上次更新：{formatDateTime(c.lastSuccess, snapshot.preferences.timezone)}</span></div>
          {c.error && <div role="alert"><p>{c.error.message}</p><p className="muted">{c.error.action}</p></div>}
          <div className="row">
            <Button variant="outline" disabled={c.state === 'refreshing'} onClick={() => void run(async () => notify(await client.refresh(c.id)))}><RefreshCw />刷新</Button>
            <Button variant="outline" onClick={() => void run(() => client.pause(c.id), '已更新自动更新状态')}>{c.state === 'paused' ? <Play /> : <Pause />}{c.state === 'paused' ? '恢复' : '暂停'}</Button>
            <Button variant="outline" disabled={!provider} onClick={() => provider && setAdding({ provider: provider.id })}><KeyRound />重新登录 / 添加账号</Button>
            <Button variant="ghost" onClick={() => setDisconnecting(c)}><Unplug />断开</Button>
          </div>
          <details><summary>连接详情</summary><div className="stack">{snapshot.subscriptions.filter(s => s.connectionId === c.id).map(s => <Button key={s.id} variant="ghost" onClick={() => onOpen(s.id)}>{s.product} · {s.account || '订阅详情'}</Button>)}<Button variant="ghost" onClick={() => void run(async () => setDiagnostics(await client.diagnose(c.id)))}><Download />导出诊断</Button></div></details>
        </article>;
      })}
    </section>}
    <section className="panel stack"><h3>支持的服务</h3><div className="conn-grid">{PROVIDERS.map(p => <div className="row" key={p.id}><BrandIcon product={p.name} /><span>{p.name}</span><Button variant="ghost" onClick={() => setAdding({ provider: p.id })}>添加账号</Button></div>)}</div></section>
    {adding && <AddSubscription client={client} notify={notify} initialProvider={adding.provider} onAdded={() => {}} onClose={() => setAdding(null)} />}
    {disconnecting && <Modal title="断开连接？" onClose={() => setDisconnecting(null)}><div className="stack"><p>停止自动更新并移除本应用保存的登录信息，订阅资料保留。</p><Button variant="destructive" onClick={() => void run(async () => { await client.disconnect(disconnecting.id, true); setDisconnecting(null); }, '已断开连接')}>断开连接</Button></div></Modal>}
    {diagnostics !== null && <Modal title="连接诊断" onClose={() => setDiagnostics(null)}><div className="stack"><pre className="overflow-auto whitespace-pre-wrap">{diagnostics}</pre><Button variant="outline" onClick={() => void run(async () => { if (!window.subcal) throw new Error('请在桌面应用内导出'); await window.subcal.saveFile('subcal-diagnostics.json', diagnostics); })}>导出诊断</Button></div></Modal>}
  </div>;
}
