import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { gatewayApi, type BridgeHistoryRecord } from '../services/gatewayApi';
import { useAuth } from '../state/AuthProvider';
import { formatGrapheneError } from '../services/grapheneError';

type HistoryTab = 'deposit' | 'withdrawal';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').split('.')[0];
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function BSCHistoryPage() {
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState<HistoryTab>('deposit');
  const [records, setRecords] = useState<BridgeHistoryRecord[]>([]);
  const [rangeDays, setRangeDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    if (!session?.account.name) { setRecords([]); return; }
    setLoading(true); setError('');
    try {
      const response = await gatewayApi.getBSCHistory(session.account.name);
      setRecords(response.data); setRangeDays(response.rangeDays);
    } catch (cause) {
      setRecords([]); setError(formatGrapheneError(cause));
    } finally { setLoading(false); }
  }, [session?.account.name]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const visibleRecords = useMemo(
    () => records.filter(record => activeTab === 'deposit' ? record.type === '充值' : record.type === '提币'),
    [activeTab, records],
  );

  return <main className="rn-history-page rn-bsc-history-page">
    <header className="rn-history-header"><Link to="/assets" aria-label="返回资产">‹</Link><h1>充提查询</h1><button type="button" onClick={() => void loadHistory()} disabled={loading} aria-label="刷新">↻</button></header>
    <nav className="rn-history-tabs" aria-label="充提类型">
      <button type="button" className={activeTab === 'deposit' ? 'active' : ''} onClick={() => setActiveTab('deposit')}>充值</button>
      <button type="button" className={activeTab === 'withdrawal' ? 'active' : ''} onClick={() => setActiveTab('withdrawal')}>提现</button>
    </nav>
    {!session ? <div className="rn-history-empty rn-history-empty-full"><span>◎</span><strong>请先登录 DFS 账户</strong></div>
      : loading && records.length === 0 ? <div className="rn-history-empty rn-history-empty-full"><i className="rn-history-spinner"/><p>正在读取最近 {rangeDays} 天记录...</p></div>
        : <section className="rn-history-list">
          {error && <p className="rn-history-error">{error}</p>}
          {visibleRecords.length === 0 ? <div className="rn-history-empty"><span>◷</span><p>暂无{activeTab === 'deposit' ? '充值' : '提现'}记录</p></div>
            : visibleRecords.map((record, index) => {
              const isDeposit = record.type === '充值';
              return <Link className="rn-history-row" key={`${record.txid}-${index}`} to={`/bsc-history/${encodeURIComponent(record.txid || String(index))}`}>
                <div><strong>USDT</strong><small>{formatTime(record.time)}</small></div>
                <div className="rn-history-row-right"><strong className={isDeposit ? 'deposit' : 'withdraw'}>{isDeposit ? '+' : '-'}{record.amount}</strong><small>{record.status}</small></div>
                <b aria-hidden="true">›</b>
              </Link>;
            })}
        </section>}
  </main>;
}
