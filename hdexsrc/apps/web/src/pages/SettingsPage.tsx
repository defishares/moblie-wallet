import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RNScreenHeader } from '../components/RNScreenHeader';
import { webSocketNodes } from '../services/runtime';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { validatePin } from '../auth/pinVault';

type IconName = 'logout' | 'account' | 'server' | 'fingerprint' | 'clock' | 'trash' | 'info' | 'about' | 'copy' | 'plus' | 'close';

function SettingIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    logout: <><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><path d="m15 16 4-4-4-4M19 12H9"/></>,
    account: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 9v6M14 12h6"/></>,
    server: <><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/></>,
    fingerprint: <><path d="M6.8 9.7a5.4 5.4 0 0 1 10.4 2c0 3.3-.7 6-2.1 8.1"/><path d="M4.3 13.2a7.8 7.8 0 0 1 15.4-2.1M9.2 20c1.2-2.2 1.4-4.5 1.4-7.1a1.5 1.5 0 0 1 3 0c0 3.4-.4 6.2-1.5 8.1M6.5 17.8c.7-1.6.8-3.2.8-5"/></>,
    clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    about: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function SettingRow({ icon, title, subtitle, right, danger = false, onClick, to, disabled = false }: {
  icon: IconName;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  to?: string;
  disabled?: boolean;
}) {
  const content = <>
    <span className={`rn-settings-icon${icon === 'fingerprint' ? ' secure' : ''}`}><SettingIcon name={icon}/></span>
    <span className="rn-settings-copy"><strong className={danger ? 'danger' : ''}>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
    <span className="rn-settings-row-right">{right}{(onClick || to) && <b aria-hidden="true">›</b>}</span>
  </>;
  if (to) return <Link className="rn-settings-row" to={to}>{content}</Link>;
  return <button className="rn-settings-row" type="button" onClick={onClick} disabled={disabled}>{content}</button>;
}

