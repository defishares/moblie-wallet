import { useCallback, useEffect, useState } from 'react';
import { formatPrice } from '@defishares/core';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { formatGrapheneError } from '../services/grapheneError';
import { RNScreenHeader } from '../components/RNScreenHeader';

const operationLabels: Record<number, string> = {
  0: '转账',
  1: '创建限价单',
  2: '取消限价单',
  4: '成交',
  5: '创建账户',
  6: '更新账户',
  10: '创建资产',
  12: '发行资产',
};

export function OrdersPage() {
  const { session, ensureSigningKey } = useAuth();
  const { broadcastTransaction, loadAccountOrders, loadAccountHistory, loadCancelOrderPreview, signOperation } = useChain();
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof loadAccountOrders>> | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof loadAccountHistory>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelPreview, setCancelPreview] = useState<Awaited<ReturnType<typeof loadCancelOrderPreview>> | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const [openOrders, recentHistory] = await Promise.all([
        loadAccountOrders(session.account.id),
        loadAccountHistory(session.account.id, 20),
      ]);
      setOrders(openOrders);
      setHistory(recentHistory);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户订单查询失败');
    } finally {
      setLoading(false);
    }
  }, [loadAccountHistory, loadAccountOrders, session]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function prepareCancel(orderId: string) {
    if (!session) return;
    setCancelLoading(true); setError(null);
    try { setCancelPreview(await loadCancelOrderPreview(session.account.id, orderId)); } catch (cause) { setError(formatGrapheneError(cause)); } finally { setCancelLoading(false); }
  }

  async function submitCancel() {
    if (!session || !cancelPreview) return;
    if (!window.confirm(`确认撤销委托 ${cancelPreview.orderId} 吗？`)) return;
    setCancelLoading(true); setError(null);
    try {
      const signer = await ensureSigningKey();
      if (signer.verifiedRole !== 'active') throw new Error('当前密钥只匹配 owner 权限，撤单需要 active 权限密钥');
      const signed = await signOperation('limit_order_cancel', { ...cancelPreview.operation, fee: { amount: cancelPreview.fee.atomic, asset_id: cancelPreview.fee.assetId } }, signer.privateKeyWif);
      await broadcastTransaction(signed);
      setCancelPreview(null);
      await refresh();
    } catch (cause) { setError(formatGrapheneError(cause)); } finally { setCancelLoading(false); }
  }

  return <div className="page-stack rn-secondary-page rn-orders-page">
    <RNScreenHeader title="订单" backTo="/trade" action={<button className="rn-header-icon" type="button" onClick={() => void refresh()} disabled={loading}>↻</button>} />
    <section className="page-intro">
      <div><p className="eyebrow mint">ACCOUNT ACTIVITY</p><h2>订单与历史</h2><p>当前账户的未成交订单和最近链上操作，只读展示。</p></div>
      <button className="ghost-button" onClick={() => void refresh()} disabled={loading}>{loading ? '同步中…' : '刷新数据'}</button>
    </section>
    {error && <div className="inline-error">{error}</div>}
    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">OPEN ORDERS</p><h3>当前委托</h3></div><span className="muted">{orders?.orders.length ?? '--'} 笔</span></div>
      <div className="activity-card">
        {!orders && loading && <div className="empty-state">正在同步委托…</div>}
        {orders && !orders.orders.length && <div className="empty-state">当前没有未成交订单</div>}
        {orders?.orders.map(order => <div className="activity-row" key={order.id}><div><strong>{order.sellSymbol} → {order.receiveSymbol}</strong><small>{order.id}</small></div><div className="activity-number"><strong>{formatPrice(order.sellAmount, 8)} {order.sellSymbol}</strong><small>预计得到 {formatPrice(order.receiveAmount, 8)} {order.receiveSymbol}</small></div><div className="activity-number order-action-cell"><strong>{formatPrice(order.price, 8)}</strong><small>价格</small><button className="ghost-button small-button" type="button" onClick={() => void prepareCancel(order.id)} disabled={cancelLoading}>撤单</button></div></div>)}
      </div>
      {cancelPreview && <section className="panel-card cancel-panel"><div className="panel-title"><h3>撤单确认</h3><span className="status-badge">ACTIVE KEY</span></div><p className="section-caption">委托 {cancelPreview.orderId} · 预计手续费 {cancelPreview.fee.value} {cancelPreview.fee.symbol}</p><p className="section-caption">确认后将通过本机 Passkey 验证并完成签名。</p><div className="page-actions"><button className="ghost-button" type="button" onClick={() => setCancelPreview(null)}>取消</button><button className="primary-button" type="button" onClick={() => void submitCancel()} disabled={cancelLoading}>{cancelLoading ? '验证并广播中…' : '验证设备并撤单'}</button></div></section>}
    </section>
    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">CHAIN HISTORY</p><h3>最近操作</h3></div><span className="muted">最近 {history.length} 笔</span></div>
      <div className="activity-card">
        {!history.length && !loading && <div className="empty-state">暂无可显示的账户历史</div>}
        {history.map(entry => <div className="activity-row history-row" key={entry.id}><div><strong>{operationLabels[entry.operationType] ?? `操作 #${entry.operationType}`}</strong><small>{entry.id}</small></div><div className="activity-number"><strong>链上记录</strong><small>{entry.blockNum ? `区块 ${entry.blockNum}` : '区块信息不可用'}</small></div></div>)}
      </div>
    </section>
  </div>;
}
