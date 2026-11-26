/**
 * Bridge 用户接口。
 *
 * 该服务只调用文档中对前端开放的接口：币种配置、充值地址、提币地址校验和
 * 充提历史。提币本身由 BSCWithdrawScreen 按文档通过 DFS 链上的 transfer 发起。
 */

import { API_TIMEOUT } from '../config/constants';

const GATEWAY_API_BASE = 'https://gate.defishares.org/bridge';
const BNB_CHAIN_CODE = 'BNBChain';

export const DFS_WITHDRAWAL_ACCOUNT = 'dao-gate-hot-wallet';
export const DFS_WITHDRAWAL_ASSET_ID = '1.3.163';
export const DFS_WITHDRAWAL_ASSET_SYMBOL = 'USDT';
export const DFS_WITHDRAWAL_ASSET_PRECISION = 5;

export interface BridgeCoin {
  id?: string | number;
  name: string;
  asset_id: string;
  code: string;
  coin_address: string;
  symbol: string;
  depositAllowed: boolean;
  withdrawalAllowed: boolean;
  memoSupport: boolean;
  precision: number;
  precision_blockchain: number;
  minAmount: string | number;
  withdrawFee: string | number;
  gateFee?: string | number;
  depositFee?: string | number;
  outputCoinType: string;
  withdrawlTips?: string;
  gatewayWallet?: string;
  wallet_address?: string;
  confirmations: { type: string; value: number };
}

export interface BSCDepositRoute {
  account: string;
  address: string;
  memo?: string;
  chain: string;
  chain_id: number;
  token: string;
  contract: string;
  decimals: number;
  confirmations: number;
  deposit_precision?: number;
  withdrawal_tips?: string;
  deposit_min_amount?: string | number;
  withdrawal_min_amount?: string | number;
  currency?: BridgeCurrencyConfig;
}

/** Compatibility shape consumed by the existing deposit and withdrawal screens. */
export interface BridgeCurrencyConfig {
  id: string;
  name: string;
  symbol: string;
  code: string;
  enabled: boolean;
  chain: string;
  chain_id: number;
  token: string;
  contract: string;
  decimals: number;
  confirmations: number;
  deposit_precision?: number;
  withdrawal_tips?: string;
  deposit_allowed: boolean;
  withdrawal_allowed: boolean;
  deposit_min_amount?: string | number;
  withdrawal_min_amount?: string | number;
  withdrawal_fee?: string | number;
  withdrawal_fee_asset?: string;
  funding_account: string;
  funding_asset_id: string;
  funding_asset_symbol: string;
  funding_precision: number;
  route_key?: string;
  internal?: Record<string, unknown>;
  external?: Record<string, unknown>;
}

export interface BSCBridgeConfig extends BridgeCurrencyConfig {
  currency?: BridgeCurrencyConfig;
  gate_fee?: string | number;
}

export interface BSCWithdrawalResult {
  request_id?: string;
  account?: string;
  address?: string;
  amount?: string;
  status?: string;
  broadcasted?: boolean;
  message?: string;
  txid?: string;
  withdrawal_fee?: string | number;
  withdrawal_fee_asset?: string;
  payout_amount?: string | number;
}

export interface BridgeHistoryRecord {
  type: '充值' | '提币' | string;
  time: string;
  address: string;
  amount: string;
  status: string;
  txid: string;
}

export interface BridgeHistoryResponse {
  code: number;
  msg: string;
  count: number;
  range_days: number;
  data: BridgeHistoryRecord[];
}

/** Convert a validated decimal amount to the chain's integer precision. */
export const decimalToAtomic = (value: string, precision: number): bigint => {
  if (!Number.isInteger(precision) || precision < 0 || precision > 18)
    throw new Error('提现币种精度配置无效');
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error('提现金额格式不正确');
  const fraction = match[2] || '';
  if (fraction.length > precision)
    throw new Error('提现金额最多支持 ' + precision + ' 位小数');
  const scale = 10n ** BigInt(precision);
  return (
    BigInt(match[1]) * scale +
    BigInt((fraction + '0'.repeat(precision)).slice(0, precision) || '0')
  );
};

export const buildBSCWithdrawalMemo = (address: string): string =>
  DFS_WITHDRAWAL_ASSET_SYMBOL + ':' + address.trim();

class GatewayHttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'GatewayHttpError';
  }
}

