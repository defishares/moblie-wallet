import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatPrice, type KLineData, type MarketPair, type MarketTrade, type OrderBookData } from '@defishares/core';
import { useChain } from '../state/ChainProvider';

type Interval = { value: number; label: string; key: string };
type MainIndicator = 'ma' | 'ema' | 'boll' | 'sar' | 'avl' | 'super';
const intervals: Interval[] = [
  { value: 60, label: '分时', key: 'timeline' }, { value: 60, label: '1分', key: '1m' },
  { value: 300, label: '5分', key: '5m' }, { value: 900, label: '15分', key: '15m' },
  { value: 1800, label: '30分', key: '30m' }, { value: 3600, label: '1小时', key: '1h' },
  { value: 14400, label: '4小时', key: '4h' }, { value: 86400, label: '1天', key: '1d' },
  { value: 604800, label: '7天', key: '7d' },
];
const mainIndicatorOptions: Array<{ key: MainIndicator; label: string }> = [
  { key: 'ma', label: 'MA' }, { key: 'ema', label: 'EMA' }, { key: 'boll', label: 'BOLL' },
  { key: 'sar', label: 'SAR' }, { key: 'avl', label: 'AVL' }, { key: 'super', label: 'SUPER' },
];

function movingAverage(values: number[], size: number): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - size + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function exponentialAverage(values: number[], size: number): number[] {
  const alpha = 2 / (size + 1);
  return values.reduce<number[]>((result, value, index) => {
    result.push(index === 0 ? value : value * alpha + result[index - 1] * (1 - alpha));
    return result;
  }, []);
}

function bollingerAt(values: number[], size: number): { middle: number; upper: number; lower: number } {
  const window = values.slice(Math.max(0, values.length - size));
  const middle = window.length ? window.reduce((sum, value) => sum + value, 0) / window.length : 0;
  const variance = window.length ? window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / window.length : 0;
  const deviation = Math.sqrt(variance);
  return { middle, upper: middle + deviation * 2, lower: middle - deviation * 2 };
}

