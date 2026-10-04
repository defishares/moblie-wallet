import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AccountHistoryEntry, AssetObject } from '@defishares/core';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { RNScreenHeader } from '../components/RNScreenHeader';

type HistoryFilter = 'all' | 'transfer' | 'trade' | 'order' | 'liquidity' | 'other';
type HistoryAsset = Pick<AssetObject, 'id' | 'symbol' | 'precision'>;
type Amount = { amount?: string | number; asset_id?: string };
type HistorySegment = { text: string; tone?: 'accent' | 'asset' | 'muted' };
type ParsedHistory = { title: string; message: HistorySegment[]; changes: Array<{ value: string; positive: boolean }>; fee: string };

const filterLabels: Record<HistoryFilter, string> = { all: '全部', transfer: '转账', trade: '成交', order: '订单', liquidity: '流动性', other: '其他' };
const operationLabels: Record<number, string> = {
  0: '转账', 1: '创建限价单', 2: '取消限价单', 3: '更新债仓', 4: '订单成交', 5: '创建账户', 6: '更新账户',
  10: '创建资产', 12: '发行资产', 59: '创建流动性池', 60: '删除流动性池', 61: '增加流动性', 62: '提取流动性', 63: '闪兑', 75: '更新流动性池',
};

function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function category(type: number): HistoryFilter { if (type === 0) return 'transfer'; if (type === 4) return 'trade'; if ([1, 2].includes(type)) return 'order'; if ([59, 60, 61, 62, 63, 75].includes(type)) return 'liquidity'; return 'other'; }
function formatTime(value?: string): string { if (!value) return '时间未提供'; const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }); }
function dateKey(value?: string): string { if (!value) return '日期未知'; const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? '日期未知' : date.toLocaleDateString('zh-CN'); }
function formatAtomic(amount: Amount | undefined, assets: ReadonlyMap<string, HistoryAsset>): string {
  if (!amount || amount.amount == null) return '—';
  const asset = amount.asset_id ? assets.get(amount.asset_id) : undefined;
  if (!asset) return `${String(amount.amount)} 原始单位`;
  const raw = String(amount.amount);
  if (!/^-?\d+$/.test(raw)) return `${Number(raw).toLocaleString('zh-CN', { maximumFractionDigits: asset.precision })} ${asset.symbol}`;
  const negative = raw.startsWith('-'); const digits = (negative ? raw.slice(1) : raw).padStart(asset.precision + 1, '0');
  const point = asset.precision ? digits.length - asset.precision : digits.length;
  const whole = digits.slice(0, point).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${asset.precision ? `${whole}.${digits.slice(point)}` : whole} ${asset.symbol}`;
}
function collectReferences(value: unknown, assets = new Set<string>(), accounts = new Set<string>()): { assets: Set<string>; accounts: Set<string> } { if (Array.isArray(value)) value.forEach(item => collectReferences(item, assets, accounts)); else Object.entries(object(value)).forEach(([key, child]) => { if (key === 'asset_id' && typeof child === 'string') assets.add(child); if (['from', 'to', 'account', 'account_id', 'seller', 'owner', 'publisher', 'fee_paying_account', 'funding_account', 'borrower'].includes(key) && typeof child === 'string') accounts.add(child); if (typeof child === 'object') collectReferences(child, assets, accounts); }); return { assets, accounts }; }
function HistoryIcon({ type }: { type: number }) {
  if (type === 0) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14m0 0-4-4m4 4 4-4M17 19V5m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === 4 || type === 63) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h15l-3-3m6 8H6l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if ([59, 60, 61, 62, 75].includes(type)) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 5-8 5-8-5 8-5Zm-8 9 8 5 8-5M4 16l8 5 8-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function extractChanges(entry: AccountHistoryEntry, accountId: string, assets: ReadonlyMap<string, HistoryAsset>) {
  const operation = object(entry.operation);
  const changes: Array<{ value: string; positive: boolean }> = [];
  if (entry.operationType === 0 && operation.amount && typeof operation.amount === 'object') {
    changes.push({ value: formatAtomic(operation.amount as Amount, assets), positive: operation.to === accountId });
  } else if (entry.operationType === 4) {
    if (operation.pays && typeof operation.pays === 'object') changes.push({ value: formatAtomic(operation.pays as Amount, assets), positive: false });
    if (operation.receives && typeof operation.receives === 'object') changes.push({ value: formatAtomic(operation.receives as Amount, assets), positive: true });
  } else if (operation.amount_to_sell && typeof operation.amount_to_sell === 'object') {
    changes.push({ value: formatAtomic(operation.amount_to_sell as Amount, assets), positive: false });
  } else if (operation.fee && typeof operation.fee === 'object') {
    changes.push({ value: formatAtomic(operation.fee as Amount, assets), positive: false });
  }
  return changes;
}

function parseHistory(entry: AccountHistoryEntry, accountId: string, assets: ReadonlyMap<string, HistoryAsset>, accounts: ReadonlyMap<string, string>): ParsedHistory {
  const operation = object(entry.operation);
  const title = operationLabels[entry.operationType] || `链上操作 #${entry.operationType}`;
  const name = (id: unknown) => typeof id === 'string' ? accounts.get(id) || id : '未知账户';
  const amount = (value: unknown) => formatAtomic(value as Amount, assets);
  const asset = (value: unknown) => typeof value === 'string' ? assets.get(value)?.symbol || value : '未知资产';
  const segment = (text: string, tone?: HistorySegment['tone']): HistorySegment => ({ text, tone });
  const changes = extractChanges(entry, accountId, assets);
  let message: HistorySegment[] = [segment(`${name(operation.account || operation.from || operation.seller || operation.owner)} 执行了${title}`)];
  if (entry.operationType === 0 && operation.amount) message = [segment(`${name(operation.from)} 将 `), segment(amount(operation.amount), 'asset'), segment(` 转账给 ${name(operation.to)}`)];
  else if (entry.operationType === 1 && operation.amount_to_sell && operation.min_to_receive) {
    const sell = operation.amount_to_sell as Amount; const receive = operation.min_to_receive as Amount; const orderId = Array.isArray(entry.result) ? String(entry.result[1] || '') .split('.').pop() : '';
    const buy = assets.get(String(sell.asset_id))?.symbol !== 'DFS' && assets.get(String(receive.asset_id))?.symbol === 'DFS';
    const sellValue = Number(sell.amount) / 10 ** (assets.get(String(sell.asset_id))?.precision || 0); const receiveValue = Number(receive.amount) / 10 ** (assets.get(String(receive.asset_id))?.precision || 0); const price = sellValue > 0 && receiveValue > 0 ? (buy ? sellValue / receiveValue : receiveValue / sellValue) : 0;
    message = [segment(`${name(operation.seller)} 提交${buy ? '买单' : '卖单'}${orderId ? `#${orderId}` : ''}，以 `), segment(`${price.toFixed(5)} ${buy ? asset(sell.asset_id) + '/' + asset(receive.asset_id) : asset(receive.asset_id) + '/' + asset(sell.asset_id)}`, 'asset'), segment(` 的价格${buy ? '买入 ' : '卖出 '}`), segment(amount(buy ? receive : sell), 'asset')];
  } else if (entry.operationType === 2) message = [segment(`${name(operation.fee_paying_account)} 撤销了订单 `), segment(String(operation.order || '未知订单'), 'accent')];
  else if (entry.operationType === 3) {
    const debt = operation.delta_debt as Amount | undefined; const collateral = operation.delta_collateral as Amount | undefined;
    message = [segment(`${name(operation.funding_account || operation.borrower)} 将 `), ...(debt ? [segment(asset(debt.asset_id), 'asset'), segment(` 的债务调整了 ${amount(debt)}`)] : []), ...(collateral ? [segment(`${debt ? '，' : ''}抵押物调整了 `), segment(amount(collateral), 'asset')] : [])];
  } else if (entry.operationType === 4 && operation.pays && operation.receives) {
    const pays = operation.pays as Amount; const receives = operation.receives as Amount; const fillPrice = object(operation.fill_price); const fillBaseObject = object(fillPrice.base); const fillQuoteObject = object(fillPrice.quote); const fillBase = fillBaseObject.asset_id; const fillQuote = fillQuoteObject.asset_id; const sellsBase = fillBase ? String(pays.asset_id) === String(fillBase) : false;
    const baseAsset = assets.get(String(fillBase)); const quoteAsset = assets.get(String(fillQuote)); const baseValue = Number(fillBaseObject.amount) / 10 ** (baseAsset?.precision || 0); const quoteValue = Number(fillQuoteObject.amount) / 10 ** (quoteAsset?.precision || 0); const tradePrice = baseValue > 0 && quoteValue > 0 ? quoteValue / baseValue : 0;
    const priceText = tradePrice > 0 ? `${tradePrice.toFixed(5)} ${quoteAsset?.symbol || asset(fillQuote)}/${baseAsset?.symbol || asset(fillBase)}` : '成交价';
    message = [segment(`${name(operation.account_id)} 以 `), segment(priceText, 'asset'), segment(` 的价格${sellsBase ? '卖出了 ' : '买入 '}`), segment(amount(sellsBase ? pays : receives), 'asset')];
  } else if (entry.operationType === 22) message = [segment(`${name(operation.fee_paying_account)} 提交了一项治理提案`)];
  else if (entry.operationType === 19) message = [segment(`${name(operation.publisher)} 发布了 ${asset(operation.asset_id)} 的喂价`)];
  else if ([59, 60, 61, 62, 63, 75].includes(entry.operationType)) message = [segment(`${name(operation.account)} 完成了${title}`)];
  const fee = operation.fee ? amount(operation.fee) : '';
  return { title, message, changes, fee };
}

function renderMessage(message: HistorySegment[]) { return message.map((part, index) => <span className={part.tone || ''} key={`${part.text}-${index}`}>{part.text}</span>); }

export function TransactionHistoryPage() {
  const { session } = useAuth();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { client, loadAccountHistory } = useChain();
  const [records, setRecords] = useState<AccountHistoryEntry[]>([]);
  const [assets, setAssets] = useState<Map<string, HistoryAsset>>(new Map());
  const [accounts, setAccounts] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError('');
    try {
      const rows = await loadAccountHistory(session.account.id, 100);
      setRecords(rows);
      const refs = collectReferences(rows.map(row => row.raw));
      const [loaded, accountRows] = await Promise.all([
        refs.assets.size ? client.lookupAssets([...refs.assets]) : Promise.resolve([]),
        refs.accounts.size ? client.getFullAccounts([...refs.accounts]) : Promise.resolve([]),
      ]);
      setAssets(new Map(loaded.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)).map(asset => [asset.id, { id: asset.id, symbol: asset.symbol, precision: asset.precision }])));
      setAccounts(new Map(accountRows.map(([id, data]) => [id, data.account.name])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '交易历史加载失败'); } finally { setLoading(false); }
  }, [client, loadAccountHistory, session]);
  useEffect(() => { void refresh(); }, [refresh, reload]);

  const visible = useMemo(() => filter === 'all' ? records : records.filter(item => category(item.operationType) === filter), [filter, records]);
  const groups = useMemo(() => {
    const grouped = new Map<string, AccountHistoryEntry[]>();
    visible.forEach(item => { const key = dateKey(item.time); grouped.set(key, [...(grouped.get(key) || []), item]); });
    return [...grouped.entries()];
  }, [visible]);
  const selected = id ? records.find(item => item.id === id) : undefined;

  return <div className="page-stack rn-secondary-page rn-history-page">
    <RNScreenHeader title={selected ? '交易详情' : '交易历史'} backTo={selected ? '/history' : '/'} action={<button className="rn-header-icon" type="button" onClick={() => setReload(value => value + 1)} disabled={loading}>↻</button>} />
    {selected ? <HistoryDetail entry={selected} assets={assets} accounts={accounts} accountId={session?.account.id || ''} onBack={() => navigate('/history')} /> : <>
      <div className="rn-history-toolbar"><button type="button" onClick={() => setFilterOpen(true)}>类型 <span>⌄</span></button><span>{loading ? '同步中…' : `${visible.length} 笔`}</span></div>
      {error && <div className="inline-error">{error}<button type="button" onClick={() => setReload(value => value + 1)}>重试</button></div>}
      {loading && !records.length ? <div className="rn-history-state">正在读取链上历史…</div> : !groups.length ? <div className="rn-history-state"><span>◷</span><strong>暂无交易历史</strong><small>当前账户还没有可显示的链上记录</small></div> : <div className="rn-history-list">{groups.map(([date, items]) => <section key={date}><h3>{date}</h3>{items.map(entry => <HistoryRow key={entry.id} entry={entry} assets={assets} accounts={accounts} accountId={session?.account.id || ''} />)}</section>)}</div>}
      {filterOpen && <div className="rn-sheet-backdrop" role="presentation" onClick={() => setFilterOpen(false)}><section className="rn-history-filter-sheet" role="dialog" aria-label="交易历史类型筛选" onClick={event => event.stopPropagation()}><span className="rn-sheet-handle" /><h2>类型</h2>{(Object.keys(filterLabels) as HistoryFilter[]).map(value => <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => { setFilter(value); setFilterOpen(false); }}>{filterLabels[value]}<span>{filter === value ? '✓' : ''}</span></button>)}<button type="button" className="rn-sheet-cancel" onClick={() => setFilterOpen(false)}>取消</button></section></div>}
    </>}
  </div>;
}

