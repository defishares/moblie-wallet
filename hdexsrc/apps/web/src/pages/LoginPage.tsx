import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';

type LoginType = 'account' | 'mnemonic' | 'privateKey';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { error: nodeError } = useChain();
  const { login, biometricLogin, setupBiometricVault, hasBiometricVault, biometricSupported, isAuthenticated, sessionHydrated } = useAuth();
  const registeredName = (location.state as { registered?: string } | null)?.registered || '';
  const [loginType, setLoginType] = useState<LoginType>('account');
  const [accountName, setAccountName] = useState(registeredName);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deviceError, setDeviceError] = useState('');
  const [vaultAvailable, setVaultAvailable] = useState(false);
  const [checkingVault, setCheckingVault] = useState(false);
  const [pendingSession, setPendingSession] = useState<Awaited<ReturnType<typeof login>> | null>(null);
  const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';
  const continueAfterLogin = () => navigate(destination, { replace: true });

  useEffect(() => {
    if (sessionHydrated && isAuthenticated && !pendingSession) continueAfterLogin();
  }, [isAuthenticated, pendingSession, sessionHydrated]);

  useEffect(() => {
    let cancelled = false;
    if (!biometricSupported || !accountName.trim()) {
      setVaultAvailable(false);
      setCheckingVault(false);
      return () => { cancelled = true; };
    }
    setCheckingVault(true);
    void hasBiometricVault(accountName).then(available => {
      if (!cancelled) setVaultAvailable(available);
    }).catch(() => {
      if (!cancelled) setVaultAvailable(false);
    }).finally(() => {
      if (!cancelled) setCheckingVault(false);
    });
    return () => { cancelled = true; };
  }, [accountName, biometricSupported, hasBiometricVault]);

  const readableDeviceError = (cause: unknown) => {
    if (cause instanceof DOMException && cause.name === 'NotAllowedError') return '设备验证已取消，可继续使用账户密码登录';
    return cause instanceof Error ? cause.message : '设备验证失败，可继续使用账户密码登录';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const nextSession = await login(accountName, password);
      setPassword('');
      if (biometricSupported && !(await hasBiometricVault(nextSession.account.name))) {
        setPendingSession(nextSession);
      } else {
        continueAfterLogin();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const unlockWithDevice = async () => {
    setBusy(true);
    setError('');
    setDeviceError('');
    try {
      await biometricLogin(accountName);
      continueAfterLogin();
    } catch (cause) {
      setDeviceError(readableDeviceError(cause));
    } finally {
      setBusy(false);
    }
  };

  const enableDeviceUnlock = async () => {
    if (!pendingSession) return;
    setBusy(true);
    setDeviceError('');
    try {
      await setupBiometricVault(pendingSession);
      setPendingSession(null);
      continueAfterLogin();
    } catch (cause) {
      setDeviceError(readableDeviceError(cause));
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
        <p className="rn-login-hint">首次登录后可启用设备验证保护本地私钥；账户密码始终可作为恢复方式</p>
        <button className="rn-login-submit" type="submit" disabled={busy || !accountName.trim() || !password}>{busy ? '验证中…' : '登录'}</button>
        {biometricSupported && vaultAvailable && <button className="rn-login-device" type="button" onClick={() => void unlockWithDevice()} disabled={busy || checkingVault}>{busy ? '验证中…' : '使用设备验证登录'}</button>}
        {deviceError && <p className="rn-login-device-error" role="alert">{deviceError}</p>}
      </form> : <div className="rn-login-placeholder"><span aria-hidden="true">♙</span><strong>后续开放</strong><small>敬请期待</small></div>}
      <div className="rn-login-divider" />
      <Link className="rn-login-create" to="/register">创建账户</Link>

      {pendingSession && <div className="rn-login-modal-backdrop" role="presentation">
        <section className="rn-login-modal" role="dialog" aria-modal="true" aria-labelledby="device-unlock-title">
          <div className="rn-login-modal-icon" aria-hidden="true">⌁</div>
          <h2 id="device-unlock-title">启用设备验证</h2>
          <p>使用本机的指纹、面容或系统设备验证保护私钥。私钥只会以加密密文保存于本设备，不会上传服务器。</p>
          {deviceError && <div className="rn-login-device-error" role="alert">{deviceError}</div>}
          <button className="rn-login-submit" type="button" onClick={() => void enableDeviceUnlock()} disabled={busy}>{busy ? '等待设备验证…' : '启用设备验证'}</button>
          <button className="rn-login-modal-skip" type="button" onClick={() => { setPendingSession(null); continueAfterLogin(); }} disabled={busy}>暂时跳过，使用密码登录</button>
        </section>
      </div>}
    </main>
  );
}
