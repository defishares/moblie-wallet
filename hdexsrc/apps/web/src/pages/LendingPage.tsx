import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPrice, type AccountAssetBalance, type LendingOverview, type LendingPreview } from '@defishares/core';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { formatGrapheneError } from '../services/grapheneError';

const formatAmount = (value: number, maximumFractionDigits = 6) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: Math.min(maximumFractionDigits, 8) }) : '--';
const numeric = (value: string) => value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

export function LendingPage() {
  const { session, ensureSigningKey } = useAuth();
  const { broadcastTransaction, loadAccountAssets, loadLendingOverview, loadLendingPreview, signOperation } = useChain();
  const [overview, setOverview] = useState<LendingOverview | null>(null);
  const [assets, setAssets] = useState<AccountAssetBalance[]>([]);
  const [asset, setAsset] = useState('');
  const [collateral, setCollateral] = useState('');
  const [debt, setDebt] = useState('');
  const [ratio, setRatio] = useState(3);
  const [targetRatio, setTargetRatio] = useState(0);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [preview, setPreview] = useState<LendingPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError(null);
    try {
      const [nextOverview, nextAssets] = await Promise.all([loadLendingOverview(session.account.id), loadAccountAssets(session.account.id)]);
      setOverview(nextOverview); setAssets(nextAssets.balances);
      setAsset(current => current && nextOverview.borrowAssets.some(item => item.symbol === current) ? current : nextOverview.borrowAssets[0]?.symbol ?? '');
    } catch (cause) { setError(formatGrapheneError(cause)); } finally { setLoading(false); }
  }, [loadAccountAssets, loadLendingOverview, session]);
  useEffect(() => { void refresh(); }, [refresh]);

  const selected = overview?.borrowAssets.find(item => item.symbol === asset) ?? overview?.borrowAssets[0];
  const currentPosition = overview?.positions.find(position => position.debtAsset.symbol === selected?.symbol);
  const collateralAsset = overview?.collateralAsset;
  const dfsBalance = assets.find(item => item.assetId === collateralAsset?.id || item.symbol === 'DFS')?.amount ?? 0;
  const borrowBalance = assets.find(item => item.assetId === selected?.id || item.symbol === selected?.symbol)?.amount ?? 0;
  const collateralValue = Number(collateral) || 0;
  const debtValue = Number(debt) || 0;
  const currentCollateral = currentPosition?.collateral ?? 0;
  const currentDebt = currentPosition?.debt ?? 0;
  const collateralDelta = collateralValue - currentCollateral;
  const debtDelta = debtValue - currentDebt;
  const currentRatio = selected && selected.feedPrice > 0 && debtValue > 0 ? collateralValue * selected.feedPrice / debtValue * 100 : 0;
  const positionRatioFor = (position: LendingOverview['positions'][number]) => position.feedPrice > 0 && position.debt > 0 ? position.collateral * position.feedPrice / position.debt * 100 : 0;

  useEffect(() => {
    if (currentPosition && selected) { setCollateral(currentPosition.collateral.toFixed(Math.min(8, overview?.collateralAsset.precision ?? 5))); setDebt(currentPosition.debt.toFixed(Math.min(8, selected.precision))); }
    else { setCollateral(''); setDebt(''); }
    setRatio(3); setTargetRatio(0); setPreview(null);
  }, [currentPosition?.id, currentPosition?.collateral, currentPosition?.debt, selected?.id]);

  const reset = () => { setCollateral(''); setDebt(''); setRatio(3); setTargetRatio(0); setPreview(null); setError(null); setNotice(null); };
  const setCollateralValue = (value: string) => { const next = numeric(value); setCollateral(next); if (targetRatio > 0 && selected?.feedPrice && Number(next) > 0) setDebt((Number(next) * selected.feedPrice / targetRatio).toFixed(selected.precision)); };
  const changeRatio = (value: number) => { setRatio(value); if (selected?.feedPrice && collateralValue > 0) setDebt((collateralValue * selected.feedPrice / value).toFixed(selected.precision)); };
  const changeTargetRatio = (value: number) => { setTargetRatio(value); if (value > 0 && selected?.feedPrice && collateralValue > 0) setDebt((collateralValue * selected.feedPrice / value).toFixed(selected.precision)); };

  async function createPreview(targetCollateral = collateral, targetDebt = debt) {
    if (!session || !asset) throw new Error('请选择借款资产');
    if (!targetCollateral || Number(targetCollateral) <= 0) throw new Error('请输入调整后的 DFS 抵押数量');
    if (!targetDebt || Number(targetDebt) <= 0) throw new Error(currentPosition ? '请输入调整后的债务；如需全部归还，请使用平仓功能' : '请输入借款数量');
    if (Number(targetCollateral) > dfsBalance + 1e-8 && Number(targetCollateral) > currentCollateral) throw new Error(`DFS 可用余额不足（可用 ${formatAmount(dfsBalance)}）`);
    return loadLendingPreview({ accountNameOrId: session.account.id, debtAssetSymbolOrId: asset, targetCollateral, targetDebt });
  }
  async function submit() {
    if (!session || !selected) return;
    setSubmitting(true); setError(null); setNotice(null);
    try { const nextPreview = await createPreview(); setPreview(nextPreview); const signer = await ensureSigningKey(); if (signer.verifiedRole !== 'active') throw new Error('当前密钥只匹配 owner 权限，借贷需要 active 权限密钥'); const signed = await signOperation('call_order_update', { ...nextPreview.operation, fee: { amount: nextPreview.fee.atomic, asset_id: nextPreview.fee.assetId } }, signer.privateKeyWif); await broadcastTransaction(signed); setNotice(`仓位已调整为 ${collateralValue} DFS / ${debtValue} ${selected.symbol}`); reset(); await refresh(); }
    catch (cause) { setError(formatGrapheneError(cause)); } finally { setSubmitting(false); }
  }
  async function closePosition(position: LendingOverview['positions'][number]) {
    if (!session) return;
    const debtAsset = overview?.borrowAssets.find(item => item.id === position.debtAsset.id);
    if (!debtAsset) return;
    if (borrowBalance + 10 ** (-debtAsset.precision) < position.debt) { setError(`${debtAsset.symbol} 可用余额不足，无法平仓`); return; }
    if (!window.confirm(`确认关闭 ${debtAsset.symbol} 借仓？\n将偿还全部 ${formatAmount(position.debt)} ${debtAsset.symbol}，并解锁 ${formatAmount(position.collateral)} DFS。`)) return;
    setClosingId(position.id); setError(null); setNotice(null);
    try { const nextPreview = await loadLendingPreview({ accountNameOrId: session.account.id, debtAssetSymbolOrId: debtAsset.symbol, targetCollateral: '0', targetDebt: '0' }); setPreview(nextPreview); const signer = await ensureSigningKey(); if (signer.verifiedRole !== 'active') throw new Error('当前密钥只匹配 owner 权限，平仓需要 active 权限密钥'); const signed = await signOperation('call_order_update', { ...nextPreview.operation, fee: { amount: nextPreview.fee.atomic, asset_id: nextPreview.fee.assetId } }, signer.privateKeyWif); await broadcastTransaction(signed); setNotice(`已平仓：全部偿还 ${position.debt} ${debtAsset.symbol}，DFS 抵押物已解锁`); await refresh(); }
    catch (cause) { setError(formatGrapheneError(cause)); } finally { setClosingId(null); }
  }

  return <div className="rn-lending-page">
    <header className="rn-lending-header"><div className="rn-lending-header-left"><Link to="/" aria-label="返回">‹</Link><button type="button" onClick={reset}>↻ <span>重置</span></button></div><div className="rn-lending-title"><span>♢</span><h1>抵押借贷</h1></div><button className="rn-lending-asset-trigger" type="button" onClick={() => setAssetPickerOpen(true)}>选择资产⌄</button></header>
    <main className="rn-lending-content">
      <section className="rn-lending-market-card"><div className="rn-lending-market-title"><b>₿</b><div><strong>DFS / {selected?.symbol || 'CNY'}</strong><small>链上抵押市场</small></div></div><div className="rn-lending-divider"/><div className="rn-lending-feed"><span>当前喂价</span><strong>{selected?.feedPrice ? formatPrice(selected.feedPrice, 8) : '--'}</strong><small>{selected?.symbol || 'CNY'} / DFS</small><b>ⓘ</b></div></section>
      <section className="rn-lending-form-card"><div className="rn-lending-form-title"><span>♙</span><h2>{currentPosition ? '调整抵押借贷' : '创建抵押借贷'}</h2><b>ⓘ</b></div>
        <div className="rn-lending-field-head"><strong>借款金额</strong><span>可用余额 {formatAmount(borrowBalance, selected?.precision ?? 2)} {selected?.symbol || ''}</span></div><div className="rn-lending-amount-box"><input inputMode="decimal" value={debt} onChange={event => setDebt(numeric(event.target.value))} placeholder="请输入借款金额"/><button type="button" onClick={() => setAssetPickerOpen(true)}>{selected?.symbol || '选择'}⌄</button><button type="button" onClick={() => setDebt(String(Math.max(0, borrowBalance)))}>还款</button></div>
        <div className="rn-lending-field-head"><strong>抵押物</strong><span>可用余额 {formatAmount(dfsBalance, collateralAsset?.precision ?? 2)} DFS</span></div><div className="rn-lending-amount-box"><input inputMode="decimal" value={collateral} onChange={event => setCollateralValue(event.target.value)} placeholder="请输入抵押物数量"/><b>DFS</b><button type="button" onClick={() => setCollateralValue(String(Math.max(0, dfsBalance)))}>全部</button></div>
        <div className="rn-lending-slider-head"><strong>♢　抵押率 <b>{ratio.toFixed(2)}</b></strong><span>ⓘ</span></div><input className="rn-lending-range" type="range" min="1" max="6" step="0.01" value={ratio} onChange={event => changeRatio(Number(event.target.value))}/><div className="rn-lending-range-labels"><span>1.00</span><span>3.50</span><span>6.00</span></div>
        <div className="rn-lending-slider-head"><strong>✦　目标抵押率 <b>{targetRatio ? targetRatio.toFixed(2) : '未设置'}</b></strong><span>ⓘ</span></div><input className="rn-lending-range target" type="range" min="0" max="6" step="0.01" value={targetRatio} onChange={event => changeTargetRatio(Number(event.target.value))}/><div className="rn-lending-range-labels"><span>关闭</span><span>3.00</span><span>6.00</span></div>
        <div className="rn-lending-estimate"><div><span>预计借款</span><strong>{debt ? formatAmount(debtValue, selected?.precision ?? 4) : '--'}</strong></div><i/><div><span>预计抵押</span><strong>{collateral ? formatAmount(collateralValue, collateralAsset?.precision ?? 4) : '--'}</strong></div></div><button className="rn-lending-submit" type="button" disabled={loading || submitting || !selected} onClick={() => void submit()}>{submitting ? '提交中…' : '▣　抵押'}</button>
      </section>
      <section className="rn-lending-notice"><b>ⓘ</b><div><strong>温馨提示</strong><p>当锁定借款金额时，抵押率会随抵押物数量变化而变化。</p><p>当锁定抵押率时，借款金额会随抵押物数量变化而变化。</p></div></section>
      <div className="rn-lending-position-head"><h2>我的借仓</h2><span>{overview?.positions.length ?? 0} 个仓位</span></div>
      {loading ? <div className="rn-lending-empty">正在同步仓位…</div> : overview?.positions.length ? <div className="rn-lending-positions">{overview.positions.map(position => { const positionRatio = positionRatioFor(position); return <article key={position.id} className="rn-lending-position"><div className="rn-lending-position-top"><strong>♢ {position.debtAsset.symbol} 借仓</strong><small>{position.id}</small></div><div className="rn-lending-position-grid"><div><span>抵押物</span><b>{formatAmount(position.collateral)} DFS</b></div><div><span>借款</span><b>{formatAmount(position.debt)} {position.debtAsset.symbol}</b></div><div><span>抵押率</span><b className={positionRatio < position.initialCollateralRatio ? 'danger-text' : 'good-text'}>{positionRatio.toFixed(2)}%</b></div><div><span>喂价</span><b>{formatPrice(position.feedPrice, 8)}</b></div></div><div className="rn-lending-position-bottom"><span>预估清算线 {position.initialCollateralRatio.toFixed(0)}%</span><button type="button" onClick={() => void closePosition(position)} disabled={closingId === position.id}>{closingId === position.id ? '处理中…' : '全部平仓'}</button></div></article>; })}</div> : <div className="rn-lending-empty"><span>▧</span><strong>暂无 DFS 借仓</strong><small>抵押 DFS 后，借款仓位会显示在这里</small></div>}
      {error && <p className="rn-lending-error">{error}</p>}{notice && <p className="rn-lending-success">{notice}</p>}
    </main>
    {preview && <div className="rn-lending-preview"><span>最近提交</span><strong>抵押变化 {preview.collateralDelta} · 债务变化 {preview.debtDelta}</strong><small>手续费 {preview.fee.value} {preview.fee.symbol}</small></div>}
    {assetPickerOpen && <div className="rn-lending-modal-backdrop" role="presentation" onClick={() => setAssetPickerOpen(false)}><section className="rn-lending-asset-sheet" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><h2>选择借款资产</h2>{overview?.borrowAssets.map(item => <button type="button" key={item.id} onClick={() => { setAsset(item.symbol); setAssetPickerOpen(false); }}><strong>{item.symbol}</strong><span>{item.id === selected?.id ? '✓' : '›'}</span></button>)}</section></div>}
  </div>;
}
