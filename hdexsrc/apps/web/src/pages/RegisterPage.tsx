import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PrivateKey } from 'bitsharesjs';
import * as BitsharesWs from 'bitsharesjs-ws';
import { useChain } from '../state/ChainProvider';
import { SuccessCheckIcon } from '../components/AppIcons';

const FAUCET_URL = 'https://api.defishares.org/faucet/api/v1/accounts';
const PREFIX = 'DFS';
const passwordChars = {
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lowercase: 'abcdefghjkmnpqrstuvwxyz',
  numbers: '23456789',
  symbols: '!@#$%&*+-=?',
};
const rules = [
  ['chars', '由字母、数字或短横线组成', (value: string) => value.length > 0 && /^[a-z0-9-]+$/.test(value)],
  ['start', '必须以字母开头', (value: string) => /^[a-z]/.test(value)],
  ['end', '必须以字母或数字结尾', (value: string) => /[a-z0-9]$/.test(value)],
  ['number', '必须包含数字', (value: string) => /[0-9]/.test(value)],
  ['length', '长度3到32个字符', (value: string) => value.length >= 3 && value.length <= 32],
] as const;

function calculateRefcode(accountId: string) {
  const lastPart = accountId.split('.').pop() || '';
  if (!lastPart) return '';
  return btoa(lastPart).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePassword() {
  const allChars = Object.values(passwordChars).join('');
  const values = new Uint32Array(32);
  crypto.getRandomValues(values);
  const pick = (chars: string, index: number) => chars[values[index] % chars.length];
  const password = [
    pick(passwordChars.uppercase, 0),
    pick(passwordChars.lowercase, 1),
    pick(passwordChars.numbers, 2),
    pick(passwordChars.symbols, 3),
    ...Array.from(values.slice(4), value => allChars[value % allChars.length]),
  ];
  return password.sort(() => Math.random() - 0.5).join('');
}

function keyFor(name: string, password: string, role: 'owner' | 'active' | 'memo') {
  return PrivateKey.fromSeed(`${name}${role}${password}`);
}

function publicKey(key: ReturnType<typeof keyFor>) { return key.toPublicKey().toString(); }

export function RegisterPage() {
  const navigate = useNavigate();
  const { client, status } = useChain();
  const [name, setName] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [referrer, setReferrer] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [registeredAccount, setRegisteredAccount] = useState('');
  const results = useMemo(() => rules.map(([, label, check]) => ({ label, passed: check(name) })), [name]);
  const valid = results.every(item => item.passed);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    if (!agreed) { setError('请阅读并同意用户协议和隐私政策'); return; }
    if (!valid) { setError('账户名格式不正确，请检查上方规则'); return; }
    if (status !== 'connected') { setError('节点尚未连接，请稍后重试'); return; }
    setBusy(true); setError('');
    try {
      const normalized = name.trim().toLowerCase();
      const existing = await client.getFullAccounts([normalized]);
      if (existing[0]?.[1]?.account) throw new Error('账户名已存在');
      const wsModule = BitsharesWs as unknown as { ChainConfig?: { setPrefix(prefix: string): void }; default?: { ChainConfig?: { setPrefix(prefix: string): void } } };
      (wsModule.ChainConfig ?? wsModule.default?.ChainConfig)?.setPrefix(PREFIX);
      const owner = keyFor(normalized, password, 'owner');
      const active = keyFor(normalized, password, 'active');
      const memo = keyFor(normalized, password, 'memo');
      let refcode: string | null = null;
      const referrerName = referrer.trim().toLowerCase();
      if (referrerName) {
        const referrerAccount = await client.getFullAccounts([referrerName]);
        const referrerId = referrerAccount[0]?.[1]?.account?.id;
        if (referrerId) refcode = calculateRefcode(referrerId);
      }
      const response = await fetch(FAUCET_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: { name: normalized, owner_key: publicKey(owner), active_key: publicKey(active), memo_key: publicKey(memo), refcode, referrer: 'dfs-faucet' } }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.error) throw new Error(payload?.error?.base?.[0] || '注册失败，请稍后重试');
      let visible = false;
      for (let attempt = 0; attempt < 4 && !visible; attempt += 1) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 500));
        visible = Boolean((await client.getFullAccounts([normalized]))[0]?.[1]?.account);
      }
      // Keep the success state on this screen so the user can clearly see
      // that the account was created and copy/record the generated password.
      // The account can still be opened in the login screen explicitly.
      setRegisteredAccount(normalized);
      if (!visible) setError('账户已提交创建，链上同步可能需要几秒钟');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '注册失败，请重试'); }
    finally { setBusy(false); }
  }

  return <main className="auth-page rn-register-page"><header className="rn-register-header"><Link to="/login" aria-label="返回登录">‹</Link><h1>创建账户</h1><span /></header><form className="rn-register-form" onSubmit={register}>{error && <div className="rn-register-error" role="alert"><span aria-hidden="true">ⓘ</span>{error}</div>}<label>账号<input value={name} onChange={event => { setName(event.target.value.toLowerCase()); setError(''); }} placeholder="请输入账户名" autoCapitalize="none" autoCorrect="off" disabled={busy}/></label><div className="rn-register-rules">{results.map(item => <span className={item.passed ? 'passed' : ''} key={item.label}><i aria-hidden="true">{item.passed ? '✓' : ''}</i>{item.label}</span>)}</div><div className="rn-register-password-group"><div className="rn-register-password-head"><span>安全密码</span><button type="button" onClick={() => setPassword(generatePassword())} disabled={busy}>↻ <b>刷新</b></button></div><div className="rn-generated-password"><textarea value={password} readOnly aria-label="安全密码"/><button className="rn-password-copy" type="button" onClick={() => { void navigator.clipboard?.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1600); }} disabled={busy} aria-label="复制安全密码">{copied ? '✓' : '▣'}</button></div><p className="rn-register-warning">⚠ 请妥善保存此密码！密码丢失将无法找回账户！</p></div><label>推荐人账号（可选）<input value={referrer} onChange={event => setReferrer(event.target.value.toLowerCase())} placeholder="请输入推荐人账号" autoCapitalize="none" autoCorrect="off" disabled={busy}/></label><label className="rn-terms"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)}/><span>我已阅读并同意<Link to="/webview?title=%E7%94%A8%E6%88%B7%E5%8D%8F%E8%AE%AE&url=https%3A%2F%2Fdefishares.org">《用户协议》</Link>和<Link to="/webview?title=%E9%9A%90%E7%A7%81%E6%94%BF%E7%AD%96&url=https%3A%2F%2Fdefishares.org">《隐私政策》</Link></span></label><button className="primary-button auth-submit" type="submit" disabled={busy || !valid || !agreed || status !== 'connected'}>{busy ? '注册中…' : '注册'}</button><Link className="rn-register-login" to="/login">已有账户？<b>立即登录</b></Link></form>{registeredAccount && <div className="rn-register-success-backdrop" role="presentation"><section className="rn-register-success" role="dialog" aria-modal="true" aria-labelledby="register-success-title"><div className="rn-register-success-icon"><SuccessCheckIcon /></div><h2 id="register-success-title">账户创建成功</h2><p>账户 <b>{registeredAccount}</b> 已成功创建。</p><p className="rn-register-success-hint">请确认已保存安全密码。密码丢失后无法找回账户。</p><button type="button" onClick={() => navigate('/login', { replace: true, state: { registered: registeredAccount } })}>前往登录</button></section></div>}</main>;
}
