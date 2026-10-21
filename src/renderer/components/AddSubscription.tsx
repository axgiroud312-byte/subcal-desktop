import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, ExternalLink } from 'lucide-react';
import type { SubCalClient } from '../../shared/types';
import type { Notify } from '../contracts';
import { BrandIcon, Modal } from './ui';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel } from './ui/field';
import { PROVIDERS } from '../service/account-providers';
import { SERVICE_ACCESS } from '../../shared/service-access';
import { FormSelect } from './form-controls';
import { canStartAccountLogin } from '../../shared/login-providers';

type Candidate = { id: string; providerId: string; alias: string; source: string; organization?: string };
type Login = { id: string; userCode: string; verificationUri: string; intervalSeconds: number; expiresAt: number; instructions?: string; requiresCode?: boolean };

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
  const [remoteUrl, setRemoteUrl] = useState('');
  const [accessKeyId,setAccessKeyId]=useState('');
  const [teamId,setTeamId]=useState('');
  const [relayTemplate, setRelayTemplate] = useState('new-api-key');
  const [relayUserId, setRelayUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<Login | null>(null);
  const [loginCode, setLoginCode] = useState('');
  const activeLogin = useRef<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const alive = useRef(true);
  const discoveringRef = useRef(false);
  const actionRef = useRef(false);
  const generation = useRef(0);
  const callbacks = useRef({ onAdded, onClose, notify });
  callbacks.current = { onAdded, onClose, notify };
  const selected = PROVIDERS.find(p => p.id === providerId);
  const cloud=SERVICE_ACCESS.find(p=>p.id===providerId)?.cloudRegion;
  const supportsLogin = canStartAccountLogin(providerId);
  const cancelLogin = () => {
    const id = activeLogin.current; activeLogin.current = null;
    if(id)void client.cancelAccountLogin?.(id).catch(()=>{});
    setLogin(null);setLoginCode('');
  };

  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; const id=activeLogin.current;activeLogin.current=null;if(id)void client.cancelAccountLogin?.(id).catch(()=>{}); }; }, [client]);
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
        if (Date.now() >= login.expiresAt) throw new Error('登录已过期，请重新登录。');
        if (!client.pollAccountLogin) throw new Error('登录服务不可用，请重新打开桌面应用。');
        const result = await client.pollAccountLogin(login.id);
        if (cancelled) return;
        if (result.status === 'expired') throw new Error('登录已过期或取消，请重新登录。');
        if (result.status === 'complete') {
          if (!result.subscriptionId || !result.connectionId) throw new Error('登录已完成，但尚未返回订阅，请重新发现账号后加入。');
          cancelLogin(); callbacks.current.notify('账号已加入，订阅卡片已生成');
          callbacks.current.onAdded(result.subscriptionId, result.connectionId); callbacks.current.onClose();
          return;
        }
        timer = window.setTimeout(poll, Math.max(1, login.intervalSeconds) * 1000);
      } catch (e) { if (!cancelled) { setError((e as Error).message); cancelLogin(); } }
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
      if (alive.current && request === generation.current) {
        activeLogin.current=result.id;setLogin(result);setLoginCode('');
        if(window.subcal?.openExternal)await window.subcal.openExternal(result.verificationUri);
      } else { await client.cancelAccountLogin?.(result.id); }
    } catch (e) { if (alive.current && request === generation.current) setError((e as Error).message); }
    finally { actionRef.current = false; if (alive.current) setBusy(false); }
  };
  const openLogin = async () => {
    try {
      if (!login || !window.subcal?.openExternal) throw new Error('请在桌面应用中打开登录页面。');
      await window.subcal.openExternal(login.verificationUri);
    } catch (e) { setError((e as Error).message); }
  };

  return <Modal title="添加账号" onClose={onClose}>
    <div className="stack">
      <p className="muted">加入后自动识别套餐、额度窗口和余额。日期以服务提供为准；你只需按需记录实际支付金额。</p>
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
      <Field><FieldLabel htmlFor="account-service">选择服务</FieldLabel><FormSelect id="account-service" value={providerId} disabled={busy} onChange={e => { generation.current++; cancelLogin();setProviderId(e.target.value); setSecret('');setError(''); }}><option value="">请选择服务</option>{PROVIDERS.map(provider=><option value={provider.id} key={provider.id}>{provider.name}</option>)}</FormSelect></Field>
      {supportsLogin && !login && <Button disabled={busy || !client.startAccountLogin} onClick={() => void startLogin()}><ExternalLink />{busy ? '正在打开登录…' : `登录 ${selected?.name}`}</Button>}
      {selected?.mode === 'api_key' && <form className="stack" onSubmit={e => { e.preventDefault(); if (secret.trim()) void add({ providerId, secret: cloud?JSON.stringify({accessKeyId,secretAccessKey:secret,teamId}):providerId==='relay-wallet'?JSON.stringify({origin:remoteUrl.trim(),apiKey:secret.trim(),template:relayTemplate,userId:relayUserId}):providerId==='remote-magpie'?JSON.stringify({origin:remoteUrl.trim(),apiKey:secret.trim()}):secret.trim() }); }}>
        {cloud&&<><Field><FieldLabel htmlFor="cloud-access-id">AccessKeyId / SecretId</FieldLabel><Input id="cloud-access-id" required autoComplete="off" value={accessKeyId} onChange={e=>setAccessKeyId(e.target.value)}/></Field>{providerId.startsWith('tencent-')&&<Field><FieldLabel htmlFor="cloud-team">团队 ID（可选）</FieldLabel><Input id="cloud-team" value={teamId} onChange={e=>setTeamId(e.target.value)} placeholder="留空自动识别团队，分别建卡" /></Field>}</>}
        {(providerId==='remote-magpie'||providerId==='relay-wallet') && <Field><FieldLabel htmlFor="remote-url">确认远端 HTTPS 站点</FieldLabel><Input id="remote-url" type="url" required value={remoteUrl} onChange={e=>setRemoteUrl(e.target.value)} placeholder="https://panel.example.com" /></Field>}
        {providerId==='relay-wallet' && <><Field><FieldLabel htmlFor="relay-template">站点面板类型</FieldLabel><FormSelect id="relay-template" value={relayTemplate} onChange={e=>setRelayTemplate(e.target.value)}><option value="new-api-key">New API · Key 预算</option><option value="new-api-account">New API · 账号余额</option><option value="one-api-key">One API · Key 预算</option><option value="sub2api-key">Sub2API · Key 预算</option><option value="sub2api-account">Sub2API · 账号余额</option><option value="credit-grants">兼容 credit-grants · 余额</option></FormSelect></Field>{relayTemplate==='new-api-account'&&<Field><FieldLabel htmlFor="relay-user">面板用户 ID</FieldLabel><Input id="relay-user" required pattern="[0-9]+" value={relayUserId} onChange={e=>setRelayUserId(e.target.value)} /></Field>}<p className="muted">账号余额需要面板访问令牌；模型 API Key 仅用于 Key 预算。仅向上述站点发送凭据，不自动尝试其他协议。</p></>}
        {SERVICE_ACCESS.find(p=>p.id===providerId)?.instruction && <p className="muted">{SERVICE_ACCESS.find(p=>p.id===providerId)?.instruction}</p>}
        <Field><FieldLabel htmlFor="account-key">{cloud?'SecretAccessKey / SecretKey':`${selected.name} API Key`}</FieldLabel><Input id="account-key" type="password" autoComplete="off" spellCheck={false} disabled={busy} value={secret} onChange={e => setSecret(e.target.value)} /></Field>
        <Button type="submit" disabled={busy || !secret.trim()}>{busy ? '正在加入…' : '加入'}</Button>
      </form>}
      {selected?.mode === 'external' && !supportsLogin && <section className="panel stack"><strong>{selected.name} 登录接入尚未完成</strong><p>当前仅能加入上方已发现账号，尚不能在本应用发起此服务的登录。</p></section>}
      {login && <section className="panel stack"><p>{login.userCode ? '在打开的授权页面输入以下登录码：' : '请在打开的浏览器页面完成登录。'}</p>{login.userCode && <strong className="text-xl select-all" aria-label="登录码">{login.userCode}</strong>}{login.instructions&&<p className="muted">{login.instructions}</p>}<Button onClick={() => void openLogin()}><ExternalLink />重新打开登录页面</Button>{login.requiresCode&&<form className="stack" onSubmit={async e=>{e.preventDefault();try{if(!client.submitAccountLogin)throw new Error('此客户端不支持提交授权码');await client.submitAccountLogin(login.id,loginCode.trim());setLoginCode('');}catch(error){setError((error as Error).message);}}}><Field><FieldLabel htmlFor="login-code">授权页面返回的验证码或回调地址</FieldLabel><Input id="login-code" autoComplete="off" value={loginCode} onChange={e=>setLoginCode(e.target.value)} /></Field><Button type="submit" disabled={!loginCode.trim()}>完成授权</Button></form>}<p className="muted" role="status">正在等待授权，完成后自动保存账号、建卡并读取权益。</p><Button variant="ghost" onClick={cancelLogin}>取消登录</Button></section>}
      {error && <p role="alert" className="danger-text">{error}</p>}
      {onManual && <Button variant="ghost" disabled={busy} onClick={onManual}><Plus />手动记录其他订阅</Button>}
    </div>
  </Modal>;
}
