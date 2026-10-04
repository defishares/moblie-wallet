import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatCompact, type MarketTicker } from '@defishares/core';
import { useChain } from '../state/ChainProvider';

function AssetIcon({ symbol }: { symbol: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <span className="asset-badge asset-icon-fallback">{symbol.slice(0, 1)}</span>;
  return <span className="asset-badge asset-icon-wrap"><img src={`/assets/coins/${encodeURIComponent(symbol.toUpperCase())}.png`} alt="" onError={() => setMissing(true)} /></span>;
}

function formatApproximatePrice(price: number, quote: string) {
  const formatted = formatMarketPrice(price);
  const prefix = quote === 'CNY' ? '¥' : quote === 'USD' ? '$' : quote === 'EUR' ? '€' : '';
  return prefix ? `≈ ${prefix}${formatted}` : `≈ ${formatted} ${quote}`;
}

function formatMarketPrice(price: number) {
  if (!Number.isFinite(price)) return '--';
  return price < 1 ? price.toFixed(5) : price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function MarketRow({ ticker }: { ticker: MarketTicker }) {
  const { favoriteKeys, toggleFavorite } = useChain();
  const navigate = useNavigate();
  const favorite = favoriteKeys.includes(ticker.key);
  const klinePath = `/markets/${ticker.base}/${ticker.quote}/kline`;
  const openKline = () => navigate(klinePath);
  return (
    <div className="market-row" role="link" tabIndex={0} onClick={openKline} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openKline(); } }}>
      <button className={favorite ? 'star active' : 'star'} onClick={event => { event.stopPropagation(); void toggleFavorite(ticker.key); }} aria-label={favorite ? '取消收藏' : '收藏'}>{favorite ? '★' : '☆'}</button>
      <Link className="pair-cell" to={klinePath} onClick={event => event.stopPropagation()}><AssetIcon symbol={ticker.base} /><span><strong>{ticker.base}</strong><small>{ticker.quote}</small></span></Link>
      <span className="price-cell"><strong>{formatMarketPrice(ticker.latest)}</strong><small>{formatApproximatePrice(ticker.latest, ticker.quote)}</small></span>
      <span className={ticker.change24h >= 0 ? 'number-cell positive' : 'number-cell negative'}>{ticker.change24h >= 0 ? '+' : ''}{ticker.change24h.toFixed(2)}%</span>
      <span className="number-cell muted">{formatCompact(ticker.quoteVolume)} {ticker.quote}</span>
      <Link className="table-action" to={klinePath} onClick={event => event.stopPropagation()}>K线</Link>
    </div>
  );
}
