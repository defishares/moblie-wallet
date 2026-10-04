import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAuth } from '../state/AuthProvider';
import { gatewayApi, type BSCBridgeConfig, type BSCDepositRoute } from '../services/gatewayApi';
import { formatGrapheneError } from '../services/grapheneError';

function configuredAmount(value: string | number | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '--';
  return amount.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function QrPreview({ value }: { value: string }) {
  const [source, setSource] = useState('');
  useEffect(() => { let live = true; void QRCode.toDataURL(value, { width: 224, margin: 0, errorCorrectionLevel: 'M', color: { dark: '#101114', light: '#FFFFFF' } }).then(next => live && setSource(next)); return () => { live = false; }; }, [value]);
  return source ? <img className="rn-deposit-qr" src={source} alt="充值地址二维码"/> : <div className="rn-deposit-qr-loading">生成二维码…</div>;
}

export function BSCDepositPage() {
  const { session } = useAuth();
  const [route, setRoute] = useState<BSCDepositRoute | null>(null); const [config, setConfig] = useState<BSCBridgeConfig | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const loadRoute = useCallback(async () => { if (!session) { setRoute(null); return; } setBusy(true); setError(null); try { setRoute(await gatewayApi.getBSCDepositAddress(session.account.name)); } catch (cause) { setRoute(null); setError(formatGrapheneError(cause)); } finally { setBusy(false); } }, [session]);
  useEffect(() => { void loadRoute(); }, [loadRoute]);
  useEffect(() => { let live = true; void gatewayApi.getBSCConfig().then(value => live && setConfig(value)).catch(() => live && setConfig(null)); return () => { live = false; }; }, [session?.account.id]);
  const token = route?.token || config?.token || 'USDT'; const network = route?.chain || config?.chain || 'BSC'; const chainId = config?.chainId; const contract = route?.contract || config?.contract || ''; const address = route?.address || ''; const bridgeTip = config?.tips?.trim();
  const copyAddress = async () => { if (!address) return; try { await navigator.clipboard.writeText(address); setNotice('充值地址已复制'); } catch { setError('复制失败，请长按地址手动复制'); } };
  return <div className="rn-deposit-page">
    <header className="rn-deposit-header"><Link to="/assets" aria-label="返回">‹</Link><h1>{token} 充值</h1><button type="button" onClick={() => void loadRoute()} disabled={busy} aria-label="刷新">↻</button></header>
    <main className="rn-deposit-content">
      <section className="rn-deposit-asset-card"><b>₮</b><div><strong>{token}</strong><small>{network}{chainId ? `（${chainId}）` : ''}</small></div></section>
      {busy ? <div className="rn-deposit-state"><span className="rn-deposit-spinner"/><p>正在获取专属充值地址...</p></div> : !session ? <div className="rn-deposit-state"><span>◎</span><strong>请先登录 DFS 账户</strong></div> : route ? <>
        <section className="rn-deposit-qr-card"><div className="rn-deposit-qr-frame"><QrPreview value={address}/></div><p>使用钱包扫描二维码，自动填写 {network} {token} 充值地址</p></section>
        <section className="rn-deposit-card"><label>充值地址（仅限 {network} {token}）</label><code className="rn-deposit-address">{address}</code><button className="rn-deposit-copy" type="button" onClick={() => void copyAddress()}>▣ <span>复制地址</span></button><div className="rn-deposit-info-row"><span>到账账户</span><strong>{route.account}</strong></div><div className="rn-deposit-info-row"><span>确认数</span><strong>{route.confirmations} 个区块</strong></div><div className="rn-deposit-info-row"><span>最低充值</span><strong>{configuredAmount(route.minimum)} {token}</strong></div></section>
        <section className="rn-deposit-card"><label>{token} 合约地址</label><code className="rn-deposit-contract">{contract || '--'}</code>{bridgeTip && <p className="rn-deposit-warning">{bridgeTip}</p>}</section>
      </> : <div className="rn-deposit-state error"><span>!</span><strong>暂时无法获取充值地址</strong><button type="button" onClick={() => void loadRoute()}>点击重试</button></div>}
      <section className="rn-deposit-support"><b>✉</b><p>充值提现问题，请联系邮箱：<br/><a href="mailto:bridge-team@defishares.org">bridge-team@defishares.org</a></p></section>
      {error && <p className="rn-deposit-error">{error}</p>}{notice && <p className="rn-deposit-notice">{notice}</p>}
    </main>
  </div>;
}
