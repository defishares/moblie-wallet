import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { validatePin } from '../auth/pinVault';
import { SecurityShieldIcon } from '../components/AppIcons';

type LoginType = 'account' | 'mnemonic' | 'privateKey';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { error: nodeError } = useChain();
  const { login, biometricLogin, pinLogin, setupBiometricVault, setupPinVault, hasBiometricVault, hasPinVault, biometricSupported, pinSupported, isAuthenticated, sessionHydrated, lastAccountName } = useAuth();
  const registeredName = (location.state as { registered?: string } | null)?.registered || '';
  const [loginType, setLoginType] = useState<LoginType>('account');
  const [accountName, setAccountName] = useState(registeredName);
  const rememberedAccountApplied = useRef(Boolean(registeredName));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deviceError, setDeviceError] = useState('');
  const [vaultAvailable, setVaultAvailable] = useState(false);
  const [pinVaultAvailable, setPinVaultAvailable] = useState(false);
  const [checkingVault, setCheckingVault] = useState(false);
  const [pendingSession, setPendingSession] = useState<Awaited<ReturnType<typeof login>> | null>(null);
  const [pendingPinSession, setPendingPinSession] = useState<Awaited<ReturnType<typeof login>> | null>(null);
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';
  const continueAfterLogin = () => navigate(destination, { replace: true });

  useEffect(() => {
    // Password login first updates AuthProvider's in-memory identity, then
    // checks whether this account has a vault. Do not let this restore
    // redirect race that check and unmount the page before the Passkey setup
    // prompt can be shown.
    if (sessionHydrated && isAuthenticated && !pendingSession && !pendingPinSession && !busy) continueAfterLogin();
  }, [busy, isAuthenticated, pendingPinSession, pendingSession, sessionHydrated]);

  useEffect(() => {
    // Restore the previous account only once on initial hydration. Applying
    // this whenever the field becomes empty made it impossible to switch
    // accounts by deleting the last character.
    if (!sessionHydrated || rememberedAccountApplied.current) return;
    if (!accountName && lastAccountName) {
      rememberedAccountApplied.current = true;
      setAccountName(lastAccountName);
    }
  }, [accountName, lastAccountName, sessionHydrated]);

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

  useEffect(() => {
    let cancelled = false;
    if (!pinSupported || !accountName.trim()) {
      setPinVaultAvailable(false);
      return () => { cancelled = true; };
    }
    void hasPinVault(accountName).then(available => {
      if (!cancelled) setPinVaultAvailable(available);
    }).catch(() => {
      if (!cancelled) setPinVaultAvailable(false);
    });
    return () => { cancelled = true; };
  }, [accountName, hasPinVault, pinSupported]);

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
      } else if (!biometricSupported && pinSupported && !(await hasPinVault(nextSession.account.name))) {
        setPinError('');
        setPinDraft('');
        setPinConfirm('');
        setPendingPinSession(nextSession);
      } else if (!biometricSupported && !pinSupported) {
        throw new Error('当前设备不支持 Passkey 或本地安全加密，无法安全保存私钥');
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

  const enablePinUnlock = async () => {
    if (!pendingPinSession) return;
    const validationError = validatePin(pinDraft);
    if (validationError) { setPinError(validationError); return; }
    if (pinDraft !== pinConfirm) { setPinError('两次输入的 PIN 不一致'); return; }
    setBusy(true);
    setPinError('');
    try {
      await setupPinVault(pinDraft, pendingPinSession);
      setPendingPinSession(null);
      setPinDraft('');
      setPinConfirm('');
      continueAfterLogin();
    } catch (cause) {
      setPinError(cause instanceof Error ? cause.message : 'PIN 设置失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const unlockWithPin = async () => {
    const pin = window.prompt('请输入本地 PIN 以登录');
    if (pin == null) return;
    setBusy(true);
    setDeviceError('');
    try {
      await pinLogin(accountName, pin);
      continueAfterLogin();
    } catch (cause) {
      setDeviceError(cause instanceof Error ? cause.message : 'PIN 验证失败');
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
        {registeredName && <div className="rn-login-success" role="status"><span aria-hidden="true">✓</span><span>账户 <b>{registeredName}</b> 已创建，请使用安全密码登录</span></div>}
        {errorMessage && <div className="rn-login-error" role="alert"><span aria-hidden="true">ⓘ</span>{errorMessage}</div>}
        <label htmlFor="account-name">账户</label>
        <div className="rn-login-input-wrap"><input id="account-name" value={accountName} onChange={event => { rememberedAccountApplied.current = true; setAccountName(event.target.value); setError(''); }} autoComplete="username" autoCapitalize="none" autoCorrect="off" placeholder="请输入账户名" disabled={busy} /></div>
        <label htmlFor="account-password">密码</label>
        <div className="rn-login-input-wrap"><input id="account-password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => { setPassword(event.target.value); setError(''); }} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" placeholder="请输入密码" disabled={busy} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? '◉' : '◌'}</button></div>
        <p className="rn-login-hint">首次登录后可启用设备验证保护本地私钥；账户密码始终可作为恢复方式</p>
        <button className="rn-login-submit" type="submit" disabled={busy || !accountName.trim() || !password}>{busy ? '验证中…' : '登录'}</button>
        {biometricSupported && vaultAvailable && <button className="rn-login-device" type="button" onClick={() => void unlockWithDevice()} disabled={busy || checkingVault}>{busy ? '验证中…' : '使用设备验证登录'}</button>}
        {!biometricSupported && pinVaultAvailable && <button className="rn-login-device" type="button" onClick={() => void unlockWithPin()} disabled={busy || checkingVault}>{busy ? '验证中…' : '使用 PIN 登录'}</button>}
        {deviceError && <p className="rn-login-device-error" role="alert">{deviceError}</p>}
      </form> : <div className="rn-login-placeholder"><span aria-hidden="true">♙</span><strong>后续开放</strong><small>敬请期待</small></div>}
      <div className="rn-login-divider" />
      <Link className="rn-login-create" to="/register">创建账户</Link>

      {pendingSession && <div className="rn-login-modal-backdrop" role="presentation">
        <section className="rn-login-modal" role="dialog" aria-modal="true" aria-labelledby="device-unlock-title">
          <div className="rn-login-modal-icon security" aria-hidden="true"><SecurityShieldIcon /></div>
          <h2 id="device-unlock-title">启用设备验证</h2>
          <p>使用本机的指纹、面容或系统设备验证保护私钥。私钥只会以加密密文保存于本设备，不会上传服务器。</p>
          {deviceError && <div className="rn-login-device-error" role="alert">{deviceError}</div>}
          <button className="rn-login-submit" type="button" onClick={() => void enableDeviceUnlock()} disabled={busy}>{busy ? '等待设备验证…' : '启用设备验证'}</button>
          {pinSupported && <button className="rn-login-modal-skip" type="button" onClick={() => { setPendingPinSession(pendingSession); setPendingSession(null); setDeviceError(''); }} disabled={busy}>改用 PIN 保护本地私钥</button>}
          <button className="rn-login-modal-skip" type="button" onClick={() => { setPendingSession(null); continueAfterLogin(); }} disabled={busy}>暂时跳过，使用密码登录</button>
        </section>
      </div>}

      {pendingPinSession && <div className="rn-login-modal-backdrop" role="presentation">
        <section className="rn-login-modal" role="dialog" aria-modal="true" aria-labelledby="pin-unlock-title">
          <div className="rn-login-modal-icon security" aria-hidden="true"><SecurityShieldIcon /></div>
          <h2 id="pin-unlock-title">设置本地 PIN</h2>
          <p>当前设备不支持 Passkey，必须设置 PIN 才能保护本地私钥。PIN 必须为 10 位，并包含大写字母、小写字母和特殊字符。</p>
          <label className="rn-login-pin-label" htmlFor="login-pin">PIN</label>
          <input id="login-pin" className="rn-login-pin-input" type="password" value={pinDraft} onChange={event => { setPinDraft(event.target.value); setPinError(''); }} autoComplete="new-password" disabled={busy} />
          <label className="rn-login-pin-label" htmlFor="login-pin-confirm">确认 PIN</label>
          <input id="login-pin-confirm" className="rn-login-pin-input" type="password" value={pinConfirm} onChange={event => { setPinConfirm(event.target.value); setPinError(''); }} autoComplete="new-password" disabled={busy} />
          {pinError && <div className="rn-login-device-error" role="alert">{pinError}</div>}
          <button className="rn-login-submit" type="button" onClick={() => void enablePinUnlock()} disabled={busy}>{busy ? '保存中…' : '保存 PIN 并继续'}</button>
        </section>
      </div>}
    </main>
  );
}
