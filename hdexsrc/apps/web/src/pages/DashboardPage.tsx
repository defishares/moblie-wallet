import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MarketRow } from '../components/MarketRow';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { runtimeConfig } from '../services/runtime';

type HomeAnnouncement = { id: string; title: string; content: string; publishedAt?: number; expiresAt?: number };

function HomeActionIcon({ type }: { type: 'transfer' | 'receive' | 'buy' | 'swap' | 'more' | 'lending' | 'finance' | 'history' }) {
  if (type === 'transfer') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V4M6 10l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === 'receive') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M6 14l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === 'buy') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M3 9h18M7 14h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
  if (type === 'swap') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-7 12h6l-1 8 7-12h-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>;
  if (type === 'more') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>;
  if (type === 'lending') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-5 9 5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === 'finance') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16M7 15l4-5 3 2 5-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 5v5h5M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function parseAnnouncements(value: unknown): HomeAnnouncement[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .filter(item => typeof item.id === 'string' && typeof item.title === 'string' && typeof item.content === 'string' && item.enabled !== false)
    .map(item => ({ id: item.id as string, title: (item.title as string).trim(), content: (item.content as string).trim(), publishedAt: typeof item.publishedAt === 'number' ? item.publishedAt : undefined, expiresAt: typeof item.expiresAt === 'number' ? item.expiresAt : undefined }))
    .filter(item => item.title && item.content && (!item.publishedAt || item.publishedAt <= Date.now()) && (!item.expiresAt || item.expiresAt > Date.now()));
}