function nodeLabel(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { connectedUrl, status, error, storage, customNodes, switchNode, addCustomNode, removeCustomNode } = useChain();
  const { session, logout, biometricSupported, pinSupported, hasBiometricVault, hasPinVault, setupBiometricVault, setupPinVault, removeBiometricVault, removePinVault, signingKeyTimeoutMinutes, setSigningKeyTimeoutMinutes } = useAuth();
  const [nodeSheetOpen, setNodeSheetOpen] = useState(false);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [nodeUrl, setNodeUrl] = useState('');
  const [busyNode, setBusyNode] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'logout' | 'delete' | 'cache' | 'vault' | 'pinVault' | null>(null);
  const [deviceVaultReady, setDeviceVaultReady] = useState(false);
  const [pinVaultReady, setPinVaultReady] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [timeoutSheetOpen, setTimeoutSheetOpen] = useState(false);
  const [timeoutDraft, setTimeoutDraft] = useState(String(signingKeyTimeoutMinutes));

  const officialNodes = useMemo(() => [...new Set(webSocketNodes)], []);
  const currentNodeName = connectedUrl ? nodeLabel(connectedUrl) : '未连接';
  const connectionText = status === 'connected'
    ? `已连接: ${connectedUrl}`
    : status === 'connecting' ? '正在连接节点…' : error || '节点连接异常';

  useEffect(() => {
    let cancelled = false;
    if (!session || !biometricSupported) {
      setDeviceVaultReady(false);
      return () => { cancelled = true; };
    }
    void hasBiometricVault(session.account.name).then(ready => {
      if (!cancelled) setDeviceVaultReady(ready);
    }).catch(() => {
      if (!cancelled) setDeviceVaultReady(false);
    });
    return () => { cancelled = true; };
  }, [biometricSupported, hasBiometricVault, session]);

  useEffect(() => {
    let cancelled = false;
    if (!session || !pinSupported) {
      setPinVaultReady(false);
      return () => { cancelled = true; };
    }
    void hasPinVault(session.account.name).then(ready => {
      if (!cancelled) setPinVaultReady(ready);
    }).catch(() => {
      if (!cancelled) setPinVaultReady(false);
    });
    return () => { cancelled = true; };
  }, [hasPinVault, pinSupported, session]);

  const showNotice = (text: string) => {
    setActionError('');
    setNotice(text);
    window.setTimeout(() => setNotice(current => current === text ? '' : current), 2600);
  };

  const selectNode = async (url: string) => {
    if (busyNode) return false;
    setBusyNode(url);
    setActionError('');
    try {
      await switchNode(url);
      showNotice(`已切换到节点: ${nodeLabel(url)}`);
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '节点连接失败，请重试');
      return false;
    } finally {
      setBusyNode(null);
    }
  };

  const chooseAutomaticNode = async () => {
    for (const url of officialNodes) {
      if (await selectNode(url)) return;
    }
  };

  const saveNode = async () => {
    const normalized = nodeUrl.trim();
    if (!/^wss?:\/\//i.test(normalized)) {
      setActionError('请输入以 ws:// 或 wss:// 开头的节点 URL');
      return;
    }
    setBusyNode(normalized);
    setActionError('');
    try {
      await addCustomNode(normalized);
      setNodeUrl('');
      setAddNodeOpen(false);
      showNotice('节点测试通过并已添加');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '节点连接失败，请重试');
    } finally {
      setBusyNode(null);
    }
  };

  const copyNode = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showNotice('链接已复制');
    } catch {
      setActionError('复制失败，请手动复制节点链接');
    }
  };

  const deleteNode = async (url: string) => {
    if (!window.confirm(`确定要删除节点“${nodeLabel(url)}”吗？`)) return;
    await removeCustomNode(url);
    showNotice('节点已删除');
  };

  const deviceErrorMessage = (cause: unknown) => {
    if (cause instanceof DOMException && cause.name === 'NotAllowedError') return '设备验证已取消';
    return cause instanceof Error ? cause.message : '设备验证失败，请重试';
  };

  const setupDeviceUnlock = async () => {
    if (!session || deviceBusy) return;
    setDeviceBusy(true);
    setActionError('');
    try {
      await setupBiometricVault(session);
      setDeviceVaultReady(true);
      showNotice('设备验证已启用，私钥已加密保存在本设备');
    } catch (cause) {
      setActionError(deviceErrorMessage(cause));
    } finally {
      setDeviceBusy(false);
    }
  };

  const openPinSetup = () => {
    setPinDraft('');
    setPinConfirm('');
    setPinError('');
    setPinSheetOpen(true);
  };

  const savePin = async () => {
    if (!session) return;
    const validationError = validatePin(pinDraft);
    if (validationError) { setPinError(validationError); return; }
    if (pinDraft !== pinConfirm) { setPinError('两次输入的 PIN 不一致'); return; }
    setDeviceBusy(true);
    setPinError('');
    try {
      await setupPinVault(pinDraft, session);
      setPinVaultReady(true);
      setPinSheetOpen(false);
      showNotice('PIN 已启用，私钥已加密保存在本设备');
    } catch (cause) {
      setPinError(cause instanceof Error ? cause.message : 'PIN 设置失败，请重试');
    } finally {
      setDeviceBusy(false);
    }
  };

  const openTimeoutSheet = () => {
    setTimeoutDraft(String(signingKeyTimeoutMinutes));
    setTimeoutSheetOpen(true);
  };

  const saveTimeout = async () => {
    const value = Number(timeoutDraft);
    if (!Number.isFinite(value)) {
      setActionError('请输入 5 到 600 之间的分钟数');
      return;
    }
    await setSigningKeyTimeoutMinutes(value);
    setTimeoutSheetOpen(false);
    showNotice(`签名验证有效期已设置为 ${Math.max(5, Math.min(600, Math.round(value)))} 分钟`);
  };

  const finishConfirm = async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === 'cache') {
      try {
        await storage.clear();
        showNotice('本地缓存已清除');
      } catch {
        setActionError('清除缓存失败，请重试');
      }
      return;
    }
    if (action === 'vault') {
      if (session) {
        await removeBiometricVault(session.account.id);
        setDeviceVaultReady(false);
        showNotice('设备验证已关闭，本地密钥密文已删除');
      }
      return;
    }
    if (action === 'pinVault') {
      if (session) {
        await removePinVault(session.account.id);
        setPinVaultReady(false);
        showNotice('PIN 已关闭，本地密钥密文已删除');
      }
      return;
    }
    if (action === 'logout' || action === 'delete') {
      if (action === 'delete' && session) await removeBiometricVault(session.account.id);
      logout();
      navigate('/login', { replace: true });
    }
  };

  const confirmCopy = confirmAction === 'logout'
    ? { title: '退出登录', body: '退出后可使用账户名和账户密码再次登录。', button: '退出登录' }
    : confirmAction === 'delete'
      ? { title: '注销账号', body: `将从本浏览器会话移除“${session?.account.name || ''}”及签名密钥。链上账号不会被删除。`, button: '继续注销' }
      : confirmAction === 'vault'
        ? { title: '关闭设备验证', body: '将删除本设备上的加密私钥密文。关闭后仍可使用账户密码登录，不会影响链上账户。', button: '关闭设备验证' }
        : confirmAction === 'pinVault'
          ? { title: '关闭 PIN 保护', body: '将删除本设备上的 PIN 加密私钥密文。关闭后需要重新登录并设置 PIN。', button: '关闭 PIN 保护' }
      : { title: '清除缓存', body: '确定要清除所有本地缓存数据吗？此操作不可恢复，但不会删除当前登录会话。', button: '确定' };

  return (
    <main className="rn-settings-page">
      <RNScreenHeader title="设置" backTo="/" />
      <div className="rn-settings-content">
        {session && <section className="rn-settings-section">
          <h2>账号</h2>
          <div className="rn-settings-list">
            <SettingRow icon="logout" title="退出登录" subtitle="结束当前登录，下次可重新登录" onClick={() => setConfirmAction('logout')} />
            <SettingRow icon="account" title="注销账号" subtitle="从此浏览器会话移除账号及签名密钥" danger onClick={() => setConfirmAction('delete')} />
          </div>
        </section>}

        <section className="rn-settings-section">
          <h2>应用设置</h2>
          <div className="rn-settings-list">
            <SettingRow icon="server" title="API接入点" subtitle={connectionText} right={<em className={status === 'connected' ? 'connected' : ''}>{currentNodeName}</em>} onClick={() => setNodeSheetOpen(true)} />
          </div>
        </section>

        {session && <section className="rn-settings-section">
          <h2>安全设置</h2>
          <div className="rn-settings-list">
            <SettingRow
              icon="fingerprint"
              title={biometricSupported ? '设备验证解锁' : 'PIN 解锁'}
              subtitle={biometricSupported
                ? deviceVaultReady ? '已启用：私钥以加密密文保存在本设备' : '使用指纹、面容或系统设备验证保护本地私钥'
                : pinSupported ? pinVaultReady ? '已启用：私钥以 PIN 加密保存在本设备' : '当前设备不支持 Passkey，请设置 PIN 保护本地私钥' : '当前设备不支持本地安全加密'}
              right={biometricSupported
                ? <span className={deviceVaultReady ? 'rn-settings-enabled' : 'rn-settings-unavailable'}>{deviceVaultReady ? '已启用' : '未启用'}</span>
                : <span className={pinVaultReady ? 'rn-settings-enabled' : 'rn-settings-unavailable'}>{pinSupported ? pinVaultReady ? '已启用' : '未设置' : '不支持'}</span>}
              onClick={biometricSupported
                ? deviceVaultReady ? () => setConfirmAction('vault') : () => void setupDeviceUnlock()
                : pinVaultReady ? () => setConfirmAction('pinVault') : openPinSetup}
              disabled={(!biometricSupported && !pinSupported) || deviceBusy}
            />
            <SettingRow
              icon="clock"
              title="签名验证有效期"
              subtitle="设备验证或 PIN 解锁成功后，在此时间内复用本次解锁"
              right={<span className="rn-settings-version">{signingKeyTimeoutMinutes} 分钟</span>}
              onClick={openTimeoutSheet}
            />
          </div>
        </section>}

        <section className="rn-settings-section">
          <h2>其他</h2>
          <div className="rn-settings-list">
            <SettingRow icon="trash" title="清除本地缓存" subtitle="清除所有本地存储的数据" onClick={() => setConfirmAction('cache')} />
            <SettingRow icon="info" title="版本号" right={<span className="rn-settings-version">v0.1.0 (Web)</span>} />
            <SettingRow icon="about" title="关于" to="/about" />
          </div>
        </section>
      </div>

      {(notice || actionError) && <div className={`rn-settings-toast${actionError ? ' error' : ''}`} role="status">{actionError || notice}</div>}

      {nodeSheetOpen && <div className="rn-settings-backdrop" role="presentation" onMouseDown={event => event.currentTarget === event.target && setNodeSheetOpen(false)}>
        <section className="rn-node-sheet" role="dialog" aria-modal="true" aria-label="API接入点">
          <header><h2>API接入点</h2><button type="button" onClick={() => setNodeSheetOpen(false)} aria-label="关闭"><SettingIcon name="close" /></button></header>
          <div className="rn-node-list">
            <h3>自动选择</h3>
            <button className="rn-node-row" type="button" onClick={() => void chooseAutomaticNode()} disabled={Boolean(busyNode)}>
              <span className="rn-node-radio"><i /></span><span><strong>自动选择节点</strong><small>启动时自动选择最快的可用节点</small></span><b>›</b>
            </button>
            <h3>官方节点</h3>
            {officialNodes.map(url => <div className={`rn-node-row${connectedUrl === url ? ' selected' : ''}`} key={url}>
              <button className="rn-node-main" type="button" onClick={() => void selectNode(url)} disabled={Boolean(busyNode)}>
                <span className="rn-node-radio">{busyNode === url ? <i className="loading" /> : <i />}</span>
                <span><strong>{nodeLabel(url)}</strong><small>{url}</small></span>
              </button>
              {connectedUrl === url && <em>已连接</em>}
              <button className="rn-node-icon" type="button" onClick={() => void copyNode(url)} aria-label="复制节点链接"><SettingIcon name="copy" /></button>
            </div>)}
            <h3>自定义节点</h3>
            {customNodes.length === 0 && <p className="rn-node-empty">暂无自定义节点</p>}
            {customNodes.map(url => <div className={`rn-node-row${connectedUrl === url ? ' selected' : ''}`} key={url}>
              <button className="rn-node-main" type="button" onClick={() => void selectNode(url)} disabled={Boolean(busyNode)}>
                <span className="rn-node-radio">{busyNode === url ? <i className="loading" /> : <i />}</span>
                <span><strong>{nodeLabel(url)} <mark>自定义</mark></strong><small>{url}</small></span>
              </button>
              {connectedUrl === url && <em>已连接</em>}
              <button className="rn-node-icon" type="button" onClick={() => void copyNode(url)} aria-label="复制节点链接"><SettingIcon name="copy" /></button>
              <button className="rn-node-delete" type="button" onClick={() => void deleteNode(url)}>删除</button>
            </div>)}
          </div>
          <button className="rn-node-add" type="button" onClick={() => { setAddNodeOpen(true); setActionError(''); }}><SettingIcon name="plus" />添加自定义节点</button>
        </section>
      </div>}

      {addNodeOpen && <div className="rn-settings-backdrop centered" role="presentation">
        <section className="rn-add-node-modal" role="dialog" aria-modal="true" aria-label="添加自定义节点">
          <header><h2>添加自定义节点</h2><button type="button" onClick={() => setAddNodeOpen(false)} aria-label="关闭"><SettingIcon name="close" /></button></header>
          <label>节点名称<input value={nodeUrl ? nodeLabel(nodeUrl) : ''} readOnly placeholder="根据 URL 自动识别" /></label>
          <label>节点 URL<input value={nodeUrl} onChange={event => { setNodeUrl(event.target.value); setActionError(''); }} placeholder="ws:// 或 wss://" inputMode="url" autoCapitalize="none" /></label>
          {actionError && <p className="rn-add-node-error">{actionError}</p>}
          <div className="rn-add-node-actions"><button type="button" onClick={() => setAddNodeOpen(false)}>取消</button><button type="button" disabled={Boolean(busyNode)} onClick={() => void saveNode()}>{busyNode ? '测试中…' : '测试并添加'}</button></div>
        </section>
      </div>}

      {timeoutSheetOpen && <div className="rn-settings-backdrop centered" role="presentation" onMouseDown={event => event.currentTarget === event.target && setTimeoutSheetOpen(false)}>
        <section className="rn-settings-duration-modal" role="dialog" aria-modal="true" aria-labelledby="signing-timeout-title">
          <header><h2 id="signing-timeout-title">签名验证有效期</h2><button type="button" onClick={() => setTimeoutSheetOpen(false)} aria-label="关闭"><SettingIcon name="close" /></button></header>
          <p>Passkey 验证成功后，超过此时间再次发起交易时需要重新验证。可设置 5–600 分钟。</p>
          <div className="rn-settings-duration-value"><input type="number" min="5" max="600" step="1" value={timeoutDraft} onChange={event => setTimeoutDraft(event.target.value)} aria-label="有效期分钟数" /><span>分钟</span></div>
          <input className="rn-settings-duration-range" type="range" min="5" max="600" step="1" value={Math.max(5, Math.min(600, Number(timeoutDraft) || 5))} onChange={event => setTimeoutDraft(event.target.value)} aria-label="调整有效期" />
          <div className="rn-settings-duration-scale"><span>5 分钟</span><span>600 分钟</span></div>
          <div className="rn-settings-duration-actions"><button type="button" onClick={() => setTimeoutSheetOpen(false)}>取消</button><button type="button" onClick={() => void saveTimeout()}>保存</button></div>
        </section>
      </div>}

      {pinSheetOpen && <div className="rn-settings-backdrop centered" role="presentation" onMouseDown={event => event.currentTarget === event.target && setPinSheetOpen(false)}>
        <section className="rn-settings-duration-modal" role="dialog" aria-modal="true" aria-labelledby="settings-pin-title">
          <header><h2 id="settings-pin-title">设置本地 PIN</h2><button type="button" onClick={() => setPinSheetOpen(false)} aria-label="关闭"><SettingIcon name="close" /></button></header>
          <p>PIN 必须为 10 位，并包含大写字母、小写字母和特殊字符。PIN 只用于解密本设备上的私钥。</p>
          <label className="rn-login-pin-label" htmlFor="settings-pin">PIN</label>
          <input id="settings-pin" className="rn-login-pin-input" type="password" value={pinDraft} onChange={event => { setPinDraft(event.target.value); setPinError(''); }} autoComplete="new-password" disabled={deviceBusy} />
          <label className="rn-login-pin-label" htmlFor="settings-pin-confirm">确认 PIN</label>
          <input id="settings-pin-confirm" className="rn-login-pin-input" type="password" value={pinConfirm} onChange={event => { setPinConfirm(event.target.value); setPinError(''); }} autoComplete="new-password" disabled={deviceBusy} />
          {pinError && <p className="rn-add-node-error">{pinError}</p>}
          <div className="rn-settings-duration-actions"><button type="button" onClick={() => setPinSheetOpen(false)}>取消</button><button type="button" onClick={() => void savePin()}>{deviceBusy ? '保存中…' : '保存 PIN'}</button></div>
        </section>
      </div>}

      {confirmAction && <div className="rn-settings-backdrop centered" role="presentation">
        <section className="rn-settings-confirm" role="alertdialog" aria-modal="true">
          <h2>{confirmCopy.title}</h2><p>{confirmCopy.body}</p>
          <div><button type="button" onClick={() => setConfirmAction(null)}>取消</button><button className="danger" type="button" onClick={() => void finishConfirm()}>{confirmCopy.button}</button></div>
        </section>
      </div>}
    </main>
  );
}
