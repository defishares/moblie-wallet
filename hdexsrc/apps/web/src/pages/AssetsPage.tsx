import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountAssetBalance, AccountOrder, LendingOverview } from '@defishares/core';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { runtimeConfig } from '../services/runtime';

function conversionRate(from: string, to: string, tickers: ReturnType<typeof useChain>['tickers']): number {
  if (from === to) return 1;
  const graph = new Map<string, Array<{ asset: string; rate: number }>>();
  tickers.forEach(ticker => {
    if (!Number.isFinite(ticker.latest) || ticker.latest <= 0) return;
    graph.set(ticker.base, [...(graph.get(ticker.base) || []), { asset: ticker.quote, rate: ticker.latest }]);
    graph.set(ticker.quote, [...(graph.get(ticker.quote) || []), { asset: ticker.base, rate: 1 / ticker.latest }]);
  });
  const queue = [{ asset: from, rate: 1 }];
  const visited = new Set([from]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.get(current.asset) || []) {
      if (edge.asset === to) return current.rate * edge.rate;
      if (!visited.has(edge.asset)) { visited.add(edge.asset); queue.push({ asset: edge.asset, rate: current.rate * edge.rate }); }
    }
  }
  return 0;
}

function AssetIcon({ symbol }: { symbol: string }) {
  const [missing, setMissing] = useState(false);
  return missing
    ? <span className="rn-assets-coin fallback">{symbol.slice(0, 1)}</span>
    : <span className="rn-assets-coin"><img src={`/assets/coins/${encodeURIComponent(symbol.toUpperCase())}.png`} alt="" onError={() => setMissing(true)} /></span>;
}

function QuickActionIcon({ type }: { type: 'deposit' | 'withdraw' | 'transfer' | 'history' | 'lending' }) {
  if (type === 'deposit') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M6 14l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === 'withdraw') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V4M6 10l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === 'transfer') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14l-3-3M20 16H6l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === 'history') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 5v5h5M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-5 9 5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function formatQuantity(value: number, precision: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: Math.min(precision, 8) });
}

interface AssetDetail extends AccountAssetBalance {
  available: number;
  onOrder: number;
  collateral: number;
  debt: number;
  total: number;
}

