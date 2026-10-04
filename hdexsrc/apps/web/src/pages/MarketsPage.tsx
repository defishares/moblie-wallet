import { useMemo, useState } from 'react';
import { MarketRow } from '../components/MarketRow';
import { useChain } from '../state/ChainProvider';

export function MarketsPage() {
  const { tickers, favoriteKeys, addCustomPair } = useChain();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'change' | 'volume' | 'price'>('volume');
  const [category, setCategory] = useState<'favorites' | 'main'>('main');
  const [quote, setQuote] = useState('');
  const [pairOpen, setPairOpen] = useState(false);
  const [base, setBase] = useState('');
  const [pairQuote, setPairQuote] = useState('');
  const [message, setMessage] = useState('');
  const markets = useMemo(() => tickers.filter(item => category !== 'favorites' || favoriteKeys.includes(item.key)).filter(item => !quote || item.quote === quote).filter(item => `${item.base}${item.quote}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'change' ? b.change24h - a.change24h : sort === 'price' ? b.latest - a.latest : b.quoteVolume - a.quoteVolume), [category, favoriteKeys, query, quote, sort, tickers]);
  const quotes = useMemo(() => [...new Set(tickers.map(item => item.quote))].sort(), [tickers]);
  async function submitPair() { try { await addCustomPair({ base, quote: pairQuote }); setMessage('交易对已添加'); setBase(''); setPairQuote(''); setPairOpen(false); } catch (cause) { setMessage(cause instanceof Error ? cause.message : '交易对添加失败'); } }
  return <div className="rn-page rn-markets-page"><div className="rn-markets-toolbar"><div className="rn-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索币种" /><span className="rn-search-hot">⌁</span></div><button className="rn-market-add" type="button" onClick={() => setPairOpen(true)} aria-label="添加交易对">＋</button></div><div className="rn-category-tabs"><button className={category === 'favorites' ? 'active' : ''} onClick={() => setCategory('favorites')}>自选</button><button className={category === 'main' ? 'active' : ''} onClick={() => setCategory('main')}>主区</button><label className="rn-market-quote"><select value={quote} onChange={event => setQuote(event.target.value)}><option value="">全部</option>{quotes.map(item => <option key={item}>{item}</option>)}</select><span>⌄</span></label></div><div className="rn-market-table-head"><button onClick={() => setSort('volume')}>名称 / 成交额</button><button onClick={() => setSort('price')}>最新价</button><button onClick={() => setSort('change')}>24h涨跌幅</button></div><div className="rn-market-list">{markets.length ? markets.map(ticker => <MarketRow key={ticker.key} ticker={ticker} />) : <div className="empty-state">{category === 'favorites' ? '暂无自选' : '暂无行情数据，请检查节点连接'}</div>}</div>{message && <button className="rn-toast" type="button" onClick={() => setMessage('')}>{message}</button>}{pairOpen && <div className="rn-sheet-backdrop" role="presentation" onClick={() => setPairOpen(false)}><section className="rn-market-pair-sheet" role="dialog" aria-label="添加交易对" onClick={event => event.stopPropagation()}><span className="rn-sheet-handle"/><h3>添加交易对</h3><label>基础资产<input value={base} onChange={event => setBase(event.target.value.toUpperCase())} placeholder="DFS" /></label><label>计价资产<input value={pairQuote} onChange={event => setPairQuote(event.target.value.toUpperCase())} placeholder="CNY" /></label><button className="rn-pill-button primary" type="button" onClick={() => void submitPair()}>添加</button><button className="rn-sheet-cancel" type="button" onClick={() => setPairOpen(false)}>取消</button></section></div>}</div>;
}
