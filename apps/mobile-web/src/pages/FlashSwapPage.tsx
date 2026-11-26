import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPrice, minimumReceiveWithSlippage, type AccountAssetBalance, type LiquidityPool, type LiquidityPreview } from '@defishares/core';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { formatGrapheneError } from '../services/grapheneError';
import { collectLiquidityHistoryReferences, parseLiquidityHistory, type HistoryAsset, type LiquidityHistoryEntry } from '../services/liquidityPoolHistory';
import { RNScreenHeader } from '../components/RNScreenHeader';
import { SuccessCheckIcon } from '../components/AppIcons';

function estimate(pool: LiquidityPool, side: 'a' | 'b', value: number) {
  const input = side === 'a' ? pool.balanceA : pool.balanceB;
  const output = side === 'a' ? pool.balanceB : pool.balanceA;
  if (!(input > 0 && output > 0 && value > 0)) return 0;
  const net = value * (1 - pool.takerFeePercent / 100);
  return output * net / (input + net);
}

function quantity(value: number, precision: number) { return Number.isFinite(value) && value > 0 ? value.toLocaleString('en-US', { maximumFractionDigits: Math.min(precision, 8) }) : '0'; }
function filterAmount(value: string, precision: number) { const normalized = value.replace(/[^\d.]/g, ''); const [whole, fraction = ''] = normalized.split('.'); return normalized.includes('.') ? `${whole || '0'}.${fraction.slice(0, precision)}` : whole; }

