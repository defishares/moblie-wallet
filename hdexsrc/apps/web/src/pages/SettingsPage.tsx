import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RNScreenHeader } from '../components/RNScreenHeader';
import { webSocketNodes } from '../services/runtime';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';

type IconName = 'logout' | 'account' | 'server' | 'fingerprint' | 'trash' | 'info' | 'about' | 'copy' | 'plus' | 'close';

function SettingIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    logout: <><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><path d="m15 16 4-4-4-4M19 12H9"/></>,
    account: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 9v6M14 12h6"/></>,
    server: <><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/></>,
    fingerprint: <><path d="M6.8 9.7a5.4 5.4 0 0 1 10.4 2c0 3.3-.7 6-2.1 8.1"/><path d="M4.3 13.2a7.8 7.8 0 0 1 15.4-2.1M9.2 20c1.2-2.2 1.4-4.5 1.4-7.1a1.5 1.5 0 0 1 3 0c0 3.4-.4 6.2-1.5 8.1M6.5 17.8c.7-1.6.8-3.2.8-5"/></>,
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
  const { session, logout, biometricSupported, hasBiometricVault, setupBiometricVault, removeBiometricVault } = useAuth();
  const [nodeSheetOpen, setNodeSheetOpen] = useState(false);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [nodeUrl, setNodeUrl] = useState('');
  const [busyNode, setBusyNode] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'logout' | 'delete' | 'cache' | 'vault' | null>(null);
  const [deviceVaultReady, setDeviceVaultReady] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);

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
              title="设备验证解锁"
              subtitle={!biometricSupported ? '需要 HTTPS/localhost 和支持 PRF 的浏览器' : deviceVaultReady ? '已启用：私钥以加密密文保存在本设备' : '使用指纹、面容或系统设备验证保护本地私钥'}
              right={biometricSupported ? <span className={deviceVaultReady ? 'rn-settings-enabled' : 'rn-settings-unavailable'}>{deviceVaultReady ? '已启用' : '未启用'}</span> : <span className="rn-settings-unavailable">不支持</span>}
              onClick={deviceVaultReady ? () => setConfirmAction('vault') : () => void setupDeviceUnlock()}
              disabled={!biometricSupported || deviceBusy}
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

      {confirmAction && <div className="rn-settings-backdrop centered" role="presentation">
        <section className="rn-settings-confirm" role="alertdialog" aria-modal="true">
          <h2>{confirmCopy.title}</h2><p>{confirmCopy.body}</p>
          <div><button type="button" onClick={() => setConfirmAction(null)}>取消</button><button className="danger" type="button" onClick={() => void finishConfirm()}>{confirmCopy.button}</button></div>
        </section>
      </div>}
    </main>
  );
}