const requestJson = async <T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const response = await fetch(GATEWAY_API_BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new GatewayHttpError(
        payload?.message || payload?.msg || payload?.error || '请求失败 (' + response.status + ')',
        response.status,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('充值服务连接超时，请稍后重试');
    }
    if (error instanceof TypeError) {
      throw new Error('充值服务暂时无法连接，请检查网络后重试');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const mapCoinToConfig = (coin: BridgeCoin): BSCBridgeConfig => {
  if (
    !coin ||
    !coin.symbol ||
    !coin.asset_id ||
    !coin.code ||
    !coin.coin_address ||
    !Number.isInteger(coin.precision) ||
    !Number.isInteger(coin.precision_blockchain) ||
    !coin.confirmations ||
    !Number.isInteger(coin.confirmations.value)
  ) {
    throw new Error('bridge 币种配置不完整或无效');
  }
  const config: BSCBridgeConfig = {
    id: String(coin.id ?? coin.symbol),
    name: coin.name || coin.symbol,
    symbol: coin.symbol,
    code: coin.code,
    enabled: Boolean(coin.depositAllowed || coin.withdrawalAllowed),
    chain: coin.code,
    chain_id: 56,
    token: coin.outputCoinType || coin.symbol,
    contract: coin.coin_address,
    decimals: coin.precision_blockchain,
    confirmations: coin.confirmations.value,
    deposit_precision: coin.precision,
    deposit_allowed: Boolean(coin.depositAllowed),
    withdrawal_allowed: Boolean(coin.withdrawalAllowed),
    deposit_min_amount: coin.minAmount,
    withdrawal_min_amount: coin.minAmount,
    withdrawal_tips: coin.withdrawlTips,
    // 文档说明 gateFee 是向 Gate 发起外部链提现时扣除的费用，优先展示该值。
    withdrawal_fee: coin.gateFee ?? coin.withdrawFee,
    withdrawal_fee_asset: coin.symbol,
    funding_account: coin.gatewayWallet || coin.wallet_address || DFS_WITHDRAWAL_ACCOUNT,
    funding_asset_id: coin.asset_id,
    funding_asset_symbol: coin.symbol,
    funding_precision: coin.precision,
    route_key: coin.code,
    gate_fee: coin.gateFee,
  };
  config.currency = config;
  return config;
};

const normalizeCoinList = (payload: unknown): BridgeCoin[] => {
  if (Array.isArray(payload)) return payload as BridgeCoin[];
  if (payload && typeof payload === 'object' && 'symbol' in payload) {
    return [payload as BridgeCoin];
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).data)) {
    return (payload as any).data as BridgeCoin[];
  }
  return [];
};

export const gatewayApi = {
  async getBSCConfig(): Promise<BSCBridgeConfig> {
    const coins = normalizeCoinList(await requestJson<unknown>('/api/nbs/coin'));
    const coin = coins.find(item =>
      item.symbol?.toUpperCase() === DFS_WITHDRAWAL_ASSET_SYMBOL ||
      item.outputCoinType?.toUpperCase() === DFS_WITHDRAWAL_ASSET_SYMBOL,
    );
    if (!coin) throw new Error('bridge 未配置 USDT');
    return mapCoinToConfig(coin);
  },

  async getBSCDepositAddress(account: string): Promise<BSCDepositRoute> {
    const config = await this.getBSCConfig();
    if (!config.deposit_allowed) throw new Error('充值功能暂未开启');
    const payload = await requestJson<{
      outputAddress?: string;
      inputAddress?: string;
      inputCoinType?: string;
      outputCoinType?: string;
    }>('/api/nbs/wallet', {
      outputAddress: account.trim(),
      inputCoinType: BNB_CHAIN_CODE,
    });
    if (!payload?.inputAddress || !payload?.outputAddress) {
      throw new Error('充值服务返回的地址无效');
    }
    return {
      account: payload.outputAddress,
      address: payload.inputAddress,
      memo: '',
      chain: payload.inputCoinType || BNB_CHAIN_CODE,
      chain_id: config.chain_id,
      token: payload.outputCoinType || config.token,
      contract: config.contract,
      decimals: config.decimals,
      confirmations: config.confirmations,
      deposit_precision: config.deposit_precision,
      deposit_min_amount: config.deposit_min_amount,
      withdrawal_min_amount: config.withdrawal_min_amount,
      currency: config,
    };
  },

  async checkBSCAddress(address: string, inputCoinType = BNB_CHAIN_CODE): Promise<boolean> {
    const payload = await requestJson<{ isValid?: boolean }>('/api/nbs/check-address', {
      address: address.trim(),
      inputCoinType,
    });
    if (!payload?.isValid) throw new Error('提币地址校验失败，请检查地址和网络');
    return true;
  },

  async getBSCHistory(account: string): Promise<BridgeHistoryResponse> {
    const normalized = account.trim();
    if (!normalized) throw new Error('账户名不能为空');
    const payload = await requestJson<Partial<BridgeHistoryResponse>>(
      '/api/nbs/history?account=' + encodeURIComponent(normalized),
    );
    if (!Array.isArray(payload?.data)) throw new Error(payload?.msg || '读取充提记录失败');
    return {
      code: toNumber(payload.code, 20000),
      msg: payload.msg || 'success',
      count: toNumber(payload.count, payload.data.length),
      range_days: toNumber(payload.range_days, 90),
      data: payload.data,
    };
  },
};

export default gatewayApi;