export function FlashSwapPage() {
  const { session, ensureSigningKey, signingKeyUnlocked } = useAuth();
  const { status, storage, client, loadAccountAssets, broadcastTransaction, loadLiquidityPools, loadLiquidityPoolHistory, loadLiquidityPreview, signOperation } = useChain();
  const [pools, setPools] = useState<LiquidityPool[]>([]);
  const [pool, setPool] = useState<LiquidityPool | null>(null);
  const [balances, setBalances] = useState<AccountAssetBalance[]>([]);
  const [page, setPage] = useState<'list' | 'detail'>('list');
  const [detailTab, setDetailTab] = useState<'swap' | 'liquidity' | 'history'>('swap');
  const [liquidityAction, setLiquidityAction] = useState<'add' | 'withdraw'>('add');
  const [listTab, setListTab] = useState<'favorites' | 'pools'>('pools');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [side, setSide] = useState<'a' | 'b'>('a');
  const [amount, setAmount] = useState('');
  const [amountB, setAmountB] = useState('');
  const [minReceive, setMinReceive] = useState('');
  const [preview, setPreview] = useState<LiquidityPreview | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingPools, setLoadingPools] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [history, setHistory] = useState<LiquidityHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyReload, setHistoryReload] = useState(0);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  useEffect(() => { void storage.get<string[]>('liquidity_pool_favorites.v1').then(value => { if (value) setFavorites(value); }); }, [storage]);
  const refresh = useCallback(async () => { setLoadingPools(true); setError(''); try { const rows = await loadLiquidityPools(); setPools(rows); setPool(current => current && rows.some(row => row.id === current.id) ? rows.find(row => row.id === current.id) || current : current); } catch (cause) { setError(formatGrapheneError(cause)); } finally { setLoadingPools(false); } }, [loadLiquidityPools]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!session || status !== 'connected') return; void loadAccountAssets(session.account.id).then(result => setBalances(result.balances)).catch(() => setBalances([])); }, [loadAccountAssets, session, status]);
  useEffect(() => {
    if (page !== 'detail' || detailTab !== 'history' || !pool) return;
    let active = true;
    setHistoryLoading(true);
    setHistoryError('');
    void loadLiquidityPoolHistory(pool.id, 50).then(async rows => {
      if (!active) return;
      const rawRows = Array.isArray(rows) ? rows : [];
      const refs = collectLiquidityHistoryReferences(rawRows);
      const [assetRows, accountRows] = await Promise.all([
        refs.assetIds.length ? client.lookupAssets(refs.assetIds) : Promise.resolve([]),
        refs.accountIds.length ? client.getFullAccounts(refs.accountIds) : Promise.resolve([]),
      ]);
      if (!active) return;
      const assets = new Map<string, HistoryAsset>(assetRows.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)).map(asset => [asset.id, { id: asset.id, symbol: asset.symbol, precision: asset.precision }]));
      const accounts = new Map<string, string>(accountRows.map(([id, data]) => [id, data.account.name]));
      setHistory(rawRows.map(row => parseLiquidityHistory(row, assets, accounts)));
      setExpandedHistory(new Set());
    }).catch(cause => { if (active) { setHistory([]); setHistoryError(formatGrapheneError(cause)); } }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [client, detailTab, historyReload, loadLiquidityPoolHistory, page, pool]);

  const visiblePools = useMemo(() => { const keyword = search.trim().toUpperCase(); return pools.filter(item => listTab === 'pools' || favorites.includes(item.id)).filter(item => !keyword || `${item.assetA.symbol}/${item.assetB.symbol} ${item.shareAsset.symbol}`.toUpperCase().includes(keyword)); }, [favorites, listTab, pools, search]);
  const sellAsset = pool ? side === 'a' ? pool.assetA : pool.assetB : null;
  const receiveAsset = pool ? side === 'a' ? pool.assetB : pool.assetA : null;
  const selectedBalance = balances.find(item => item.assetId === sellAsset?.id)?.amount || 0;
  const expected = pool && amount ? estimate(pool, side, Number(amount)) : 0;
  const operationLabel = detailTab === 'swap'
    ? `兑换 ${sellAsset?.symbol || ''} 为 ${receiveAsset?.symbol || ''}`
    : liquidityAction === 'add' ? '增加流动性' : '提取流动性';
  useEffect(() => { if (!pool || !amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || detailTab !== 'swap') { setMinReceive(''); return; } const precision = receiveAsset?.precision ?? 8; setMinReceive(minimumReceiveWithSlippage(expected, precision)); }, [amount, detailTab, expected, pool, receiveAsset?.precision]);

  const toggleFavorite = async (id: string) => { const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]; setFavorites(next); await storage.set('liquidity_pool_favorites.v1', next); };
  const openPool = (value: LiquidityPool) => { setPool(value); setPage('detail'); setDetailTab('swap'); setLiquidityAction('add'); setSide('a'); setAmount(''); setAmountB(''); setMinReceive(''); setPreview(null); };
  const changeDetailTab = (tab: 'swap' | 'liquidity' | 'history') => { setDetailTab(tab); setPreview(null); setError(''); };

  async function makePreview(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !pool) { setError('请先登录账户并选择流动性池'); return; }
    if (detailTab === 'history') return;
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try {
      if (detailTab === 'swap' && sellAsset && receiveAsset) {
        if (!amount || Number(amount) <= 0) throw new Error('请输入兑换数量');
        if (Number(amount) > selectedBalance) throw new Error(`余额不足，当前可用 ${quantity(selectedBalance, sellAsset.precision)} ${sellAsset.symbol}`);
        if (!minReceive || Number(minReceive) <= 0) throw new Error('请输入最小获得数量，或等待池子储备数据同步');
        setPreview(await loadLiquidityPreview({ accountNameOrId: session.account.id, poolId: pool.id, operationType: 'exchange', sellAssetId: sellAsset.id, sellAmount: amount, minReceive, receiveAssetId: receiveAsset.id }));
      } else if (detailTab === 'liquidity' && liquidityAction === 'add') {
        if (!amount || !amountB || Number(amount) <= 0 || Number(amountB) <= 0) throw new Error('请输入两种资产数量');
        setPreview(await loadLiquidityPreview({ accountNameOrId: session.account.id, poolId: pool.id, operationType: 'deposit', amountA: amount, amountB }));
      } else if (detailTab === 'liquidity') {
        if (!amount || Number(amount) <= 0) throw new Error('请输入 LP 数量');
        setPreview(await loadLiquidityPreview({ accountNameOrId: session.account.id, poolId: pool.id, operationType: 'withdraw', shareAmount: amount }));
      }
      setShowPassword(true);
    } catch (cause) { setError(formatGrapheneError(cause)); } finally { setBusy(false); }
  }

  async function submit() {
    if (!session || !preview) return;
    setBusy(true); setError('');
    try {
      const verified = await ensureSigningKey();
      if (verified.verifiedRole !== 'active') throw new Error('当前密钥只匹配 owner 权限，流动性操作需要 active 权限密钥');
      const operationName = preview.operationType === 'exchange' ? 'liquidity_pool_exchange' : preview.operationType === 'deposit' ? 'liquidity_pool_deposit' : 'liquidity_pool_withdraw';
      const signed = await signOperation(operationName, { ...preview.operation, fee: { amount: preview.fee.atomic, asset_id: preview.fee.assetId } }, verified.privateKeyWif);
      await broadcastTransaction(signed);
      const successMessage = preview.operationType === 'exchange'
        ? `兑换已提交：${preview.sell?.value || ''} ${preview.sell?.symbol || ''} → ${preview.receive?.value || ''} ${preview.receive?.symbol || ''}`
        : preview.operationType === 'deposit' ? '增加流动性已提交' : '提取流动性已提交';
      setShowPassword(false); setPreview(null); setAmount(''); setAmountB(''); setNotice(successMessage);
    } catch (cause) { setError(formatGrapheneError(cause)); } finally { setBusy(false); }
  }

  const renderHistoryEntry = (entry: LiquidityHistoryEntry) => {
    const expanded = expandedHistory.has(entry.id);
    const tone = entry.title === '增加流动性' ? 'positive' : entry.title === '闪兑' ? 'info' : entry.title === '提取流动性' ? 'warning' : '';
    return <article className="rn-flash-history-card" key={entry.id}>
      <button className="rn-flash-history-head" type="button" onClick={() => setExpandedHistory(current => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })}>
        <span><small>{entry.time}</small><strong className={tone}>{entry.title}</strong></span><b>{expanded ? '⌃' : '⌄'}</b>
      </button>
      <p className="rn-flash-history-summary">{entry.summary}</p>
      {expanded && <div className="rn-flash-history-details"><strong>链上明细</strong>{entry.fields.map((field, index) => <div className="rn-flash-history-field" key={`${entry.id}-${field.label}-${index}`}><span>{field.label}</span><b className={field.highlight ? 'highlight' : ''}>{field.value}</b></div>)}</div>}
    </article>;
  };

  const backToList = () => { setPage('list'); setPool(null); setPreview(null); setError(''); };
  return <main className="rn-flash-page">
    <RNScreenHeader title="闪兑" backTo="/" action={<button className="rn-header-icon" type="button" onClick={() => void refresh()} disabled={loadingPools}>↻</button>} />
    {page === 'list' ? <>
      <div className="rn-flash-search-row">{searchOpen ? <div className="rn-flash-search"><span>⌕</span><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索交易池"/><button type="button" onClick={() => { setSearch(''); setSearchOpen(false); }}>×</button></div> : <button className="rn-flash-search-button" type="button" onClick={() => setSearchOpen(true)}>⌕&nbsp; 搜索交易池</button>}<button className="rn-flash-refresh" type="button" onClick={() => void refresh()} disabled={loadingPools}>↻</button></div>
      <div className="rn-flash-list-tabs"><button className={listTab === 'favorites' ? 'active' : ''} type="button" onClick={() => setListTab('favorites')}>自选</button><button className={listTab === 'pools' ? 'active' : ''} type="button" onClick={() => setListTab('pools')}>流动性池</button></div>
      {error && <p className="rn-flash-error">{error}</p>}
      {loadingPools && pools.length === 0 ? <div className="rn-flash-empty">正在加载流动性池…</div> : visiblePools.length === 0 ? <div className="rn-flash-empty">{listTab === 'favorites' ? '暂无自选流动性池' : '暂无流动性池'}</div> : <section className="rn-flash-pool-list">{visiblePools.map(item => { const change = item.change24h; const changeText = change == null || !Number.isFinite(change) ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`; return <button className="rn-flash-pool-row" type="button" key={item.id} onClick={() => openPool(item)}><div className="rn-flash-pool-top"><strong>{item.assetA.symbol} / {item.assetB.symbol}</strong><span>{item.takerFeePercent.toFixed(2)}%</span><i className={favorites.includes(item.id) ? 'favorite' : ''} onClick={event => { event.stopPropagation(); void toggleFavorite(item.id); }}>★</i><em className={change == null ? 'unavailable' : change >= 0 ? 'positive' : 'negative'}>{changeText}</em></div><div className="rn-flash-pool-body"><div><small>总流动性</small><b>{formatPrice(item.balanceA, 6)} <u>{item.assetA.symbol}</u></b><small>24h 交易量 {item.volume24h == null ? '--' : `${formatPrice(item.volume24h, 6)} ${item.assetA.symbol}`}</small></div><div><small>池价</small><b>{item.balanceA > 0 && item.balanceB > 0 ? formatPrice(item.balanceB / item.balanceA, 6) : '--'}</b></div></div></button>; })}</section>}
    </> : pool ? <>
      <div className="rn-flash-detail-head"><button type="button" onClick={backToList}>‹</button><div><small>流动性池</small><h2>{pool.assetA.symbol} / {pool.assetB.symbol}</h2></div><button type="button" onClick={() => detailTab === 'history' ? setHistoryReload(value => value + 1) : void refresh()}>↻</button></div>
      <section className="rn-flash-hero"><div><small>池子储备</small><strong>{formatPrice(pool.balanceA, 6)} {pool.assetA.symbol}</strong><span>{formatPrice(pool.balanceB, 6)} {pool.assetB.symbol}</span></div><div><small>兑换费率</small><b>{pool.takerFeePercent.toFixed(2)}%</b></div></section>
      <nav className="rn-flash-detail-tabs"><button className={detailTab === 'swap' ? 'active' : ''} type="button" onClick={() => changeDetailTab('swap')}>闪兑</button><button className={detailTab === 'liquidity' ? 'active' : ''} type="button" onClick={() => changeDetailTab('liquidity')}>流动性池</button><button className={detailTab === 'history' ? 'active' : ''} type="button" onClick={() => changeDetailTab('history')}>历史记录</button></nav>
      {detailTab === 'history' ? <section className="rn-flash-history">
        {historyLoading && history.length === 0 ? <div className="rn-flash-empty detail">正在读取链上历史…</div> : historyError ? <div className="rn-flash-history-state"><p>{historyError}</p><button type="button" onClick={() => setHistoryReload(value => value + 1)}>重新加载</button></div> : history.length ? history.map(renderHistoryEntry) : <div className="rn-flash-empty detail">没有历史记录</div>}
      </section> : <form className="rn-flash-form" onSubmit={event => void makePreview(event)}>
        <h3>{detailTab === 'swap' ? '兑换资产' : liquidityAction === 'add' ? '增加流动性' : '提取流动性'}</h3>
        {detailTab === 'swap' ? <><label>卖出资产 <small>可用 {quantity(selectedBalance, sellAsset?.precision || 8)} {sellAsset?.symbol}</small></label><div className="rn-flash-asset-input"><span>{sellAsset?.symbol}</span><input inputMode="decimal" value={amount} onChange={event => setAmount(filterAmount(event.target.value, sellAsset?.precision || 8))} placeholder="请输入兑换数量"/><button type="button" onClick={() => setAmount(quantity(selectedBalance, sellAsset?.precision || 8))}>全部</button></div><button className="rn-flash-switch" type="button" onClick={() => { setSide(value => value === 'a' ? 'b' : 'a'); setAmount(''); setMinReceive(''); }}>⇅</button><label>最小获得数量 <small>{receiveAsset?.symbol}</small></label><div className="rn-flash-asset-input"><span>{receiveAsset?.symbol}</span><input inputMode="decimal" value={minReceive} onChange={event => setMinReceive(filterAmount(event.target.value, receiveAsset?.precision || 8))} placeholder="自动预留 0.5% 滑点"/></div><div className="rn-flash-stats"><div><span>兑换费率</span><b>{pool.takerFeePercent.toFixed(2)}%</b></div><div><span>预计获得</span><b>{expected > 0 ? `${formatPrice(expected, receiveAsset?.precision || 8)} ${receiveAsset?.symbol}` : '--'}</b></div></div></> : <>{<div className="rn-flash-action-tabs"><button type="button" className={liquidityAction === 'add' ? 'active' : ''} onClick={() => { setLiquidityAction('add'); setAmount(''); setAmountB(''); }}>增加流动性</button><button type="button" className={liquidityAction === 'withdraw' ? 'active' : ''} onClick={() => { setLiquidityAction('withdraw'); setAmount(''); setAmountB(''); }}>提取流动性</button></div>}{liquidityAction === 'add' ? <><label>资产 A <small>可用 {quantity(balances.find(item => item.assetId === pool.assetA.id)?.amount || 0, pool.assetA.precision)} {pool.assetA.symbol}</small></label><div className="rn-flash-asset-input"><span>{pool.assetA.symbol}</span><input inputMode="decimal" value={amount} onChange={event => setAmount(filterAmount(event.target.value, pool.assetA.precision))} placeholder="请输入数量"/><button type="button" onClick={() => setAmount(quantity(balances.find(item => item.assetId === pool.assetA.id)?.amount || 0, pool.assetA.precision))}>全部</button></div><label>资产 B <small>可用 {quantity(balances.find(item => item.assetId === pool.assetB.id)?.amount || 0, pool.assetB.precision)} {pool.assetB.symbol}</small></label><div className="rn-flash-asset-input"><span>{pool.assetB.symbol}</span><input inputMode="decimal" value={amountB} onChange={event => setAmountB(filterAmount(event.target.value, pool.assetB.precision))} placeholder="请输入数量"/><button type="button" onClick={() => setAmountB(quantity(balances.find(item => item.assetId === pool.assetB.id)?.amount || 0, pool.assetB.precision))}>全部</button></div><div className="rn-flash-stats"><div><span>当前池价</span><b>{pool.balanceA > 0 && pool.balanceB > 0 ? formatPrice(pool.balanceB / pool.balanceA, 6) : '--'}</b></div><div><span>预计获得</span><b>-- {pool.shareAsset.symbol}</b></div></div></> : <><label>提取 LP 份额 <small>可用 {quantity(balances.find(item => item.assetId === pool.shareAsset.id)?.amount || 0, pool.shareAsset.precision)} {pool.shareAsset.symbol}</small></label><div className="rn-flash-asset-input"><span>{pool.shareAsset.symbol}</span><input inputMode="decimal" value={amount} onChange={event => setAmount(filterAmount(event.target.value, pool.shareAsset.precision))} placeholder="请输入 LP 数量"/><button type="button" onClick={() => setAmount(quantity(balances.find(item => item.assetId === pool.shareAsset.id)?.amount || 0, pool.shareAsset.precision))}>全部</button></div><div className="rn-flash-stats"><div><span>资产 A</span><b>{pool.assetA.symbol}</b></div><div><span>资产 B</span><b>{pool.assetB.symbol}</b></div><div><span>提取费</span><b>{pool.withdrawalFeePercent.toFixed(2)}%</b></div></div></>}</>}
        {error && <p className="rn-flash-error">{error}</p>}<button className="rn-flash-submit" type="submit" disabled={busy || status !== 'connected'}>{busy ? '读取链上预览…' : detailTab === 'swap' ? `兑换 ${sellAsset?.symbol} 为 ${receiveAsset?.symbol}` : liquidityAction === 'add' ? '确认增加' : '确认提取'}</button>
      </form>}
    </> : null}
    {notice && <div className="rn-operation-toast success" role="status"><SuccessCheckIcon /><span>{notice}</span></div>}
    {showPassword && <div className="rn-flash-overlay" role="presentation" onMouseDown={event => event.currentTarget === event.target && setShowPassword(false)}><section className="rn-flash-password" role="dialog" aria-modal="true"><span/><h2>{signingKeyUnlocked ? operationLabel : '验证设备并签名'}</h2><p>{signingKeyUnlocked ? '设备已解锁，将直接提交这笔链上操作。' : '仅在提交链上操作时验证 Passkey，私钥不会离开当前页面内存。'}</p><div><button type="button" onClick={() => setShowPassword(false)}>取消</button><button type="button" onClick={() => void submit()} disabled={busy}>{busy ? '提交中…' : signingKeyUnlocked ? operationLabel : '验证设备并签名'}</button></div></section></div>}
  </main>;
}