export function AssetsPage() {
  const { loadAccountAssets, loadAccountOrders, loadLendingOverview, storage, tickers } = useChain();
  const { session } = useAuth();
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadAccountAssets>> | null>(null);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [lending, setLending] = useState<LendingOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [valuationAsset, setValuationAsset] = useState(runtimeConfig.network.defaultQuoteAsset);
  const [valuationOpen, setValuationOpen] = useState(false);
  const touchStart = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError(null);
    try {
      const [assetsResult, ordersResult, lendingResult] = await Promise.allSettled([loadAccountAssets(session.account.id), loadAccountOrders(session.account.id), loadLendingOverview(session.account.id)]);
      if (assetsResult.status === 'rejected') throw assetsResult.reason;
      setResult(assetsResult.value);
      setOrders(ordersResult.status === 'fulfilled' ? ordersResult.value.orders : []);
      setLending(lendingResult.status === 'fulfilled' ? lendingResult.value : null);
    }
    catch (cause) { setResult(null); setError(cause instanceof Error ? cause.message : '账户资产查询失败'); }
    finally { setLoading(false); }
  }, [loadAccountAssets, loadAccountOrders, loadLendingOverview, session]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void storage.get<string>('asset_valuation.v1').then(saved => { if (saved && ['CNY', 'USD', 'USDT', 'GOLD'].includes(saved)) setValuationAsset(saved); }); }, [storage]);

  const valuationOptions = ['CNY', 'USD', 'USDT', 'GOLD'];
  const balances = useMemo<AssetDetail[]>(() => {
    const details = new Map<string, AssetDetail>();
    const ensure = (symbol: string, assetId = symbol, precision = 8) => {
      const existing = details.get(symbol);
      if (existing) return existing;
      const next: AssetDetail = { symbol, assetId, precision, amount: 0, available: 0, onOrder: 0, collateral: 0, debt: 0, total: 0 };
      details.set(symbol, next); return next;
    };
    (result?.balances || []).forEach(balance => { const item = ensure(balance.symbol, balance.assetId, balance.precision); item.amount = balance.amount; item.available = balance.amount; });
    orders.forEach(order => { ensure(order.sellSymbol).onOrder += order.sellAmount; });
    lending?.positions.forEach(position => { const collateral = ensure(lending.collateralAsset.symbol, lending.collateralAsset.id, lending.collateralAsset.precision); collateral.collateral += position.collateral; const debt = ensure(position.debtAsset.symbol, position.debtAsset.id, position.debtAsset.precision); debt.debt += position.debt; });
    details.forEach(item => { item.total = item.available + item.onOrder + item.collateral - item.debt; item.amount = item.total; });
    return [...details.values()].sort((left, right) => {
    const leftValue = left.total * conversionRate(left.symbol, valuationAsset, tickers);
    const rightValue = right.total * conversionRate(right.symbol, valuationAsset, tickers);
    return rightValue - leftValue;
    });
  }, [lending, orders, result, tickers, valuationAsset]);
  const totalValue = useMemo(() => balances.reduce((sum, item) => sum + Math.max(0, item.total * conversionRate(item.symbol, valuationAsset, tickers)), 0), [balances, tickers, valuationAsset]);
  const setValuation = (value: string) => { setValuationAsset(value); setValuationOpen(false); void storage.set('asset_valuation.v1', value); };
  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => { if (touchStart.current !== null && event.changedTouches[0].clientY - touchStart.current > 70 && window.scrollY <= 0) void refresh(); touchStart.current = null; };

  return <div className="rn-page rn-assets-page" onTouchStart={event => { touchStart.current = event.touches[0].clientY; }} onTouchEnd={onTouchEnd}>
    <header className="rn-assets-header">
      <div className="rn-assets-title-row"><span>总资产估值</span><button type="button" className="rn-assets-eye" onClick={() => setHidden(value => !value)} aria-label={hidden ? '显示资产' : '隐藏资产'}><svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg></button></div>
      <div className="rn-assets-balance-row"><strong>{hidden ? '****' : totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><button type="button" className="rn-assets-currency" onClick={() => setValuationOpen(true)}>{valuationAsset}<span>⌄</span></button></div>
    </header>
    <section className="rn-assets-actions" aria-label="资产快捷操作"><Link to="/bsc-deposit"><b><QuickActionIcon type="deposit" /></b><span>充值</span></Link><Link to="/bsc-withdraw"><b><QuickActionIcon type="withdraw" /></b><span>提现</span></Link><Link to="/transfer"><b><QuickActionIcon type="transfer" /></b><span>转账</span></Link><Link to="/bsc-history"><b><QuickActionIcon type="history" /></b><span>充提查询</span></Link><Link to="/lending"><b><QuickActionIcon type="lending" /></b><span>借贷</span></Link></section>
    {loading && result && <div className="rn-assets-refreshing">正在刷新资产…</div>}
    <div className="rn-assets-list-head"><h2>资产</h2><button type="button" aria-label="筛选资产">☷</button></div>
    {error && <div className="inline-error">{error}</div>}
    {loading && !result && <div className="empty-state">正在同步账户资产…</div>}
    <section className="rn-assets-list">{balances.map(balance => { const rate = conversionRate(balance.symbol, valuationAsset, tickers); const directTicker = tickers.find(item => item.base === balance.symbol && item.quote === valuationAsset); const change = directTicker?.change24h || 0; const hasExtra = balance.onOrder > 0 || balance.collateral > 0 || balance.debt > 0; return <article className="rn-asset-row" key={balance.assetId}><AssetIcon symbol={balance.symbol}/><div className="rn-asset-balance"><strong>{balance.symbol}</strong><span>{hidden ? '****' : formatQuantity(balance.available, balance.precision)}{!hidden && hasExtra ? ' (+)' : ''}</span></div><div className="rn-asset-value"><strong>{hidden ? '****' : `${(balance.total * rate).toLocaleString('en-US', { maximumFractionDigits: 5 })} ${valuationAsset}`}</strong><span className={change < 0 ? 'negative' : change > 0 ? 'positive' : ''}>{rate ? `${rate.toLocaleString('en-US', { maximumFractionDigits: 5 })} ${valuationAsset}` : '0'}{directTicker ? ` (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)` : ''}</span></div></article>; })}{!loading && !balances.length && <div className="empty-state">暂无可显示的资产</div>}</section>
    {valuationOpen && <div className="rn-assets-modal-backdrop" role="presentation" onClick={() => setValuationOpen(false)}><section className="rn-asset-sheet" role="dialog" aria-label="选择估值资产" onClick={event => event.stopPropagation()}><h3>选择估值资产</h3>{valuationOptions.map(option => <button type="button" className={option === valuationAsset ? 'active' : ''} key={option} onClick={() => setValuation(option)}><span>{option}</span><b>{option === valuationAsset ? '✓' : ''}</b></button>)}</section></div>}
  </div>;
}