function conversionRate(from: string, to: string, tickers: ReturnType<typeof useChain>['tickers']): number {
  if (from === to) return 1;
  const graph = new Map<string, Array<{ asset: string; rate: number }>>();
  for (const ticker of tickers) {
    if (!Number.isFinite(ticker.latest) || ticker.latest <= 0) continue;
    graph.set(ticker.base, [...(graph.get(ticker.base) || []), { asset: ticker.quote, rate: ticker.latest }]);
    graph.set(ticker.quote, [...(graph.get(ticker.quote) || []), { asset: ticker.base, rate: 1 / ticker.latest }]);
  }
  const queue: Array<{ asset: string; rate: number }> = [{ asset: from, rate: 1 }];
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

export function DashboardPage() {
  const { client, status, tickers, favoriteKeys, loadAccountAssets, storage } = useChain();
  const { session } = useAuth();
  const [accountAssets, setAccountAssets] = useState<Awaited<ReturnType<typeof loadAccountAssets>> | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [rank, setRank] = useState<'favorites' | 'hot' | 'gainers' | 'losers'>('hot');
  const [hideBalance, setHideBalance] = useState(false);
  const [quoteAsset, setQuoteAsset] = useState<string | null>(null);
  const [valuationAsset, setValuationAsset] = useState(runtimeConfig.network.defaultQuoteAsset);
  const [announcements, setAnnouncements] = useState<HomeAnnouncement[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [buyMessage, setBuyMessage] = useState(false);
  const refreshAccount = useCallback(async () => {
    if (!session) return;
    try {
      setAccountError(null);
      setAccountAssets(await loadAccountAssets(session.account.id));
    } catch (cause) {
      setAccountAssets(null);
      setAccountError(cause instanceof Error ? cause.message : '账户资产查询失败');
    }
  }, [loadAccountAssets, session]);

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);

  // Keep the home valuation in lockstep with AssetsScreen's selected quote.
  useEffect(() => {
    let live = true;
    void storage.get<string>('asset_valuation.v1').then(saved => {
      if (live && saved && ['CNY', 'USD', 'USDT', 'GOLD'].includes(saved)) setValuationAsset(saved);
    });
    return () => { live = false; };
  }, [storage]);

  useEffect(() => {
    if (status !== 'connected') return;
    let live = true;
    const sources = [...new Set([runtimeConfig.channel.onChainSettingsAccount, '1.2.100'])];
    void Promise.all(sources.map(async account => {
      const rows = await client.getStorageInfo(account, 'app.settings.v2');
      return rows.find(row => row?.key === 'announcements.v1')?.value;
    })).then(values => {
      if (!live) return;
      setAnnouncements(values.flatMap(parseAnnouncements).sort((left, right) => (right.publishedAt || 0) - (left.publishedAt || 0)));
    }).catch(() => { if (live) setAnnouncements([]); });
    return () => { live = false; };
  }, [client, status]);

  const quoteOptions = useMemo(() => [...new Set(tickers.map(ticker => ticker.quote))].sort(), [tickers]);
  const visibleTickers = useMemo(() => quoteAsset ? tickers.filter(ticker => ticker.quote === quoteAsset) : tickers, [quoteAsset, tickers]);

  const rankedMarkets = useMemo(() => {
    const source = rank === 'favorites' ? visibleTickers.filter(ticker => favoriteKeys.includes(ticker.key)) : [...visibleTickers];
    return source.sort((left, right) => {
      if (rank === 'gainers') return right.change24h - left.change24h;
      if (rank === 'losers') return left.change24h - right.change24h;
      return right.quoteVolume - left.quoteVolume;
    }).slice(0, 5);
  }, [favoriteKeys, rank, visibleTickers]);

  const totalValue = accountAssets?.balances.reduce((sum, balance) => sum + Math.max(0, balance.amount * conversionRate(balance.symbol, valuationAsset, tickers)), 0);
  const activeAnnouncement = announcements[0];

  return <div className="rn-page rn-home-page">
    <header className="rn-home-header">
      <div className="rn-balance-title">总资产估值 <button className="icon-button" onClick={() => setHideBalance(value => !value)} aria-label={hideBalance ? '显示资产' : '隐藏资产'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></svg></button></div>
      <div className="rn-home-actions"><Link className="rn-pill-button primary" to="/bsc-deposit">充值</Link><Link className="rn-pill-button" to="/bsc-withdraw">提现</Link><Link className="rn-icon-button" to="/settings" aria-label="设置">⚙</Link><span className="rn-icon-button rn-lock-button" title="Web 端交易时使用 active 权限密码"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="15" r="1.2" fill="currentColor" /></svg></span></div>
      <div className="rn-balance-value">{hideBalance ? '****' : totalValue === undefined ? '--' : totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span>{valuationAsset}</span></div>
    </header>
    <section className="rn-quick-actions" aria-label="快捷操作">
      <Link to="/transfer"><b><HomeActionIcon type="transfer" /></b><span>转账</span></Link><Link to="/bsc-deposit"><b><HomeActionIcon type="receive" /></b><span>收款</span></Link><Link to="/flash-swap"><b><HomeActionIcon type="swap" /></b><span>闪兑</span></Link><button type="button" className="rn-quick-action-button" onClick={() => setMoreOpen(true)}><b><HomeActionIcon type="more" /></b><span>更多</span></button>
    </section>
    {buyMessage && <button type="button" className="rn-toast" onClick={() => setBuyMessage(false)}>敬请期待</button>}
    {moreOpen && <div className="rn-sheet-backdrop" role="presentation" onClick={() => setMoreOpen(false)}><section className="rn-more-sheet" role="dialog" aria-label="更多功能" onClick={event => event.stopPropagation()}><span className="rn-sheet-handle" /><div className="rn-more-grid"><Link to="/lending" onClick={() => setMoreOpen(false)}><b><HomeActionIcon type="lending" /></b><span>借贷</span></Link><button type="button" onClick={() => { setMoreOpen(false); setBuyMessage(true); }}><b><HomeActionIcon type="buy" /></b><span>买币</span></button><Link to="/bsc-history" onClick={() => setMoreOpen(false)}><b><HomeActionIcon type="history" /></b><span>充提查询</span></Link><Link to="/history" onClick={() => setMoreOpen(false)}><b><HomeActionIcon type="history" /></b><span>交易历史</span></Link></div><button type="button" className="rn-sheet-cancel" onClick={() => setMoreOpen(false)}>取消</button></section></div>}
    {activeAnnouncement && <Link className="rn-announcement" to="/announcements"><span className="rn-announcement-icon">$</span><span><span className="rn-announcement-heading"><strong>{activeAnnouncement.title}</strong><small>{announcements.length ? `1/${announcements.length}` : ''}</small></span><small>{activeAnnouncement.content}</small></span><b>›</b></Link>}
    {accountError && <div className="inline-error">{accountError}</div>}
    <section className="rn-market-section"><div className="rn-home-tabs-row"><div className="rn-rank-tabs">{([['favorites', '自选'], ['hot', '热门榜'], ['gainers', '涨幅榜'], ['losers', '跌幅榜']] as const).map(([key, label]) => <button key={key} className={rank === key ? 'active' : ''} onClick={() => setRank(key)}>{label}</button>)}</div><label className="rn-quote-selector"><select value={quoteAsset || ''} onChange={event => setQuoteAsset(event.target.value || null)} aria-label="选择报价资产"><option value="">全部</option>{quoteOptions.map(option => <option key={option} value={option}>{option}</option>)}</select><span>⌄</span></label></div><div className="rn-market-list">{rankedMarkets.length ? rankedMarkets.map(ticker => <MarketRow key={ticker.key} ticker={ticker} />) : <div className="empty-state">{rank === 'favorites' ? '暂无自选' : '暂无数据'}</div>}</div></section>
  </div>;
}