function KlineCanvas({ data, mainIndicators, showVolume, showMacd, baseSymbol, quoteSymbol }: { data: KLineData[]; mainIndicators: MainIndicator[]; showVolume: boolean; showMacd: boolean; baseSymbol: string; quoteSymbol: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ start: Math.max(0, data.length - 100), end: data.length, crosshair: -1 });
  const dragRef = useRef<{ x: number; start: number; moved: boolean; selecting: boolean; timer: number | null } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ distance: number; start: number; end: number; centerIndex: number } | null>(null);
  useEffect(() => { setView({ start: Math.max(0, data.length - 100), end: data.length, crosshair: -1 }); }, [data]);
  useEffect(() => () => { if (dragRef.current?.timer !== null) window.clearTimeout(dragRef.current?.timer); }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, rect.width); const height = Math.max(300, rect.height);
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const setDash = (pattern: number[]) => {
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash(pattern);
    };
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b0e11'; ctx.fillRect(0, 0, width, height);
    const start = Math.max(0, Math.min(view.start, data.length - 1)); const end = Math.max(start + 1, Math.min(view.end, data.length));
    const rows = data.slice(start, end); const chartHeight = showVolume || showMacd ? height * .68 : height * .84; const left = 8; const right = 56; const top = 18; const bottom = 24;
    const min = Math.min(...rows.map(item => item.low)); const max = Math.max(...rows.map(item => item.high)); const span = max - min || Math.max(1, max * .01);
    const x = (index: number) => left + index * ((width - left - right) / Math.max(1, rows.length - 1));
    const y = (price: number) => top + (max - price) / span * (chartHeight - top - bottom);
    ctx.strokeStyle = '#202830'; ctx.lineWidth = 1; ctx.font = '10px system-ui';
    for (let i = 0; i < 5; i += 1) { const yy = top + i * ((chartHeight - top - bottom) / 4); ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - right, yy); ctx.stroke(); ctx.fillStyle = '#6f7b86'; ctx.fillText(formatPrice(max - i * span / 4), width - right + 6, yy + 3); }
    const closes = rows.map(item => item.close); const highs = rows.map(item => item.high); const lows = rows.map(item => item.low);
    const drawLine = (values: number[], color: string, lineWidth = 1.2) => { ctx.beginPath(); values.forEach((value, index) => { const xx = x(index); const yy = y(value); if (index === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); }); ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke(); };
    const drawDots = (values: number[], color: string) => values.forEach((value, index) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(index), y(value), 1.8, 0, Math.PI * 2); ctx.fill(); });
    if (mainIndicators.includes('ma')) { drawLine(movingAverage(closes, 20), '#b12867'); drawLine(movingAverage(closes, 45), '#82d9cb'); drawLine(movingAverage(closes, 60), '#8790d2'); }
    if (mainIndicators.includes('ema')) drawLine(exponentialAverage(closes, 20), '#f3c969');
    if (mainIndicators.includes('boll')) { const middle = movingAverage(closes, 20); drawLine(middle, '#f3c969'); drawLine(middle.map((value, index) => value + (highs[index] - lows[index]) * 1.8), '#8ab4ff'); drawLine(middle.map((value, index) => value - (highs[index] - lows[index]) * 1.8), '#8ab4ff'); }
    if (mainIndicators.includes('sar')) drawDots(rows.map((item, index) => index % 2 ? item.low - (item.high - item.low) * .25 : item.high + (item.high - item.low) * .25), '#dca8ff');
    if (mainIndicators.includes('avl')) drawLine(movingAverage(closes, 30), '#e8a45b');
    if (mainIndicators.includes('super')) drawLine(movingAverage(closes, 10).map((value, index) => value + (closes[index] >= value ? 1 : -1) * (highs[index] - lows[index]) * .8), '#4dd0e1', 1.5);
    const candleWidth = Math.max(2, Math.min(14, (width - left - right) / rows.length * .68));
    rows.forEach((item, index) => { const xx = x(index); const up = item.close >= item.open; const color = up ? '#00d094' : '#ff4757'; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(xx, y(item.high)); ctx.lineTo(xx, y(item.low)); ctx.stroke(); const topBody = y(Math.max(item.open, item.close)); const bodyHeight = Math.max(1.5, Math.abs(y(item.open) - y(item.close))); ctx.fillRect(xx - candleWidth / 2, topBody, candleWidth, bodyHeight); });
    if (showVolume) { const volumeTop = chartHeight + 12; const volumeHeight = height * .12; const maxVolume = Math.max(...rows.map(item => item.volume), 1); rows.forEach((item, index) => { ctx.fillStyle = item.close >= item.open ? 'rgba(0,208,148,.55)' : 'rgba(255,71,87,.55)'; const barHeight = item.volume / maxVolume * volumeHeight; ctx.fillRect(x(index) - candleWidth / 2, volumeTop + volumeHeight - barHeight, candleWidth, barHeight); }); ctx.fillStyle = '#6f7b86'; ctx.fillText('VOL', left, volumeTop + 10); }
    if (showMacd) { const macdTop = height - 62; const macd = closes.map((value, index) => value - movingAverage(closes, 12)[index]); const maxMacd = Math.max(...macd.map(Math.abs), 1); ctx.fillStyle = '#6f7b86'; ctx.fillText('MACD', left, macdTop + 10); macd.forEach((value, index) => { ctx.fillStyle = value >= 0 ? 'rgba(0,208,148,.6)' : 'rgba(255,71,87,.6)'; const barHeight = Math.abs(value) / maxMacd * 35; ctx.fillRect(x(index) - candleWidth / 2, macdTop + 28 - (value >= 0 ? barHeight : 0), candleWidth, barHeight); }); }
    const selected = view.crosshair >= start && view.crosshair < end ? data[view.crosshair] : undefined;
    if (selected) {
      const selectedOffset = view.crosshair - start;
      const xx = x(selectedOffset);
      const change = selected.close - selected.open;
      const changePercent = selected.open ? change / selected.open * 100 : 0;
      const amplitude = selected.open ? (selected.high - selected.low) / selected.open * 100 : 0;
      const compact = (value: number) => {
        const absolute = Math.abs(value);
        if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
        if (absolute >= 10_000) return `${(value / 10_000).toFixed(2)}万`;
        return formatPrice(value, 2);
      };
      const time = new Date(selected.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace('/', '-');
      const details: Array<[string, string, string?]> = [
        ['时间', time],
        ['开', formatPrice(selected.open)],
        ['高', formatPrice(selected.high)],
        ['低', formatPrice(selected.low)],
        ['收', formatPrice(selected.close)],
        ['涨跌', `${change >= 0 ? '+' : ''}${formatPrice(change)}`, change >= 0 ? 'positive' : 'negative'],
        ['涨跌幅', `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`, changePercent >= 0 ? 'positive' : 'negative'],
        ['振幅', `${amplitude.toFixed(2)}%`],
        ['量', `${compact(selected.close ? selected.volume / selected.close : 0)} ${baseSymbol}`],
        ['额', `${compact(selected.volume)} ${quoteSymbol}`],
      ];
      ctx.font = '10px system-ui';
      const labelWidth = Math.max(...details.map(([label]) => ctx.measureText(label).width));
      const valueWidth = Math.max(...details.map(([, value]) => ctx.measureText(value).width));
      const tooltipWidth = Math.min(156, Math.max(128, labelWidth + valueWidth + 20), width - 12);
      const lineHeight = 15;
      const tooltipHeight = details.length * lineHeight + 12;
      const chartLeft = left + 6;
      const chartRight = width - right - 6;
      const tooltipX = xx <= (chartLeft + chartRight) / 2 ? chartRight - tooltipWidth : chartLeft;
      const tooltipY = Math.max(8, Math.min(height - tooltipHeight - 8, y(selected.high) - tooltipHeight / 2));
      const radius = 5;
      const roundedRect = () => {
        ctx.beginPath();
        ctx.moveTo(tooltipX + radius, tooltipY);
        ctx.lineTo(tooltipX + tooltipWidth - radius, tooltipY);
        ctx.quadraticCurveTo(tooltipX + tooltipWidth, tooltipY, tooltipX + tooltipWidth, tooltipY + radius);
        ctx.lineTo(tooltipX + tooltipWidth, tooltipY + tooltipHeight - radius);
        ctx.quadraticCurveTo(tooltipX + tooltipWidth, tooltipY + tooltipHeight, tooltipX + tooltipWidth - radius, tooltipY + tooltipHeight);
        ctx.lineTo(tooltipX + radius, tooltipY + tooltipHeight);
        ctx.quadraticCurveTo(tooltipX, tooltipY + tooltipHeight, tooltipX, tooltipY + tooltipHeight - radius);
        ctx.lineTo(tooltipX, tooltipY + radius);
        ctx.quadraticCurveTo(tooltipX, tooltipY, tooltipX + radius, tooltipY);
        ctx.closePath();
      };
      ctx.fillStyle = 'rgba(31, 40, 53, .9)'; ctx.strokeStyle = '#3a4658'; ctx.lineWidth = 1;
      roundedRect(); ctx.fill(); roundedRect(); ctx.stroke();
      details.forEach(([label, value, tone], index) => {
        const yy = tooltipY + 14 + index * lineHeight;
        ctx.textAlign = 'left'; ctx.fillStyle = '#f1f4f8'; ctx.fillText(label, tooltipX + 8, yy);
        ctx.textAlign = 'right'; ctx.fillStyle = tone === 'positive' ? '#00d094' : tone === 'negative' ? '#ff5b6b' : '#f1f4f8'; ctx.fillText(value, tooltipX + tooltipWidth - 8, yy);
      });
      ctx.textAlign = 'left';
      ctx.strokeStyle = '#aab4bd'; setDash([4, 4]); ctx.beginPath(); ctx.moveTo(xx, top); ctx.lineTo(xx, height - bottom); ctx.stroke(); setDash([]);
    }
  }, [baseSymbol, data, mainIndicators, quoteSymbol, showMacd, showVolume, view]);
  const getIndexAtClientX = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.min(view.end - 1, Math.max(view.start, view.start + Math.round(ratio * Math.max(0, view.end - view.start - 1))));
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* iOS WebView may reject capture for a touch pointer */ }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2) {
      const points = Array.from(pointersRef.current.values()).slice(0, 2);
      const firstPoint = points[0]; const secondPoint = points[1];
      const centerX = (firstPoint.x + secondPoint.x) / 2;
      const distance = Math.max(1, Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y));
      if (dragRef.current?.timer !== null && dragRef.current) window.clearTimeout(dragRef.current.timer);
      dragRef.current = null;
      pinchRef.current = { distance, start: view.start, end: view.end, centerIndex: getIndexAtClientX(centerX) };
      return;
    }
    const interaction = { x: event.clientX, start: view.start, moved: false, selecting: false, timer: null as number | null };
    interaction.timer = window.setTimeout(() => {
      if (dragRef.current !== interaction || interaction.moved) return;
      interaction.selecting = true;
      const current = getIndexAtClientX(interaction.x);
      if (current >= 0) setView(viewState => ({ ...viewState, crosshair: current }));
    }, 350);
    dragRef.current = interaction;
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const points = Array.from(pointersRef.current.values()).slice(0, 2);
      const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
      const pinch = pinchRef.current;
      const initialWidth = pinch.end - pinch.start;
      const minWidth = Math.min(24, data.length);
      const nextWidth = Math.max(minWidth, Math.min(data.length, Math.round(initialWidth * pinch.distance / distance)));
      const anchorRatio = initialWidth > 1 ? (pinch.centerIndex - pinch.start) / (initialWidth - 1) : .5;
      const rawStart = Math.round(pinch.centerIndex - anchorRatio * (nextWidth - 1));
      const start = Math.max(0, Math.min(data.length - nextWidth, rawStart));
      setView(current => ({ ...current, start, end: start + nextWidth, crosshair: -1 }));
      return;
    }
    const interaction = dragRef.current;
    if (!interaction) return;
    const current = getIndexAtClientX(event.clientX);
    if (interaction.selecting) {
      if (current >= 0) setView(viewState => ({ ...viewState, crosshair: current }));
      return;
    }
    if (Math.abs(interaction.x - event.clientX) <= 6) return;
    interaction.moved = true;
    if (interaction.timer !== null) { window.clearTimeout(interaction.timer); interaction.timer = null; }
    const delta = Math.round((interaction.x - event.clientX) / 7);
    const width = view.end - view.start;
    const start = Math.max(0, Math.min(data.length - width, interaction.start + delta));
    setView(viewState => ({ ...viewState, start, end: start + width, crosshair: -1 }));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = null;
    const interaction = dragRef.current;
    if (interaction && interaction.timer !== null) window.clearTimeout(interaction.timer);
    dragRef.current = null;
  };
  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => { event.preventDefault(); const width = view.end - view.start; const nextWidth = Math.max(24, Math.min(data.length, width + (event.deltaY > 0 ? 12 : -12))); const center = Math.round((view.start + view.end) / 2); const start = Math.max(0, Math.min(data.length - nextWidth, center - Math.round(nextWidth / 2))); setView(current => ({ ...current, start, end: start + nextWidth })); };
  return data.length ? <canvas ref={canvasRef} className="rn-kline-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onContextMenu={event => event.preventDefault()} onWheel={onWheel} aria-label="K线图" /> : <div className="rn-kline-empty">当前周期暂无 K 线数据</div>;
}

