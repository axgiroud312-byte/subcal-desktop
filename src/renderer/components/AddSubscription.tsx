import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, ExternalLink } from 'lucide-react';
import type { SubCalClient } from '../../shared/types';
import type { Notify } from '../contracts';
import { BrandIcon, Modal } from './ui';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel } from './ui/field';
import { PROVIDERS } from '../service/account-providers';

type Candidate = { id: string; providerId: string; alias: string; source: string; organization?: string };
type Login = { id: string; userCode: string; verificationUri: string; intervalSeconds: number; expiresAt: number };

export function AddSubscription({ client, notify, initialProvider, onAdded, onManual, onClose }: {
  client: SubCalClient; notify: Notify; initialProvider?: string;
  onAdded: (subscriptionId: string, connectionId: string) => void;
  onManual?: () => void; onClose: () => void;
}) {
  const [accounts, setAccounts] = useState<Candidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [discoveryError, setDiscoveryError] = useState('');
  const [error, setError] = useState('');
  const [providerId, setProviderId] = useState(initialProvider ?? '');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<Login | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const alive = useRef(true);
  const discoveringRef = useRef(false);
  const actionRef = useRef(false);
  const generation = useRef(0);
  const callbacks = useRef({ onAdded, onClose, notify });
  callbacks.current = { onAdded, onClose, notify };
  const selected = PROVIDERS.find(p => p.id === providerId);

  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const discover = useCallback(async () => {
    if (discoveringRef.current) return;
    discoveringRef.current = true;
    setDiscovering(true);
    try {
      if (!client.discoverAccounts) throw new Error('请在桌面应用中添加真实账号。');
      const result = await client.discoverAccounts();
      if (alive.current) { setAccounts(result.accounts); setWarnings(result.warnings); setDiscoveryError(''); }
    } catch (e) { if (alive.current) setDiscoveryError((e as Error).message); }
    finally { discoveringRef.current = false; if (alive.current) setDiscovering(false); }
  }, [client]);
  useEffect(() => { void discover(); }, [discover]);
  useEffect(() => {
    if (selected?.mode !== 'external') return;
    const refresh = () => { if (!document.hidden) void discover(); };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [selected?.mode, discover]);

  useEffect(() => {
    if (!login) return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        if (Date.now() >= login.expiresAt) throw new Error('登录码已过期，请重新登录。');
        if (!client.pollAccountLogin) throw new Error('登录服务不可用，请重新打开桌面应用。');
        const result = await client.pollAccountLogin(login.id);
        if (cancelled) return;
        if (result.status === 'expired') throw new Error('登录码已过期，请重新登录。');
        if (result.status === 'complete') {
          if (!result.subscriptionId || !result.connectionId) throw new Error('登录已完成，但尚未返回订阅，请重新发现账号后加入。');
          setLogin(null); callbacks.current.notify('账号已加入，订阅卡片已生成');
          callbacks.current.onAdded(result.subscriptionId, result.connectionId); callbacks.current.onClose();
          return;
        }
        timer = window.setTimeout(poll, Math.max(1, login.intervalSeconds) * 1000);
      } catch (e) { if (!cancelled) { setError((e as Error).message); setLogin(null); } }
    };
    timer = window.setTimeout(poll, Math.max(1, login.intervalSeconds) * 1000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [login, client]);

  const add = async (input: { candidateId?: string; providerId?: string; secret?: string }) => {
    if (actionRef.current) return;
    actionRef.current = true; setBusy(true); setError('');
    try {
      if (!client.addAccount) throw new Error('请在桌面应用中添加真实账号。');
      const result = await client.addAccount(input);
      if (!alive.current) return;
      setSecret('');
      if (input.candidateId) setAdded(current => new Set([...current, input.candidateId!]));
      notify('账号已加入，订阅卡片已生成');
      onAdded(result.subscriptionId, result.connectionId);
      if (!input.candidateId) onClose();
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { actionRef.current = false; if (alive.current) setBusy(false); }
  };
  const startLogin = async () => {
    if (actionRef.current) return;
    const request = ++generation.current;
    actionRef.current = true; setBusy(true); setError('');
    try {
      if (!client.startAccountLogin) throw new Error('请在桌面应用中登录真实账号。');
      const result = await client.startAccountLogin(providerId);
      if (alive.current && request === generation.current) setLogin(result);
    } catch (e) { if (alive.current && request === generation.current) setError((e as Error).message); }
    finally { actionRef.current = false; if (alive.current) setBusy(false); }
  };
  const openLogin = async () => {
    try {
      if (!login || !window.subcal?.openExternal) throw new Error('请在桌面应用中打开登录页面。');
      await window.subcal.openExternal(login.verificationUri);
    } catch (e) { setError((e as Error).message); }
  };

  return <Modal title="添加订阅" onClose={onClose}>
    <div className="stack">
      <div className="row spread"><h3>已有账号</h3><Button variant="ghost" disabled={discovering || busy} onClick={() => void discover()}><RefreshCw className={discovering ? 'animate-spin' : undefined} />重新发现</Button></div>
      {discovering && <p className="muted" role="status">正在查找本机已登录的账号…</p>}
      {discoveryError && <p className="danger-text" role="alert">{discoveryError}</p>}
      {!discovering && !discoveryError && !accounts.length && <p className="muted">没有找到已登录账号。选择下方服务登录或填写 Key。</p>}
      {accounts.map(account => <section className="panel row spread" key={account.id}>
        <div className="stack min-w-0"><strong className="row"><BrandIcon product={PROVIDERS.find(p => p.id === account.providerId)?.name ?? account.providerId} />{account.alias}</strong><span className="muted break-words">{PROVIDERS.find(p => p.id === account.providerId)?.name ?? account.providerId}{account.organization ? ` · ${account.organization}` : ''} · {account.source}</span></div>
        <Button disabled={busy || !!login || added.has(account.id)} onClick={() => void add({ candidateId: account.id })}>{added.has(account.id) ? '已加入' : '加入'}</Button>
      </section>)}
      {warnings.map((warning, i) => <p className="muted" key={i}>{warning}</p>)}
      <h3>添加其他账号</h3>
      <div className="row" role="group" aria-label="选择服务">
        {PROVIDERS.map(provider => <Button key={provider.id} variant={providerId === provider.id ? 'default' : 'outline'} disabled={busy} aria-pressed={providerId === provider.id} onClick={() => { generation.current++; setProviderId(provider.id); setSecret(''); setLogin(null); setError(''); }}><BrandIcon product={provider.name} />{provider.name}</Button>)}
      </div>
      {selected?.mode === 'api_key' && <form className="stack" onSubmit={e => { e.preventDefault(); if (secret.trim()) void add({ providerId, secret: secret.trim() }); }}>
        <Field><FieldLabel htmlFor="account-key">{selected.name} API Key</FieldLabel><Input id="account-key" type="password" autoComplete="off" spellCheck={false} disabled={busy} value={secret} onChange={e => setSecret(e.target.value)} /></Field>
        <Button type="submit" disabled={busy || !secret.trim()}>{busy ? '正在加入…' : '加入'}</Button>
      </form>}
      {selected?.mode === 'device' && !login && <Button disabled={busy || !client.startAccountLogin} onClick={() => void startLogin()}>{busy ? '正在准备登录…' : `登录 ${selected.name}`}</Button>}
      {selected?.mode === 'external' && <section className="panel stack"><strong>在 Claude Code 中登录</strong><p>打开终端，运行 <code>claude</code>，输入 <code>/login</code>，按提示在浏览器完成登录。</p><p className="muted">完成后，这里会自动找到账号；点击账号旁的“加入”即可。</p></section>}
      {login && <section className="panel stack"><p>打开登录页面，输入以下登录码：</p><strong className="text-xl select-all" aria-label="登录码">{login.userCode}</strong><Button onClick={() => void openLogin()}><ExternalLink />打开登录页面</Button><p className="muted" role="status">正在等待登录，完成后会自动加入订阅。</p><Button variant="ghost" onClick={() => setLogin(null)}>取消等待</Button></section>}
      {error && <p role="alert" className="danger-text">{error}</p>}
      {onManual && <Button variant="ghost" disabled={busy} onClick={onManual}><Plus />手动记录其他订阅</Button>}
    </div>
  </Modal>;
}
