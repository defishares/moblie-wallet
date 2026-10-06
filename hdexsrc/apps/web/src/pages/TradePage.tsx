import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type AccountAssetBalance, type AccountOrder, type LimitOrderPreview, type MarketPair, type OrderBookData } from '@defishares/core';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { formatGrapheneError } from '../services/grapheneError';
import { KlineCandlestickIcon, SettingsGearIcon, SuccessCheckIcon } from '../components/AppIcons';

type Side = 'buy' | 'sell';
type OrderType = 'limit' | 'market';
const defaultPair: MarketPair = { base: 'DFS', quote: 'CNY' };
const sliderStops = [0, 25, 50, 75, 100];

function amountText(value: number): string {
  if (!Number.isFinite(value)) return '--';
  if (value === 0) return '0';
  return value < 0.0001 ? value.toFixed(8) : value < 1 ? value.toFixed(6) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
function priceText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value < 0.0001) return value.toFixed(8);
  if (value < 1) return value.toFixed(6);
  if (value < 100) return value.toFixed(4);
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function OrderTypeSheet({ value, onChange, onClose }: { value: OrderType; onChange: (value: OrderType) => void; onClose: () => void }) {
  return <div className="rn-trade-modal-backdrop" role="presentation" onClick={onClose}>
    <section className="rn-trade-order-sheet" role="dialog" aria-modal="true" aria-labelledby="trade-order-type" onClick={event => event.stopPropagation()}>
      <h2 id="trade-order-type">选择委托类型</h2>
      {([['limit', '限价委托', '指定价格下单，等待市场价格达到时成交'], ['market', '市价委托', '以当前市场最优价格立即成交']] as const).map(([type, title, description]) => <button key={type} type="button" className={`rn-trade-order-option ${value === type ? 'active' : ''}`} onClick={() => { onChange(type); onClose(); }}>
        <span><strong>{title}</strong><small>{description}</small></span>{value === type && <b>✓</b>}
      </button>)}
    </section>
  </div>;
}

function OrderBook({ book, tickerPrice, change, pair, onPriceClick }: { book: OrderBookData | null; tickerPrice: number; change: number; pair: MarketPair; onPriceClick: (price: number) => void }) {
  const asks = book?.asks ?? [];
  const bids = book?.bids ?? [];
  const askRows = asks.slice(0, 10).reverse();
  const bidRows = bids.slice(0, 10);
  const askTotal = asks.reduce((sum, row) => sum + row.base, 0);
  const bidTotal = bids.reduce((sum, row) => sum + row.base, 0);
  const buyRatio = askTotal + bidTotal ? Math.round(bidTotal / (askTotal + bidTotal) * 100) : 50;
  const mid = bidRows[0]?.price && askRows[askRows.length - 1]?.price ? (bidRows[0].price + askRows[askRows.length - 1].price) / 2 : tickerPrice;
  const rows = (items: typeof askRows, color: 'positive' | 'negative') => <div className="rn-trade-book-list">{Array.from({ length: 10 }, (_, index) => {
    const row = items[index];
    return <button className="rn-trade-book-row" type="button" key={`${color}-${index}`} onClick={() => row && onPriceClick(row.price)} disabled={!row}><span className={color}>{row ? priceText(row.price) : '--'}</span><span>{row ? amountText(row.base) : '--'}</span></button>;
  })}</div>;
  return <section className="rn-trade-orderbook">
    <div className="rn-trade-book-header"><span>价格 ({pair.quote})</span><span>数量 ({pair.base})</span></div>
    {rows(askRows, 'negative')}
    <button type="button" className="rn-trade-mid-price" onClick={() => mid > 0 && onPriceClick(mid)}><strong className={change >= 0 ? 'positive' : 'negative'}>{priceText(mid)}</strong><span>≈ {priceText(mid)} <em className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</em></span></button>
    {rows(bidRows, 'positive')}
    <div className="rn-trade-ratio"><span style={{ flex: buyRatio }}>B {buyRatio}%</span><span style={{ flex: 100 - buyRatio }}>{100 - buyRatio}% S</span></div>
    <div className="rn-trade-depth"><span>10⌄</span><b>▰</b></div>
  </section>;
}

