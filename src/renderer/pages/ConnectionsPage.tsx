import { useEffect, useRef, useState } from 'react';
import { Download, KeyRound, Pause, Play, Plus, RefreshCw, Unplug } from 'lucide-react';
import type { PageProps } from '../contracts';
import type { AuthSession, Connection, Probe } from '../../shared/types';
import { BrandIcon, Modal, StatusBadge, connectionStateMeta, formatDateTime } from '../components/ui';
import { FormSelect } from '../components/form-controls';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Field, FieldLabel } from '../components/ui/field';
import './connections.css';

const PROVIDERS = [
  { id: 'deepseek-balance', name: 'DeepSeek', mode: 'api_key', reads: '可用总余额、充值余额、赠送余额及币种', unavailable: '订阅开始日、续费日', permission: 'API Key 同时具有推理权限；此连接仅查询余额。' },
  { id: 'kimi-platform-cn', name: 'Kimi API', mode: 'api_key', reads: '国内站可用余额、现金余额、代金券余额', unavailable: 'Kimi Code 额度、会员续费日', permission: '国内站 API Key 同时具有推理权限；此连接仅查询余额。' },
  { id: 'openrouter-key', name: 'OpenRouter', mode: 'api_key', reads: '当前 Key 用量、限额及剩余预算', unavailable: '账户总资金、会员续费日', permission: '当前 API Key 同时具有推理权限；此连接仅查询 Key 预算。' },
  { id: 'codex-local', name: 'Codex', mode: 'local_client', reads: '官方客户端返回的额度、套餐及重置时间', unavailable: 'ChatGPT 全部权益、真实扣费日', permission: '连接本机已登录的官方 Codex 客户端，仅查询账号与额度，不切换账号。' },
  { id: 'copilot-local', name: 'GitHub Copilot', mode: 'local_client', reads: '官方 SDK 返回的额度及重置时间', unavailable: '会员扣费日', permission: '连接本机已登录的官方 Copilot 运行时，仅查询账号额度，不创建对话。' },
] as const;