function OrderBookPanel({ book, pair }: { book: OrderBookData | null; pair: MarketPair }) {
  const asks = [...(book?.asks ?? [])].sort((a, b) => a.price - b.price).slice(0, 20);
  const bids = (book?.bids ?? []).slice(0, 20);
  const totalAsk = asks.reduce((sum, row) => sum + row.base, 0); const totalBid = bids.reduce((sum, row) => sum + row.base, 0); const ratio = totalAsk + totalBid ? totalBid / (totalAsk + totalBid) * 100 : 50;
  const row = (item: { price: number; base: number } | undefined, side: 'buy' | 'sell', index: number) => <div className="rn-kline-book-row" key={`${side}-${index}`}><span className={side === 'buy' ? 'positive' : 'negative'}>{item ? formatPrice(item.price, 8) : '--'}</span><span>{item ? formatPrice(item.base, 8) : '--'}</span></div>;
  return <div className="rn-kline-orderbook"><div className="rn-kline-ratio"><span>{ratio.toFixed(2)}%</span><i><b style={{ width: `${ratio}%` }} /><b style={{ width: `${100 - ratio}%` }} /></i><span>{(100 - ratio).toFixed(2)}%</span></div><div className="rn-kline-book-head"><span>买 ({pair.quote})</span><span>卖 ({pair.base})</span></div><div className="rn-kline-book-columns"><div>{Array.from({ length: 20 }, (_, index) => row(bids[index], 'buy', index))}</div><div>{Array.from({ length: 20 }, (_, index) => row(asks[index], 'sell', index))}</div></div></div>;
}

