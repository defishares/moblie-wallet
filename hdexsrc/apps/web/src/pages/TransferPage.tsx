import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountAssetBalance, FullAccountData } from '@defishares/core';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { formatGrapheneError } from '../services/grapheneError';

const CORE_ASSET = 'DFS';

function formatBalance(value: number, precision = 6) {
  if (!Number.isFinite(value) || value === 0) return '0';
  if (value < 0.000001) return value.toFixed(8);
  if (value < 0.01) return value.toFixed(6);
  if (value < 1) return value.toFixed(4);
  return value.toFixed(Math.min(precision, 4));
}

function filterAmount(value: string, precision: number) {
  const normalized = value.replace(/[^\d.]/g, '');
  const [whole, fraction = ''] = normalized.split('.');
  return normalized.includes('.') ? `${whole || '0'}.${fraction.slice(0, precision)}` : whole;
}

function AssetIcon({ symbol }: { symbol: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <span className="rn-transfer-asset-icon fallback">{symbol.slice(0, 1)}</span>;
  return <span className="rn-transfer-asset-icon"><img src={`/assets/coins/${encodeURIComponent(symbol.toUpperCase())}.png`} alt="" onError={() => setMissing(true)} /></span>;
}

type TransferPreview = Awaited<ReturnType<ReturnType<typeof useChain>['loadTransferPreview']>>;

export function TransferPage() {
  const { session } = useAuth();
  const { client, status, loadAccountAssets, loadTransferPreview, signTransferPreview, authenticateAccount, broadcastTransaction, loadAccountHistory } = useChain();
  const [balances, setBalances] = useState<AccountAssetBalance[]>([]);
  const [recipient, setRecipient] = useState('');
  const [recipientInfo, setRecipientInfo] = useState<FullAccountData['account'] | null>(null);
  const [recipientValid, setRecipientValid] = useState<boolean | null>(null);
  const [checkingRecipient, setCheckingRecipient] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [broadcastResult, setBroadcastResult] = useState<string | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(current => current === message ? null : current), 2600);
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadAccountAssets(session.account.id).then(result => setBalances(result.balances)).catch(() => setBalances([]));
  }, [loadAccountAssets, session]);

  const assetOptions = useMemo(() => balances.length ? balances : [{ assetId: '1.3.0', symbol: CORE_ASSET, precision: 5, amount: 0 }], [balances]);
  const selectedAsset = assetOptions.find(item => item.assetId === assetId) || assetOptions[0];
  const availableBalance = selectedAsset?.amount || 0;
  const coreBalance = balances.find(item => item.symbol === CORE_ASSET)?.amount || 0;

  useEffect(() => {
    if (!assetId && assetOptions[0]) setAssetId(assetOptions[0].assetId);
    if (assetId && !assetOptions.some(item => item.assetId === assetId)) setAssetId(assetOptions[0]?.assetId || '');
  }, [assetId, assetOptions]);

  useEffect(() => {
    const value = recipient.trim();
    if (!value) { setRecipientValid(null); setRecipientInfo(null); return; }
    if (session && value.toLowerCase() === session.account.name.toLowerCase()) { setRecipientValid(false); setRecipientInfo(null); return; }
    setCheckingRecipient(true);
    const timer = window.setTimeout(() => {
      void client.getFullAccounts([value]).then(rows => {
        const account = rows[0]?.[1]?.account;
        if (!account || account.id === session?.account.id) { setRecipientValid(false); setRecipientInfo(null); }
        else { setRecipientValid(true); setRecipientInfo(account); }
      }).catch(() => { setRecipientValid(false); setRecipientInfo(null); }).finally(() => setCheckingRecipient(false));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [client, recipient, session]);

  async function pasteRecipient() {
    try { const value = await navigator.clipboard.readText(); if (value) setRecipient(value.trim()); }
    catch { notify('无法读取剪贴板'); }
  }

  async function prepareTransfer(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !selectedAsset) return;
    const value = Number(amount);
    if (!recipient.trim()) return notify('请输入接收账户');
    if (recipientValid === false) return notify('接收账户不存在或不能给自己转账');
    if (!Number.isFinite(value) || value <= 0) return notify('请输入转账金额');
    if (value > availableBalance) return notify('余额不足');
    if (selectedAsset.symbol !== CORE_ASSET && coreBalance <= 0) return notify(`${CORE_ASSET}余额不足以支付手续费`);
    setBusy(true); setBroadcastResult(null); setToast(null);
    try {
      const next = await loadTransferPreview({ fromAccountNameOrId: session.account.id, toAccountNameOrId: recipientInfo?.name || recipient.trim(), assetSymbolOrId: selectedAsset.symbol, amount, memo: memo.trim() || undefined });
      setPreview(next); setShowConfirmModal(true);
    } catch (cause) { notify(formatGrapheneError(cause)); }
    finally { setBusy(false); }
  }

  async function submitTransfer() {
    if (!session || !preview || !password) return;
    setBusy(true); setToast(null);
    try {
      const verified = await authenticateAccount(session.account.name, password);
      if (verified.verifiedRole !== 'active') throw new Error('当前密码只匹配 owner 权限，转账需要 active 权限密码');
      const signed = await signTransferPreview(preview, verified.privateKeyWif);
      await broadcastTransaction(signed);
      let activityId: string | undefined;
      try { activityId = (await loadAccountHistory(session.account.id, 5)).find(entry => entry.operationType === 0)?.id; } catch { /* broadcast succeeded */ }
      setBroadcastResult(activityId || '已提交节点');
      setShowPasswordModal(false); setShowConfirmModal(false); setPassword(''); setPreview(null); setAmount(''); setMemo('');
      notify(`已成功转账 ${preview.amount.value} ${preview.amount.symbol}`);
    } catch (cause) { notify(formatGrapheneError(cause)); }
    finally { setBusy(false); }
  }

  return <div className="rn-transfer-page">
    <header className="rn-transfer-header"><Link className="rn-transfer-back" to="/assets" aria-label="返回资产">‹</Link><h1>转账</h1><span className="rn-transfer-header-space" /></header>
    <form className="rn-transfer-form" onSubmit={prepareTransfer}>
      <div className="rn-transfer-field"><label>发送者</label><div className="rn-transfer-readonly">{session?.account.name || '未登录'}</div></div>
      <div className="rn-transfer-field"><label>转账代币</label><button type="button" className="rn-transfer-selector" onClick={() => setShowAssetPicker(true)}><AssetIcon symbol={selectedAsset?.symbol || CORE_ASSET} /><span><strong>{selectedAsset?.symbol || CORE_ASSET}</strong><small>可用: {formatBalance(availableBalance)}</small></span><b>⌄</b></button></div>
      <div className="rn-transfer-field"><label>接收账户</label><div className="rn-transfer-input-wrap"><input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="请输入接收账户名" autoCapitalize="none" autoCorrect="off" /><span className="rn-transfer-validation">{checkingRecipient ? '验证中…' : recipientValid === true ? '✓' : recipientValid === false ? '×' : ''}</span><button type="button" className="rn-transfer-paste" onClick={() => void pasteRecipient()}>粘贴</button></div></div>
      <div className="rn-transfer-field"><label>转账金额</label><div className="rn-transfer-input-wrap"><input className="amount" inputMode="decimal" value={amount} onChange={event => setAmount(filterAmount(event.target.value, selectedAsset?.precision || 5))} placeholder="0.00" /><button type="button" className="rn-transfer-all" onClick={() => setAmount(formatBalance(availableBalance, selectedAsset?.precision))}>全部</button></div></div>
      <div className="rn-transfer-field"><label>备注（可选）</label><div className="rn-transfer-input-wrap"><input value={memo} onChange={event => setMemo(event.target.value)} placeholder="输入备注信息" autoCapitalize="none" /></div></div>
      <section className="rn-transfer-balance"><div><span>可用余额</span><strong>{formatBalance(availableBalance)} {selectedAsset?.symbol}</strong></div><div><span>{CORE_ASSET}余额（手续费）</span><strong>{formatBalance(coreBalance)} {CORE_ASSET}</strong></div></section>
      <button className="rn-transfer-confirm" type="submit" disabled={busy || status !== 'connected'}>{busy ? '读取链上预览…' : '确认转账'}</button>
      <section className="rn-transfer-tip"><b>ⓘ</b><div><strong>操作提示</strong><p>此操作为区块链上实时操作，一旦确认转账资金将实时达到对方账户。属于不可逆操作，请仔细核对收款账户信息及金额信息。</p></div></section>
    </form>

    {toast && <button type="button" className="rn-transfer-toast" onClick={() => setToast(null)}>{toast}</button>}
    {showAssetPicker && <div className="rn-transfer-overlay" onClick={() => setShowAssetPicker(false)}><section className="rn-transfer-sheet asset-sheet" role="dialog" aria-label="选择代币" onClick={event => event.stopPropagation()}><span className="rn-transfer-handle" /><h2>选择代币</h2><div className="rn-transfer-asset-list">{assetOptions.map(item => <button type="button" key={item.assetId} onClick={() => { setAssetId(item.assetId); setAmount(''); setShowAssetPicker(false); }}><AssetIcon symbol={item.symbol} /><span><strong>{item.symbol}</strong><small>可用: {formatBalance(item.amount)}</small></span>{selectedAsset?.assetId === item.assetId && <b>✓</b>}</button>)}</div></section></div>}
    {showConfirmModal && preview && <div className="rn-transfer-overlay" onClick={() => setShowConfirmModal(false)}><section className="rn-transfer-sheet confirm-sheet" role="dialog" aria-label="转账预览" onClick={event => event.stopPropagation()}><span className="rn-transfer-handle" /><h2>转账预览</h2><div className="rn-confirm-row"><span>发送者</span><strong>{session?.account.name}</strong></div><div className="rn-confirm-row"><span>接收账户</span><strong>{recipient}</strong></div><div className="rn-confirm-row"><span>转账代币</span><strong>{preview.amount.symbol}</strong></div><div className="rn-confirm-row"><span>转账金额</span><strong>{preview.amount.value} {preview.amount.symbol}</strong></div><div className="rn-confirm-row"><span>可用余额</span><strong>{formatBalance(availableBalance)} {selectedAsset?.symbol}</strong></div><div className="rn-confirm-row"><span>{CORE_ASSET}余额</span><strong>{formatBalance(coreBalance)} {CORE_ASSET}</strong></div>{memo && <div className="rn-confirm-row"><span>备注</span><strong>{memo}</strong></div>}<div className="rn-confirm-actions"><button type="button" onClick={() => setShowConfirmModal(false)}>取消</button><button type="button" onClick={() => { setShowConfirmModal(false); setShowPasswordModal(true); }}>确认提交</button></div></section></div>}
    {showPasswordModal && <div className="rn-transfer-overlay" onClick={() => { setShowPasswordModal(false); setPassword(''); }}><section className="rn-transfer-sheet password-sheet" role="dialog" aria-label="验证 active 权限" onClick={event => event.stopPropagation()}><span className="rn-transfer-handle" /><h2>验证 active 权限</h2><p>请输入账户密码完成本地签名，密码不会保存。</p><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="输入账户密码" autoFocus /><button type="button" className="rn-transfer-submit" onClick={() => void submitTransfer()} disabled={busy || !password}>{busy ? '签名并广播中…' : '确认签名并广播'}</button></section></div>}
    {broadcastResult && <div className="rn-transfer-result">交易已提交：{broadcastResult} · <Link to="/orders">查看账户历史</Link></div>}
  </div>;
}