export function ConnectionsPage({ snapshot, client, notify, onOpen, focusId }: PageProps & { focusId?: string }) {
  const [wizard, setWizard] = useState<{ provider: string; connectionId?: string } | null>(null);
  const [subscriptionId, setSubscriptionId] = useState('');
  const [secret, setSecret] = useState('');
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [mask, setMask] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);
  const sequence = useRef(0);
  const selected = PROVIDERS.find(p => p.id === wizard?.provider) ?? PROVIDERS[0];
  const allPaused = snapshot.connections.length > 0 && snapshot.connections.every(c => c.state === 'paused' || c.state === 'disconnected');

  useEffect(() => {
    if (!focusId) return;
    const id = snapshot.subscriptions.find(s => s.id === focusId)?.connectionId ?? focusId;
    document.getElementById(`connection-${id}`)?.scrollIntoView({ block: 'center' });
  }, [focusId, snapshot.connections.length]);

  const run = async (action: () => Promise<unknown>, message?: string) => {
    try { await action(); if (message) notify(message); } catch (e) { notify((e as Error).message); }
  };
  const openWizard = (provider: string, connectionId?: string) => {
    sequence.current++;
    setWizard({ provider, connectionId }); setAuth(null); setProbe(null); setSecret(''); setMask(''); setError(''); setBusy(false);
    setSubscriptionId(snapshot.subscriptions.find(s => s.connectionId === connectionId)?.id ?? '');
  };
  const closeWizard = () => {
    sequence.current++; setSecret(''); setProbe(null); setAuth(null); setWizard(null); setBusy(false);
  };

  async function testConnection() {
    if (!wizard || busy) return;
    const request = ++sequence.current;
    setBusy(true); setError(''); setProbe(null);
    try {
      if (!client.beginAuth || !client.saveCredential) throw new Error('连接服务不可用，请重新打开桌面应用');
      let connectionId = wizard.connectionId || auth?.connectionId;
      if (!connectionId) {
        const nextAuth = await client.beginAuth(selected.id, subscriptionId || undefined);
        if (request !== sequence.current) return;
        setAuth(nextAuth); connectionId = nextAuth.connectionId;
      }
      if (selected.mode === 'api_key') {
        if (!secret.trim() && !mask && !wizard.connectionId) throw new Error('请填写 API Key');
        if (secret.trim()) {
          const value = secret.trim();
          setSecret('');
          const result = await client.saveCredential(connectionId, value);
          if (request !== sequence.current) return;
          setMask(result.mask);
        }
      }
      const result = await client.probe(connectionId, '');
      if (request === sequence.current) setProbe(result);
    } catch (e) { if (request === sequence.current) setError((e as Error).message); }
    finally { if (request === sequence.current) setBusy(false); }
  }

  async function confirmConnection() {
    if (!probe || busy) return;
    const request = sequence.current;
    setBusy(true); setError('');
    try { await client.bind(probe); if (request === sequence.current) closeWizard(); notify('已启用自动更新'); }
    catch (e) { if (request === sequence.current) { setError((e as Error).message); setBusy(false); } }
  }

  return <div className="conn-page">
    <div className="conn-header-bar">
      <h2 className="conn-page-title">连接</h2>
      <div className="row">
        {snapshot.connections.length > 0 && <>
          <Button variant="outline" onClick={() => void run(async () => notify(await client.refresh()))}><RefreshCw />刷新全部</Button>
          <Button variant="outline" onClick={() => void run(() => client.pause(), '已更新采集状态')}>{allPaused ? <Play /> : <Pause />}{allPaused ? '恢复采集' : '暂停采集'}</Button>
        </>}
        <Button onClick={() => openWizard(PROVIDERS[0].id)}><Plus />添加连接</Button>
      </div>
    </div>

    {snapshot.connections.length === 0 ? <section className="panel empty"><h3>尚未添加连接</h3><Button variant="outline" onClick={() => openWizard(PROVIDERS[0].id)}>连接服务</Button></section> : <section className="conn-grid" aria-label="连接列表">
      {snapshot.connections.map(c => {
        const meta = connectionStateMeta(c.state);
        const provider = PROVIDERS.find(p => p.id === c.adapterId || p.id === c.provider || p.name === c.provider);
        return <article className="conn-card" id={`connection-${c.id}`} key={c.id} data-focused={focusId === c.id}>
          <header className="conn-card-header"><div className="conn-identity"><div className="conn-title-row"><BrandIcon product={provider?.name || c.provider} /><strong className="conn-provider-name">{provider?.name || c.provider}</strong></div><span className="conn-account-meta">{c.account || '账号待确认'}</span></div><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></header>
          <div className="row"><StatusBadge>{c.verification === 'verified' ? '已验证' : '待验证'}</StatusBadge>{c.credentialMask && <span className="muted"><KeyRound className="inline-icon" /> {c.credentialMask}</span>}</div>
          <div className="conn-time-strip"><span>上次成功：{formatDateTime(c.lastSuccess, snapshot.preferences.timezone)}</span><span>下次允许：{formatDateTime(c.nextAllowed, snapshot.preferences.timezone)}</span></div>
          {c.error && <div role="alert"><p>{c.error.message}</p><p className="muted">{c.error.action}</p></div>}
          <div className="row">
            <Button variant="outline" disabled={c.state === 'refreshing'} onClick={() => void run(async () => notify(await client.refresh(c.id)))}><RefreshCw />刷新</Button>
            <Button variant="outline" onClick={() => void run(() => client.pause(c.id), '已更新采集状态')}>{c.state === 'paused' ? <Play /> : <Pause />}{c.state === 'paused' ? '恢复' : '暂停'}</Button>
            <Button variant="outline" disabled={!provider} onClick={() => provider && openWizard(provider.id, c.id)}><KeyRound />{provider?.mode === 'api_key' ? '替换 Key / 重连' : '重新连接'}</Button>
            <Button variant="ghost" onClick={() => setDisconnecting(c)}><Unplug />断开</Button>
          </div>
          <details><summary>连接详情</summary><div className="stack"><p>可读取：{c.fields.join('、') || '等待探测'}</p><p>未提供：{c.unsupported.join('、') || '等待探测'}</p><p>版本：{c.version}</p>{snapshot.subscriptions.filter(s => s.connectionId === c.id).map(s => <Button key={s.id} variant="ghost" onClick={() => onOpen(s.id)}>{s.product} · {s.account || '订阅详情'}</Button>)}<Button variant="ghost" onClick={() => void run(async () => setDiagnostics(await client.diagnose(c.id)))}><Download />脱敏诊断</Button></div></details>
        </article>;
      })}
    </section>}

    <section className="panel stack"><h3>支持的服务</h3><div className="conn-grid">{PROVIDERS.map(p => <div className="row" key={p.id}><BrandIcon product={p.name} /><span>{p.name}</span><StatusBadge>待验证</StatusBadge><Button variant="ghost" onClick={() => openWizard(p.id)}>连接</Button></div>)}</div></section>
    <section className="panel stack"><h3>日历连接</h3><div className="row">{['Google Calendar', 'iCloud CalDAV', 'macOS EventKit'].map(name => <span className="row" key={name}>{name}<StatusBadge>待接入</StatusBadge></span>)}</div></section>

    {wizard && <Modal title={wizard.connectionId ? '重新连接' : '添加连接'} onClose={closeWizard}>
      <div className="stack">
        {!wizard.connectionId && <Field><FieldLabel htmlFor="auth-provider">服务</FieldLabel><FormSelect id="auth-provider" value={selected.id} disabled={busy || !!auth} onChange={e => openWizard(e.target.value)}>{PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FormSelect></Field>}
        <dl className="stack"><div><dt>读取</dt><dd>{selected.reads}</dd></div><div><dt>不提供</dt><dd>{selected.unavailable}</dd></div><div><dt>权限</dt><dd>{selected.permission}</dd></div><div><dt>凭据位置</dt><dd>{selected.mode === 'api_key' ? '由当前系统用户加密保存在本机，备份不含 Key。' : '由官方客户端管理，不复制登录文件。'}</dd></div></dl>
        {!wizard.connectionId && <Field><FieldLabel htmlFor="auth-subscription">关联订阅</FieldLabel><FormSelect id="auth-subscription" value={subscriptionId} disabled={busy || !!auth} onChange={e => setSubscriptionId(e.target.value)}><option value="">新建订阅</option>{snapshot.subscriptions.filter(s => !s.connectionId && s.lifecycle !== 'archived').map(s => <option key={s.id} value={s.id}>{s.product} · {s.account || '未命名账号'}</option>)}</FormSelect></Field>}
        {selected.mode === 'api_key' && <Field><FieldLabel htmlFor="auth-secret">API Key {mask && `· ${mask}`}</FieldLabel><Input id="auth-secret" type="password" autoComplete="off" spellCheck={false} value={secret} disabled={busy} onChange={e => { setSecret(e.target.value); setProbe(null); }} placeholder={mask || (wizard.connectionId ? '留空使用已保存的 Key' : '填写 API Key')} /></Field>}
        {selected.mode === 'local_client' && <Button variant="ghost" onClick={() => void run(async () => { if (!window.subcal) throw new Error('请在桌面应用内打开'); await window.subcal.openExternal(selected.id === 'codex-local' ? 'https://github.com/openai/codex' : 'https://github.com/github/copilot-cli'); })}>官方安装与登录说明</Button>}
        {error && <p role="alert" className="danger-text">{error}</p>}
        <Button variant="outline" disabled={busy || (selected.mode === 'api_key' && !secret.trim() && !mask && !wizard.connectionId)} onClick={() => void testConnection()}><RefreshCw />{busy ? '查询中…' : probe ? '重新查询' : '读取账号与字段'}</Button>
        {probe && <section className="panel stack"><strong>{probe.account || '当前 Key'}</strong>{probe.samples.length ? probe.samples.map((sample, i) => <p key={i}>{sample}</p>) : <p>未返回可用字段</p>}<p className="muted">{probe.fields.join('、')}</p><Button disabled={busy} onClick={() => void confirmConnection()}>确认并启用自动更新</Button></section>}
      </div>
    </Modal>}
    {disconnecting && <Modal title="断开连接？" onClose={() => setDisconnecting(null)}><div className="stack"><p>停止采集并删除保存的凭据，订阅资料保留。</p><Button variant="destructive" onClick={() => void run(async () => { await client.disconnect(disconnecting.id, true); setDisconnecting(null); }, '已断开连接')}>断开并删除凭据</Button></div></Modal>}
    {diagnostics !== null && <Modal title="脱敏诊断" onClose={() => setDiagnostics(null)}><div className="stack"><p>包含适配器版本、采集状态、错误码与运行时间。</p><pre className="overflow-auto whitespace-pre-wrap">{diagnostics}</pre><Button variant="outline" onClick={() => void run(async () => { if (!window.subcal) throw new Error('请在桌面应用内导出'); await window.subcal.saveFile('subcal-diagnostics.json', diagnostics); })}>导出诊断</Button></div></Modal>}
  </div>;
}