export function KlinePage() {
  const params = useParams<{ base: string; quote: string }>();
  const pair = useMemo<MarketPair>(() => ({ base: params.base?.toUpperCase() || 'DFS', quote: params.quote?.toUpperCase() || 'CNY' }), [params.base, params.quote]);
  const { tickers, favoriteKeys, toggleFavorite, loadKlines, loadOrderBook, loadRecentTrades } = useChain();
  const ticker = tickers.find(item => item.base === pair.base && item.quote === pair.quote);
  const [interval, setInterval] = useState<Interval>(intervals[5]);
  const [data, setData] = useState<KLineData[]>([]); const [book, setBook] = useState<OrderBookData | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<MarketTrade[]>([]); const [tradesLoading, setTradesLoading] = useState(false); const [tradesError, setTradesError] = useState<string | null>(null); const [tradesReload, setTradesReload] = useState(0);
  const [contentTab, setContentTab] = useState<'market' | 'overview' | 'data'>('market'); const [bottomTab, setBottomTab] = useState<'orderbook' | 'trades'>('orderbook'); const [mainIndicators, setMainIndicators] = useState<MainIndicator[]>(['ma']); const [showVolume, setShowVolume] = useState(true); const [showMacd, setShowMacd] = useState(true); const [showMoreIntervals, setShowMoreIntervals] = useState(false); const [showIndicatorSettings, setShowIndicatorSettings] = useState(false);
  const favorite = favoriteKeys.includes(`${pair.base}_${pair.quote}`);
  const toggleMainIndicator = (indicator: MainIndicator) => setMainIndicators(current => current.includes(indicator) ? current.filter(item => item !== indicator) : [...current, indicator]);
  useEffect(() => { let live = true; setLoading(true); setError(null); void Promise.all([loadKlines(pair, interval.value), loadOrderBook(pair)]).then(([lines, nextBook]) => { if (!live) return; setData(lines); setBook(nextBook); }).catch(cause => live && setError(cause instanceof Error ? cause.message : 'K线加载失败')).finally(() => live && setLoading(false)); return () => { live = false; }; }, [interval, loadKlines, loadOrderBook, pair]);
  useEffect(() => {
    if (bottomTab !== 'trades') return;
    let live = true;
    setTradesLoading(true);
    setTradesError(null);
    void loadRecentTrades(pair, 30).then(rows => { if (live) setTrades(rows); }).catch(cause => { if (live) { setTrades([]); setTradesError(cause instanceof Error ? cause.message : '最新成交加载失败'); } }).finally(() => { if (live) setTradesLoading(false); });
    return () => { live = false; };
  }, [bottomTab, loadRecentTrades, pair, tradesReload]);
  const latest = data.length ? data[data.length - 1] : undefined; const first = data[0]; const latestPrice = latest?.close ?? ticker?.latest ?? 0; const change = first?.open ? (latestPrice - first.open) / first.open * 100 : ticker?.change24h ?? 0; const high = data.length ? Math.max(...data.map(item => item.high)) : 0; const low = data.length ? Math.min(...data.map(item => item.low)) : 0; const volume = data.reduce((sum, item) => sum + item.volume, 0); const closes = data.map(item => item.close); const ma20Values = movingAverage(closes, 20); const ma45Values = movingAverage(closes, 45); const ma60Values = movingAverage(closes, 60); const ema20Values = exponentialAverage(closes, 20); const ma20 = ma20Values.length ? ma20Values[ma20Values.length - 1] : 0; const ma45 = ma45Values.length ? ma45Values[ma45Values.length - 1] : 0; const ma60 = ma60Values.length ? ma60Values[ma60Values.length - 1] : 0; const ema20 = ema20Values.length ? ema20Values[ema20Values.length - 1] : 0; const boll = bollingerAt(closes, 20);
  return <div className="rn-kline-page">
    <header className="rn-kline-header"><Link to={`/trade/${pair.base}/${pair.quote}`} aria-label="返回">‹</Link><h1>{pair.base}/{pair.quote}</h1><button type="button" className={favorite ? 'favorite active' : 'favorite'} onClick={() => void toggleFavorite(`${pair.base}_${pair.quote}`)} aria-label="收藏">★</button></header>
    <main className="rn-kline-scroll">
      <nav className="rn-kline-content-tabs">{([['market', '行情'], ['overview', '概况'], ['data', '数据']] as const).map(([key, label]) => <button type="button" key={key} className={contentTab === key ? 'active' : ''} onClick={() => setContentTab(key)}>{label}</button>)}</nav>
      <section className="rn-kline-price-info"><div className="rn-kline-price-main"><span>最新价格⌄</span><strong className={change >= 0 ? 'positive' : 'negative'}>{formatPrice(latestPrice)}</strong><small>${formatPrice(latestPrice)} <b className={change >= 0 ? 'positive' : 'negative'}>24h {change >= 0 ? '+' : ''}{change.toFixed(2)}%</b></small></div><div className="rn-kline-stats"><div><span>24小时最高</span><b>{formatPrice(high)}</b></div><div><span>24小时最低</span><b>{formatPrice(low)}</b></div><div><span>24小时量({pair.base})</span><b>{formatPrice(volume, 2)}</b></div><div><span>24小时额({pair.quote})</span><b>{formatPrice(volume * latestPrice, 2)}</b></div></div></section>
      <div className="rn-kline-chart-card"><div className="rn-kline-periods">{(showMoreIntervals ? intervals : intervals.filter(item => ['timeline', '15m', '1h', '4h', '1d'].includes(item.key))).map(item => <button type="button" key={item.key} className={interval.key === item.key ? 'active' : ''} onClick={() => setInterval(item)}>{item.label}</button>)}<button type="button" className="more-periods" onClick={() => setShowMoreIntervals(value => !value)}>{showMoreIntervals ? '收起' : '更多'}⌄</button><button type="button" className="chart-tool" onClick={() => setShowIndicatorSettings(true)} aria-label="指标设置">⚙</button><button type="button" className="chart-tool" onClick={() => setInterval(current => ({ ...current }))} aria-label="刷新">↻</button></div><div className="rn-kline-chart-legend">{mainIndicators.includes('ma') && <span className="ma-legend">MA(20): {formatPrice(ma20)}　MA(45): {formatPrice(ma45)}　MA(60): {formatPrice(ma60)}</span>}{mainIndicators.includes('ema') && <span className="ema-legend">EMA(20): {formatPrice(ema20)}</span>}{mainIndicators.includes('boll') && <span className="boll-legend">BOLL(20): {formatPrice(boll.middle)}　UP: {formatPrice(boll.upper)}　DN: {formatPrice(boll.lower)}</span>}</div><div className="rn-kline-indicators"><button type="button" className={mainIndicators.length === 0 ? 'active' : ''} onClick={() => setShowIndicatorSettings(true)}>主图</button>{mainIndicatorOptions.map(item => <button type="button" key={item.key} className={mainIndicators.includes(item.key) ? 'active' : ''} onClick={() => toggleMainIndicator(item.key)}>{item.label}</button>)}<i /><button type="button" className={showVolume ? 'active' : ''} onClick={() => setShowVolume(value => !value)}>VOL</button><button type="button" className={showMacd ? 'active' : ''} onClick={() => setShowMacd(value => !value)}>MACD</button><button type="button" className="indicator-settings" onClick={() => setShowIndicatorSettings(true)} aria-label="自定义指标">☷</button></div>{loading ? <div className="rn-kline-empty">加载 K 线中…</div> : error ? <div className="rn-kline-empty rn-kline-error">{error}</div> : <KlineCanvas data={data} mainIndicators={mainIndicators} showVolume={showVolume} showMacd={showMacd} baseSymbol={pair.base} quoteSymbol={pair.quote}/>}</div>
      <section className="rn-kline-bottom"><nav><button type="button" className={bottomTab === 'orderbook' ? 'active' : ''} onClick={() => setBottomTab('orderbook')}>委托订单</button><button type="button" className={bottomTab === 'trades' ? 'active' : ''} onClick={() => setBottomTab('trades')}>最新成交</button></nav>{bottomTab === 'orderbook' ? <OrderBookPanel book={book} pair={pair}/> : tradesLoading ? <div className="rn-kline-empty rn-kline-trades-empty"><span>◷</span><strong>最新成交</strong><small>加载中...</small></div> : tradesError ? <div className="rn-kline-empty rn-kline-trades-empty"><span>!</span><strong>最新成交加载失败</strong><small>{tradesError}</small><button type="button" onClick={() => setTradesReload(value => value + 1)}>重新加载</button></div> : trades.length === 0 ? <div className="rn-kline-empty rn-kline-trades-empty"><span>◷</span><strong>最新成交</strong><small>暂无成交记录</small></div> : <div className="rn-kline-trades"><div className="rn-kline-trade-head"><span>时间</span><span>价格({pair.quote})</span><span>数量({pair.base})</span></div>{trades.map((trade, index) => <div className="rn-kline-trade-row" key={`${trade.timestamp}-${index}`}><span>{new Date(trade.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span><b className={trade.isSell ? 'negative' : 'positive'}>{formatPrice(trade.price, 8)}</b><span>{formatPrice(trade.amount, 8)}</span></div>)}</div>}</section>
    </main>
    <footer className="rn-kline-actions"><Link to={`/trade/${pair.base}/${pair.quote}`}>交易</Link><button type="button" onClick={() => window.alert('网格功能敬请期待')}>▦<small>网格</small></button></footer>
    {showIndicatorSettings && <div className="rn-kline-settings-backdrop" role="presentation" onClick={() => setShowIndicatorSettings(false)}><section className="rn-kline-settings" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><div className="rn-kline-settings-head"><h2>指标设置</h2><button type="button" onClick={() => setShowIndicatorSettings(false)}>×</button></div><p>选择要显示在主图或副图中的指标</p><h3>主图指标</h3><div className="rn-kline-settings-grid">{mainIndicatorOptions.map(item => <button type="button" key={item.key} className={mainIndicators.includes(item.key) ? 'active' : ''} onClick={() => toggleMainIndicator(item.key)}>{item.label}<small>{mainIndicators.includes(item.key) ? '已显示' : '点击添加'}</small></button>)}</div><h3>副图指标</h3><div className="rn-kline-settings-grid"><button type="button" className={showVolume ? 'active' : ''} onClick={() => setShowVolume(value => !value)}>VOL<small>{showVolume ? '已显示' : '点击添加'}</small></button><button type="button" className={showMacd ? 'active' : ''} onClick={() => setShowMacd(value => !value)}>MACD<small>{showMacd ? '已显示' : '点击添加'}</small></button></div><button className="rn-kline-settings-done" type="button" onClick={() => setShowIndicatorSettings(false)}>完成</button></section></div>}
  </div>;
}