function OrderRow({ order, pair, onCancel }: { order: AccountOrder; pair: MarketPair; onCancel: (order: AccountOrder) => void }) {
  const isBuy = order.sellSymbol === pair.quote && order.receiveSymbol === pair.base;
  return <article className="rn-trade-order-row">
    <div className="rn-trade-order-top"><strong>{order.sellSymbol} → {order.receiveSymbol}</strong><button type="button" onClick={() => onCancel(order)}>撤单</button></div>
    <div className={`rn-trade-order-side ${isBuy ? 'positive' : 'negative'}`}>限价 / {isBuy ? '买入' : '卖出'} <time>{order.expiration ? new Date(`${order.expiration}Z`).toLocaleString() : '--'}</time></div>
    <div><span>成交数量 / 数量</span><b>{amountText(order.sellAmount)} / {amountText(order.receiveAmount)}</b></div>
    <div><span>价格</span><b>{priceText(order.price)}</b></div>
  </article>;
}

export function TradePage() {
  const params = useParams<{ base?: string; quote?: string }>();
  const pair = useMemo<MarketPair>(() => ({ base: params.base?.toUpperCase() || defaultPair.base, quote: params.quote?.toUpperCase() || defaultPair.quote }), [params.base, params.quote]);
  const { session, ensureSigningKey } = useAuth();
  const { status, tickers, loadLimitOrderPreview, loadOrderBook, loadAccountAssets, loadAccountOrders, loadCancelOrderPreview, signOperation, broadcastTransaction } = useChain();
  const ticker = tickers.find(item => item.base === pair.base && item.quote === pair.quote);
  const [book, setBook] = useState<OrderBookData | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AccountAssetBalance[]>([]);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [side, setSide] = useState<Side>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [total, setTotal] = useState('');
  const [slider, setSlider] = useState(0);
  const [showOrderType, setShowOrderType] = useState(false);
  const [bottomTab, setBottomTab] = useState<'orders' | 'positions'>('orders');
  const [hideOtherPairs, setHideOtherPairs] = useState(true);
  const [preview, setPreview] = useState<LimitOrderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshAccount = useCallback(async () => {
    if (!session || status !== 'connected') return;
    try {
      const [assetResult, orderResult] = await Promise.all([loadAccountAssets(session.account.id), loadAccountOrders(session.account.id)]);
      setAssets(assetResult.balances); setOrders(orderResult.orders);
    } catch (cause) { setError(formatGrapheneError(cause)); }
  }, [loadAccountAssets, loadAccountOrders, session, status]);
  useEffect(() => {
    let live = true;
    setBook(null); setBookError(null);
    if (status !== 'connected') return () => { live = false; };
    void loadOrderBook(pair).then(value => live && setBook(value)).catch(cause => live && setBookError(cause instanceof Error ? cause.message : '盘口加载失败'));
    return () => { live = false; };
  }, [loadOrderBook, pair, status]);
  useEffect(() => { void refreshAccount(); }, [refreshAccount, pair]);
  useEffect(() => { if (!price && ticker?.latest) setPrice(priceText(ticker.latest)); }, [price, ticker?.latest]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const baseBalance = assets.find(item => item.symbol === pair.base)?.amount ?? 0;
  const quoteBalance = assets.find(item => item.symbol === pair.quote)?.amount ?? 0;
  const referencePrice = ticker?.latest || Number(price) || 0;
  const calcPrice = orderType === 'market' ? referencePrice : Number(price);
  const maxAmount = side === 'buy' ? (calcPrice > 0 ? quoteBalance / calcPrice : 0) : baseBalance;
  const available = side === 'buy' ? quoteBalance : baseBalance;
  const availableUnit = side === 'buy' ? pair.quote : pair.base;
  const tradeAvailable = side === 'buy' ? maxAmount : (calcPrice > 0 ? baseBalance * calcPrice : 0);
  const tradeUnit = side === 'buy' ? pair.base : pair.quote;
  const visibleOrders = hideOtherPairs ? orders.filter(order => [order.sellSymbol, order.receiveSymbol].includes(pair.base) && [order.sellSymbol, order.receiveSymbol].includes(pair.quote)) : orders;

  const setSideAndReset = (next: Side) => { setSide(next); setAmount(''); setTotal(''); setSlider(0); setPreview(null); setError(null); };
  const recalcFromAmount = (value: string) => { setAmount(value); const n = Number(value); setTotal(n > 0 && calcPrice > 0 ? (n * calcPrice).toFixed(2) : ''); setSlider(maxAmount > 0 && n > 0 ? Math.min(100, Math.round(n / maxAmount * 100)) : 0); };
  const recalcFromTotal = (value: string) => { setTotal(value); const n = Number(value); const next = n > 0 && calcPrice > 0 ? (n / calcPrice).toFixed(4) : ''; setAmount(next); setSlider(maxAmount > 0 && Number(next) > 0 ? Math.min(100, Math.round(Number(next) / maxAmount * 100)) : 0); };
  const setSliderValue = (value: number) => { setSlider(value); const next = maxAmount * value / 100; setAmount(next > 0 ? next.toFixed(4) : ''); setTotal(next > 0 && calcPrice > 0 ? (next * calcPrice).toFixed(2) : ''); };
  const setPriceValue = (value: string) => { setPrice(value); if (amount && Number(value) > 0) setTotal((Number(amount) * Number(value)).toFixed(2)); };
  const fillPrice = (value: number) => setPriceValue(priceText(value));

  async function createPreview(): Promise<LimitOrderPreview> {
    if (!session) throw new Error('请先登录账户');
    const amountValue = Number(amount);
    if (!amount || !Number.isFinite(amountValue) || amountValue <= 0) throw new Error('请输入有效的数量');
    if (side === 'sell' && amountValue > baseBalance) throw new Error(`${pair.base} 余额不足`);
    if (side === 'buy' && Number(total) > quoteBalance) throw new Error(`${pair.quote} 余额不足`);
    if (orderType === 'limit' && (!price || Number(price) <= 0)) throw new Error('请输入有效的价格');
    if (!calcPrice || calcPrice <= 0) throw new Error('当前交易对暂无有效行情，请使用限价委托');
    const executionPrice = orderType === 'market' ? (side === 'buy' ? calcPrice * 2 : calcPrice * 0.5) : calcPrice;
    return loadLimitOrderPreview({ accountNameOrId: session.account.id, baseSymbolOrId: pair.base, quoteSymbolOrId: pair.quote, side, amount, price: String(executionPrice) });
  }
  async function submitOrder() {
    if (!session) { setError('请先登录账户'); return; }
    setLoading(true); setError(null); setNotice(null); setPreview(null);
    try {
      const nextPreview = await createPreview();
      setPreview(nextPreview);
      const signer = await ensureSigningKey();
      if (signer.verifiedRole !== 'active') throw new Error('当前密钥只匹配 owner 权限，交易需要 active 权限密钥');
      const signed = await signOperation('limit_order_create', { ...nextPreview.operation, fee: { amount: nextPreview.fee.atomic, asset_id: nextPreview.fee.assetId } }, signer.privateKeyWif);
      await broadcastTransaction(signed);
      const orderLabel = side === 'buy' ? '买单' : '卖单';
      setNotice(orderType === 'limit' ? `限价${orderLabel}已挂单：${amount} ${pair.base}` : `市价${orderLabel}已提交：${amount} ${pair.base}`);
      setAmount(''); setTotal(''); setSlider(0); await refreshAccount();
    } catch (cause) { setError(formatGrapheneError(cause)); } finally { setLoading(false); }
  }
  async function cancelOrder(order: AccountOrder) {
    if (!session) return;
    setLoading(true); setError(null);
    try {
      const cancel = await loadCancelOrderPreview(session.account.id, order.id);
      const signer = await ensureSigningKey();
      if (signer.verifiedRole !== 'active') throw new Error('当前密钥只匹配 owner 权限，撤单需要 active 权限密钥');
      const signed = await signOperation('limit_order_cancel', { ...cancel.operation, fee: { amount: cancel.fee.atomic, asset_id: cancel.fee.assetId } }, signer.privateKeyWif);
      await broadcastTransaction(signed); setNotice('撤单成功'); await refreshAccount();
    } catch (cause) { setError(formatGrapheneError(cause)); } finally { setLoading(false); }
  }
  async function cancelAll() {
    if (!visibleOrders.length || !session) { setNotice('暂无可撤销的委托'); return; }
    setLoading(true); setError(null);
    try { const signer = await ensureSigningKey(); if (signer.verifiedRole !== 'active') throw new Error('当前密钥只匹配 owner 权限，撤单需要 active 权限密钥'); for (const order of visibleOrders) { const cancel = await loadCancelOrderPreview(session.account.id, order.id); const signed = await signOperation('limit_order_cancel', { ...cancel.operation, fee: { amount: cancel.fee.atomic, asset_id: cancel.fee.assetId } }, signer.privateKeyWif); await broadcastTransaction(signed); } setNotice(`成功撤销 ${visibleOrders.length} 笔委托`); await refreshAccount(); }
    catch (cause) { setError(formatGrapheneError(cause)); } finally { setLoading(false); }
  }

  return <div className="rn-trade-page">
    <header className="rn-trade-header"><h1>{pair.base}/{pair.quote}</h1><div><Link className="rn-trade-kline-icon" to={`/markets/${pair.base}/${pair.quote}/kline`} aria-label="K线"><KlineCandlestickIcon /></Link><Link className="rn-trade-settings-icon" to="/settings" aria-label="设置"><SettingsGearIcon /></Link></div></header>
    <main className="rn-trade-content">
      <div className="rn-trade-main-grid">
        <section className="rn-trade-form-panel">
          <div className="rn-trade-side-tabs"><button type="button" className={side === 'buy' ? 'active buy' : ''} onClick={() => setSideAndReset('buy')}>买入</button><button type="button" className={side === 'sell' ? 'active sell' : ''} onClick={() => setSideAndReset('sell')}>卖出</button></div>
          <button type="button" className="rn-trade-type-select" onClick={() => setShowOrderType(true)}><span>{orderType === 'limit' ? '限价委托' : '市价委托'} <small>ⓘ</small></span><b>⌄</b></button>
          {orderType === 'limit' && <label className="rn-trade-field"><span>价格 ({pair.quote})</span><div><input inputMode="decimal" value={price} onChange={event => setPriceValue(event.target.value)} placeholder="0"/><b>{pair.quote}</b></div></label>}
          <label className="rn-trade-field"><span>数量</span><div><input inputMode="decimal" value={amount} onChange={event => recalcFromAmount(event.target.value)} placeholder="0"/><b>{pair.base}</b></div></label>
          <div className="rn-trade-slider"><input aria-label="数量比例" type="range" min="0" max="100" step="1" value={slider} onChange={event => setSliderValue(Number(event.target.value))}/><div>{sliderStops.map(stop => <button type="button" key={stop} className={slider >= stop ? 'active' : ''} onClick={() => setSliderValue(stop)} aria-label={`${stop}%`}/>)}</div></div>
          <label className="rn-trade-field"><span>{orderType === 'market' ? '预估金额' : '金额'}</span><div><input inputMode="decimal" value={total} onChange={event => recalcFromTotal(event.target.value)} placeholder="0"/><b>{pair.quote}</b></div></label>
          <div className="rn-trade-balance"><span>可用</span><strong>{amountText(available)} {availableUnit}</strong><span>ⓘ</span><span>{side === 'buy' ? '可买' : '可卖'}</span><strong>{amountText(tradeAvailable)} {tradeUnit}</strong></div>
          <button className={`rn-trade-submit ${side}`} type="button" onClick={() => void submitOrder()} disabled={loading}>{loading ? '处理中…' : `${side === 'buy' ? '买入' : '卖出'} ${pair.base}`}</button>
        </section>
        <section className="rn-trade-book-panel"><OrderBook book={book} tickerPrice={ticker?.latest ?? Number(price)} change={ticker?.change24h ?? 0} pair={pair} onPriceClick={fillPrice}/>{bookError && <p className="rn-trade-error">{bookError}</p>}</section>
      </div>
      <section className="rn-trade-bottom"><div className="rn-trade-bottom-tabs"><button type="button" className={bottomTab === 'orders' ? 'active' : ''} onClick={() => setBottomTab('orders')}>当前委托 ({orders.length})</button><button type="button" className={bottomTab === 'positions' ? 'active' : ''} onClick={() => setBottomTab('positions')}>持有币种 ({assets.length})</button></div>
        {bottomTab === 'orders' ? <><div className="rn-trade-filter"><label><input type="checkbox" checked={hideOtherPairs} onChange={event => setHideOtherPairs(event.target.checked)}/>隐藏其他交易对</label><button type="button" onClick={() => void cancelAll()} disabled={loading}>撤销全部</button></div><div className="rn-trade-orders">{visibleOrders.length ? visibleOrders.map(order => <OrderRow key={order.id} order={order} pair={pair} onCancel={orderToCancel => void cancelOrder(orderToCancel)}/>) : <p className="rn-trade-empty">暂无委托</p>}</div></> : <div className="rn-trade-positions">{assets.length ? assets.map(asset => <div key={asset.assetId}><strong>{asset.symbol}</strong><span>{amountText(asset.amount)}</span></div>) : <p className="rn-trade-empty">暂无持仓</p>}</div>}
      </section>
      {error && <p className="rn-trade-error">{error}</p>}
    </main>
    {notice && <div className="rn-operation-toast success" role="status"><SuccessCheckIcon /><span>{notice}</span></div>}
    {preview && <div className="rn-trade-preview"><span>最近委托</span><strong>{preview.sell.value} {preview.sell.symbol} → {preview.receive.value} {preview.receive.symbol}</strong><small>手续费 {preview.fee.value} {preview.fee.symbol}</small></div>}
    {showOrderType && <OrderTypeSheet value={orderType} onChange={value => { setOrderType(value); if (value === 'market') setPrice(''); }} onClose={() => setShowOrderType(false)} />}
  </div>;
}
