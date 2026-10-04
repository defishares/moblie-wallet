import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { gatewayApi, type BSCBridgeConfig, type BridgeHistoryRecord } from '../services/gatewayApi';
import { useAuth } from '../state/AuthProvider';
import { formatGrapheneError } from '../services/grapheneError';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').split('.')[0];
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function BSCHistoryDetailPage() {
  const { txid } = useParams<{ txid: string }>();
  const { session } = useAuth();
  const [record, setRecord] = useState<BridgeHistoryRecord | null>(null);
  const [config, setConfig] = useState<BSCBridgeConfig | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    if (!session || !txid) return;
    try {
      const [history, bridgeConfig] = await Promise.all([gatewayApi.getBSCHistory(session.account.name), gatewayApi.getBSCConfig()]);
      const decoded = decodeURIComponent(txid);
      setRecord(history.data.find(item => item.txid === decoded) || history.data[Number(decoded)] || null);
      setConfig(bridgeConfig);
    } catch (cause) { setError(formatGrapheneError(cause)); }
  }, [session, txid]);
  useEffect(() => { void load(); }, [load]);

  const copy = async (value: string, label: string) => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setNotice(`${label}已复制`); } catch { setError('复制失败，请手动复制'); }
  };

  if (!record) return <main className="rn-history-detail-page"><header className="rn-history-detail-header"><Link to="/bsc-history">‹</Link><h1>记录详情</h1><span /></header>{error ? <p className="rn-history-detail-error">{error}</p> : <div className="rn-history-detail-loading">正在读取记录详情…</div>}</main>;
  const isDeposit = record.type === '充值';
  const fee = isDeposit ? '0 USDT' : config?.withdrawalFee === undefined ? '--' : `${config.withdrawalFee} ${config.withdrawalFeeAsset || 'USDT'}`;
  return <main className="rn-history-detail-page">
    <header className="rn-history-detail-header"><Link to="/bsc-history" aria-label="返回">‹</Link><h1>{isDeposit ? '充值详情' : '提现详情'}</h1><span /></header>
    <div className="rn-history-detail-content">
      <section className="rn-history-detail-hero"><span>₮</span><strong>{isDeposit ? '+' : '-'}{record.amount} USDT</strong><em>✓&nbsp; {record.status}</em></section>
      <section className="rn-history-detail-notice"><h2>{isDeposit ? '为什么我的充值未到账?' : '为什么我的提现未到账?'}</h2><p>{isDeposit ? '充值需要等待 BNB Chain 区块确认，到账状态以 Bridge 记录为准。' : '加密货币从 Bridge 转出后，请联系收款平台查询到账情况。'}</p></section>
      <section className="rn-history-detail-rows">
        <DetailRow label="时间" value={formatTime(record.time)} />
        <DetailRow label="单号" value="--" />
        <DetailRow label="网络" value="BNB Chain" />
        <DetailRow label="实际到账" value={isDeposit ? `${record.amount} USDT` : '--'} />
        <DetailRow label="手续费" value={fee} />
        <CopyRow label={isDeposit ? '充值地址' : '地址'} value={record.address} onCopy={() => void copy(record.address, '地址')} />
        <CopyRow label="TXID" value={record.txid} onCopy={() => void copy(record.txid, '交易哈希')} />
        <DetailRow label="地址名称" value="--" />
      </section>
      {(notice || error) && <p className={error ? 'rn-history-detail-error' : 'rn-history-detail-notice-toast'}>{error || notice}</p>}
    </div>
  </main>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="rn-history-detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return <div className="rn-history-detail-row"><span>{label}</span><strong>{value || '--'}{value && <button type="button" onClick={onCopy} aria-label={`复制${label}`}>▣</button>}</strong></div>;
}