function HistoryRow({ entry, assets, accounts, accountId }: { entry: AccountHistoryEntry; assets: ReadonlyMap<string, HistoryAsset>; accounts: ReadonlyMap<string, string>; accountId: string }) {
  const parsed = parseHistory(entry, accountId, assets, accounts);
  return <Link className="rn-history-row" to={`/history/${encodeURIComponent(entry.id)}`}><span className="rn-history-icon"><HistoryIcon type={entry.operationType} /></span><span className="rn-history-row-main"><strong>{parsed.title}</strong><span className="rn-history-message">{renderMessage(parsed.message)}</span><small>{entry.id}</small></span><span className="rn-history-row-values">{parsed.changes.length ? parsed.changes.map((change, index) => <b className={change.positive ? 'positive' : 'negative'} key={`${entry.id}-${index}`}>{change.positive ? '+' : '-'}{change.value.replace(/^-/, '')}</b>) : parsed.fee ? <b className="negative">-{parsed.fee}</b> : <small>查看详情</small>}</span></Link>;
}

function HistoryDetail({ entry, assets, accounts, accountId, onBack }: { entry: AccountHistoryEntry; assets: ReadonlyMap<string, HistoryAsset>; accounts: ReadonlyMap<string, string>; accountId: string; onBack: () => void }) {
  const operation = object(entry.operation);
  const parsed = parseHistory(entry, accountId, assets, accounts);
  const from = typeof operation.from === 'string' ? operation.from : '';
  const to = typeof operation.to === 'string' ? operation.to : '';
  const fee = operation.fee && typeof operation.fee === 'object' ? formatAtomic(operation.fee as Amount, assets) : '';
  const rawJson = JSON.stringify(operation, null, 2) || '';
  return <div className="rn-history-detail">
    <button className="rn-history-back" type="button" onClick={onBack}>‹ 返回历史</button>
    <div className="rn-history-detail-status">✓ <strong>已完成</strong></div>
    {parsed.changes.length ? <div className="rn-history-detail-changes">{parsed.changes.map((change, index) => <div key={index}><span>{change.positive ? '接收' : '支付'}</span><b className={change.positive ? 'positive' : 'negative'}>{change.positive ? '+' : '-'}{change.value.replace(/^-/, '')}</b></div>)}</div> : <h2>{parsed.title}</h2>}
    <div className="rn-history-detail-message">{renderMessage(parsed.message)}</div>
    <div className="rn-history-detail-fields">
      <dl><dt>时间</dt><dd>{formatTime(entry.time)}</dd></dl>
      <dl><dt>类型</dt><dd>{parsed.title}</dd></dl>
      {from && <dl><dt>发送账户</dt><dd>{from}</dd></dl>}
      {to && <dl><dt>接收账户</dt><dd>{to}</dd></dl>}
      {fee && <dl><dt>网络手续费</dt><dd>{fee}</dd></dl>}
      <dl><dt>历史 ID</dt><dd>{entry.id}</dd></dl>
      {entry.blockNum !== undefined && <dl><dt>区块高度</dt><dd>{entry.blockNum.toLocaleString()}</dd></dl>}
      {entry.trxInBlock !== undefined && <dl><dt>区块内交易</dt><dd>{entry.trxInBlock + 1}</dd></dl>}
      {entry.opInTrx !== undefined && <dl><dt>操作序号</dt><dd>{entry.opInTrx + 1}</dd></dl>}
      <dl><dt>链上原始数据</dt><dd><pre>{rawJson}</pre></dd></dl>
    </div>
  </div>;
}
