import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountAssetBalance, TransferPreview } from '@defishares/core';
import { useAuth } from '../state/AuthProvider';
import { useChain } from '../state/ChainProvider';
import { formatGrapheneError } from '../services/grapheneError';
import { gatewayApi, type BSCBridgeConfig } from '../services/gatewayApi';

function formatAmount(value: number, precision = 8) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return value.toFixed(Math.min(precision, 8)).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function filterAmount(value: string, precision: number) {
  const normalized = value.replace(/[^\d.]/g, '');
  const [whole, fraction = ''] = normalized.split('.');
  return normalized.includes('.') ? `${whole || '0'}.${fraction.slice(0, precision)}` : whole;
}

function parseBridgeFee(config: BSCBridgeConfig | null) {
  if (!config || config.withdrawalFee == null || !Number.isFinite(Number(config.withdrawalFee))) return null;
  return { amount: Number(config.withdrawalFee), asset: config.withdrawalFeeAsset || config.symbol };
}

function AssetIcon({ symbol }: { symbol: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <span className="rn-withdraw-asset-icon fallback">{symbol.slice(0, 1)}</span>;
  return <span className="rn-withdraw-asset-icon"><img src={`/assets/coins/${encodeURIComponent(symbol.toUpperCase())}.png`} alt="" onError={() => setMissing(true)} /></span>;
}

export function BSCWithdrawPage() {
  const { session, ensureSigningKey } = useAuth();
  const { status, loadAccountAssets, broadcastTransaction, loadTransferPreview, signTransferPreview } = useChain();
  const [config, setConfig] = useState<BSCBridgeConfig | null>(null);
  const [balances, setBalances] = useState<AccountAssetBalance[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const token = config?.token || config?.symbol || 'USDT';
  const precision = config?.precision ?? 8;
  const fee = parseBridgeFee(config);
  const minimum = config?.withdrawalMin;
  const bridgeTip = config?.tips?.trim();
  const accountBalance = useMemo(() => {
    if (!config) return null;
    return balances.find(item => item.assetId === config.assetId) || balances.find(item => item.symbol === config.symbol || item.symbol === token) || null;
  }, [balances, config, token]);
  const available = accountBalance?.amount || 0;
  const amountPattern = useMemo(() => new RegExp(`^\\d+(\\.\\d{1,${precision}})?$`), [precision]);
  const enteredAmount = Number(amount);
  const amountValid = amountPattern.test(amount.trim()) && Number.isFinite(enteredAmount) && enteredAmount > 0;
  const amountExceedsBalance = amountValid && enteredAmount > available;
  const amountBelowMinimum = amountValid && minimum != null && enteredAmount < minimum;
  const expectedReceived = amountValid && fee ? Math.max(0, enteredAmount - fee.amount) : null;

  const loadData = useCallback(async () => {
    if (!session || status !== 'connected') return;
    setConfigLoading(true); setConfigError(false); setError('');
    const [configResult, balanceResult] = await Promise.allSettled([gatewayApi.getBSCConfig(), loadAccountAssets(session.account.id)]);
    if (configResult.status === 'fulfilled') setConfig(configResult.value); else { setConfig(null); setConfigError(true); setError(formatGrapheneError(configResult.reason)); }
    if (balanceResult.status === 'fulfilled') setBalances(balanceResult.value.balances); else setBalances([]);
    setConfigLoading(false);
  }, [loadAccountAssets, session, status]);

  useEffect(() => { void loadData(); }, [loadData]);

  const pasteAddress = async () => {
    try { const value = await navigator.clipboard.readText(); if (value) setAddress(value.trim()); }
    catch { setError('无法读取剪贴板，请手动输入地址'); }
  };

  const prepareWithdrawal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) { setError('请先登录 DFS 账户'); return; }
    if (configLoading || !config || configError) { setError('正在读取 bridge 币种配置，请稍后再试'); return; }
    const normalizedAddress = address.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(normalizedAddress)) { setError('请输入正确的 BSC 地址'); return; }
    if (!amountValid) { setError(`请输入 ${precision} 位小数以内的提现金额`); return; }
    if (!config.withdrawalAllowed) { setError('提现功能暂未开启'); return; }
    if (amountBelowMinimum) { setError(`不得低于最低提现金额 ${formatAmount(minimum || 0, precision)} ${token}`); return; }
    if (amountExceedsBalance) { setError(`余额不足，当前可提余额为 ${formatAmount(available, precision)} ${token}`); return; }
    setBusy(true); setError(''); setNotice(''); setSubmitted(false);
    try {
      await gatewayApi.checkBSCAddress(normalizedAddress, config.code);
      const nextPreview = await loadTransferPreview({ fromAccountNameOrId: session.account.id, toAccountNameOrId: config.fundingAccount, assetSymbolOrId: config.assetId, amount, memo: `${config.symbol}:${normalizedAddress}` });
      setPreview(nextPreview);
      setShowPassword(true);
    } catch (cause) { setError(formatGrapheneError(cause)); }
    finally { setBusy(false); }
  };

  const submitWithdrawal = async () => {
    if (!session || !preview) return;
    setBusy(true); setError('');
    try {
      const signer = await ensureSigningKey();
      if (signer.verifiedRole !== 'active') throw new Error('提现需要 active 权限密钥');
      const signed = await signTransferPreview(preview, signer.privateKeyWif);
      await broadcastTransaction(signed);
      setShowPassword(false); setPreview(null); setAmount(''); setSubmitted(true);
      setNotice(`已提交 ${preview.amount.value} ${preview.amount.symbol}，请在充提查询中查看状态`);
    } catch (cause) { setError(formatGrapheneError(cause)); }
    finally { setBusy(false); }
  };

  return <main className="rn-withdraw-page">
    <header className="rn-withdraw-header"><Link to="/assets" aria-label="返回资产">‹</Link><h1>{token} 提现</h1><span /></header>
    <form className="rn-withdraw-content" onSubmit={event => void prepareWithdrawal(event)}>
      <section className="rn-withdraw-account-card">
        <div className="rn-withdraw-account-top"><div><label>DFS 账户</label><strong>{session?.account.name || '未登录'}</strong></div><div className="rn-withdraw-balance"><label>可提余额</label><strong>{configLoading ? '加载中…' : formatAmount(available, precision)} <small>{token}</small></strong></div></div>
        <p>仅可提取当前账户的 {token} 可用余额</p>
      </section>

      <section className="rn-withdraw-card">
        <label>{token} 收款地址（{config?.chain || 'BSC'}）</label>
        <div className="rn-withdraw-input-row"><input value={address} onChange={event => setAddress(event.target.value)} placeholder="0x..." autoCapitalize="none" autoCorrect="off" disabled={busy}/><button type="button" onClick={() => void pasteAddress()} disabled={busy}>粘贴</button></div>
        {config && <small className="rn-withdraw-hint">只支持 {config.chain} 网络的 {token} 地址</small>}
        <small className="rn-withdraw-hint">提现将转入 {config?.fundingAccount || 'bridge 账户'}，备注格式：{config?.symbol || 'USDT'}:&lt;收款地址&gt;</small>
        <label className="rn-withdraw-amount-label">提现数量（{token}）</label>
        <div className="rn-withdraw-input-row"><input inputMode="decimal" value={amount} onChange={event => setAmount(filterAmount(event.target.value, precision))} placeholder="0.00" disabled={busy}/><span>{token}</span><button type="button" onClick={() => setAmount(formatAmount(available, precision))} disabled={busy || !accountBalance}>全部</button></div>
        {amountExceedsBalance && <small className="rn-withdraw-error">余额不足，最多可提 {formatAmount(available, precision)} {token}</small>}
        {amountBelowMinimum && <small className="rn-withdraw-error">不得低于最低提现金额 {formatAmount(minimum || 0, precision)} {token}</small>}
      </section>

      <section className="rn-withdraw-summary"><div><span>到账数量</span><strong>{expectedReceived == null ? '--' : `${formatAmount(expectedReceived, precision)} ${token}`}</strong></div><div><span>网络手续费</span><strong>{configLoading ? '读取 bridge 配置中…' : configError ? '暂时无法读取' : fee ? `${formatAmount(fee.amount, precision)} ${fee.asset}` : 'bridge 未返回'}</strong></div><div><span>最低提现</span><strong>{configLoading ? '读取 bridge 配置中…' : configError ? '暂时无法读取' : minimum != null ? `${formatAmount(minimum, precision)} ${token}` : 'bridge 未返回'}</strong></div>{configError && <small>暂时无法读取 bridge 后台配置，请稍后刷新页面</small>}{!configLoading && !configError && !fee && <small>手续费以 bridge 后台配置为准，当前接口未返回手续费字段</small>}</section>
      {bridgeTip && <section className="rn-withdraw-notice"><b>✓</b><p>{bridgeTip}</p></section>}
      <section className="rn-withdraw-support"><b>✉</b><p>充值提现问题，请联系邮箱：<br/><a href="mailto:bridge-team@defishares.org">bridge-team@defishares.org</a></p></section>
      {error && <p className="rn-withdraw-error-box">{error}</p>}
      {notice && <p className="rn-withdraw-success-box">{notice}</p>}
      {submitted && <section className="rn-withdraw-result"><strong>提现转账已提交</strong><span>状态：待提币</span><span>收款地址：{address}</span><small>DFS 链上转账已提交，Bridge 将自动识别并处理。</small></section>}
      <button className="rn-withdraw-submit" type="submit" disabled={busy || configLoading || !session}>{busy ? '校验并提交中…' : '提交提现申请'}</button>
    </form>

    {showPassword && <div className="rn-withdraw-overlay" role="presentation" onMouseDown={event => event.currentTarget === event.target && setShowPassword(false)}><section className="rn-withdraw-password" role="dialog" aria-modal="true" aria-label="验证设备并签名"><span className="rn-withdraw-handle"/><h2>验证设备并签名</h2><p>仅在提交提现时验证 Passkey，私钥不会离开当前页面内存。</p><div><button type="button" onClick={() => setShowPassword(false)}>取消</button><button type="button" onClick={() => void submitWithdrawal()} disabled={busy}>{busy ? '验证并广播中…' : '验证设备并广播'}</button></div></section></div>}
  </main>;
}
