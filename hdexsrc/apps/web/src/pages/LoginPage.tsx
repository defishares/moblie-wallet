import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';

type LoginType = 'account' | 'mnemonic' | 'privateKey';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { error: nodeError } = useChain();
  const { login } = useAuth();
  const registeredName = (location.state as { registered?: string } | null)?.registered || '';
  const [loginType, setLoginType] = useState<LoginType>('account');
  const [accountName, setAccountName] = useState(registeredName);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(accountName, password);
      setPassword('');
      navigate(destination, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const errorMessage = error || (!error && nodeError ? `节点连接异常：${nodeError}` : '');
  return (
    <main className="auth-page rn-login-page">
      <h1 className="rn-login-title">钱包登录</h1>
      <nav className="rn-login-tabs" aria-label="登录方式">
        <button type="button" className={loginType === 'account' ? 'active' : ''} onClick={() => setLoginType('account')}>账户名登录</button>
        <button type="button" className={loginType === 'mnemonic' ? 'active' : ''} onClick={() => setLoginType('mnemonic')}>助记词登录</button>
        <button type="button" className={loginType === 'privateKey' ? 'active' : ''} onClick={() => setLoginType('privateKey')}>私钥登录</button>
      </nav>
      {loginType === 'account' ? <form onSubmit={submit} className="rn-login-form">
        {errorMessage && <div className="rn-login-error" role="alert"><span aria-hidden="true">ⓘ</span>{errorMessage}</div>}
        <label htmlFor="account-name">账户</label>
        <div className="rn-login-input-wrap"><input id="account-name" value={accountName} onChange={event => { setAccountName(event.target.value); setError(''); }} autoComplete="username" autoCapitalize="none" autoCorrect="off" placeholder="请输入账户名" disabled={busy} /></div>
        <label htmlFor="account-password">密码</label>
        <div className="rn-login-input-wrap"><input id="account-password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => { setPassword(event.target.value); setError(''); }} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" placeholder="请输入密码" disabled={busy} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? '◉' : '◌'}</button></div>
        <p className="rn-login-hint">密码用于验证账户身份，登录后需要设置PIN码保护私钥</p>
        <button className="rn-login-submit" type="submit" disabled={busy || !accountName.trim() || !password}>{busy ? '验证中…' : '登录'}</button>
      </form> : <div className="rn-login-placeholder"><span aria-hidden="true">♙</span><strong>后续开放</strong><small>敬请期待</small></div>}
      <div className="rn-login-divider" />
      <Link className="rn-login-create" to="/register">创建账户</Link>
    </main>
  );
}
