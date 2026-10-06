export interface MarketPair {
  base: string;
  quote: string;
}

export interface TickerData {
  latest: string;
  percent_change: string;
  base_volume: string;
  quote_volume: string;
  highest_bid: string;
  lowest_ask: string;
}

export interface MarketTicker extends MarketPair {
  key: string;
  latest: number;
  change24h: number;
  baseVolume: number;
  quoteVolume: number;
  highestBid: number;
  lowestAsk: number;
}

export interface AssetObject {
  id: string;
  symbol: string;
  precision: number;
  issuer?: string;
  bitasset_data_id?: string;
  options?: Record<string, unknown>;
}

export interface BalanceObject {
  id?: string;
  owner?: string;
  asset_type: string;
  balance: string | number;
}

export interface FullAccountData {
  account: { id: string; name: string; options?: { memo_key?: string; [key: string]: unknown } };
  balances: BalanceObject[];
  limit_orders?: unknown[];
  call_orders?: unknown[];
  settle_orders?: unknown[];
  [key: string]: unknown;
}

export interface AccountAssetBalance {
  assetId: string;
  symbol: string;
  precision: number;
  amount: number;
}

export interface AccountOrder {
  id: string;
  sellAmount: number;
  sellSymbol: string;
  receiveAmount: number;
  receiveSymbol: string;
  price: number;
  expiration?: string;
}

export interface AccountHistoryEntry {
  id: string;
  operationType: number;
  blockNum?: number;
  time?: string;
  trxInBlock?: number;
  opInTrx?: number;
  virtualOp?: number;
  operation?: unknown;
  result?: unknown;
  raw: unknown;
}

export interface TransferPreview {
  from: { id: string; name: string };
  to: { id: string; name: string };
  amount: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  fee: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  operation: Record<string, unknown>;
  memo?: string;
  toMemoKey?: string;
}

export interface LimitOrderPreview {
  account: { id: string; name: string };
  side: 'buy' | 'sell';
  base: { id: string; symbol: string; precision: number };
  quote: { id: string; symbol: string; precision: number };
  price: number;
  amount: number;
  sell: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  receive: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  fee: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  operation: Record<string, unknown>;
}

export interface CancelOrderPreview {
  account: { id: string; name: string };
  orderId: string;
  fee: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  operation: Record<string, unknown>;
}

export interface LendingPosition {
  id: string;
  debtAsset: { id: string; symbol: string; precision: number };
  collateral: number;
  debt: number;
  feedPrice: number;
  initialCollateralRatio: number;
}

export interface LendingOverview {
  account: { id: string; name: string };
  collateralAsset: { id: string; symbol: string; precision: number };
  borrowAssets: Array<{ id: string; symbol: string; precision: number; feedPrice: number; initialCollateralRatio: number }>;
  positions: LendingPosition[];
}

export interface LendingPreview {
  account: { id: string; name: string };
  debtAsset: { id: string; symbol: string; precision: number };
  targetCollateral: number;
  targetDebt: number;
  collateralDelta: string;
  debtDelta: string;
  fee: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  operation: Record<string, unknown>;
}

export interface LiquidityPool {
  id: string;
  assetA: { id: string; symbol: string; precision: number };
  assetB: { id: string; symbol: string; precision: number };
  shareAsset: { id: string; symbol: string; precision: number };
  balanceA: number;
  balanceB: number;
  takerFeePercent: number;
  withdrawalFeePercent: number;
  /** Optional 24h pool metrics derived from the chain statistics payload. */
  change24h?: number | null;
  volume24h?: number | null;
  raw: Record<string, unknown>;
}

export type LiquidityOperation = 'exchange' | 'deposit' | 'withdraw';

export interface LiquidityPreview {
  account: { id: string; name: string };
  pool: LiquidityPool;
  operationType: LiquidityOperation;
  amountA?: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  amountB?: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  sell?: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  receive?: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  fee: { atomic: string; value: number; symbol: string; assetId: string; precision: number };
  operation: Record<string, unknown>;
}

export interface OrderBookRow {
  price: number;
  quote: number;
  base: number;
}

export interface OrderBookData {
  bids: OrderBookRow[];
  asks: OrderBookRow[];
}

export interface MarketTrade {
  timestamp: number;
  isSell: boolean;
  isCall: boolean;
  price: number;
  amount: number;
}

export interface KLineData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function marketKey(pair: MarketPair): string {
  return `${pair.base}_${pair.quote}`;
}

export function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeTicker(pair: MarketPair, ticker: TickerData): MarketTicker {
  const invert = (value: string): number => {
    const parsed = toFiniteNumber(value);
    return parsed > 0 ? 1 / parsed : 0;
  };
  const sourceChange = toFiniteNumber(ticker.percent_change);
  const invertedChange = sourceChange > -100
    ? (-sourceChange / (100 + sourceChange)) * 100
    : sourceChange;
  return {
    ...pair,
    key: marketKey(pair),
    // DefiShares displays quote units per traded asset. The node API returns
    // the opposite orientation for this market list, matching the mobile
    // normalizeMarketTicker helper.
    latest: invert(ticker.latest),
    change24h: invertedChange,
    baseVolume: toFiniteNumber(ticker.base_volume),
    quoteVolume: toFiniteNumber(ticker.quote_volume),
    highestBid: invert(ticker.lowest_ask),
    lowestAsk: invert(ticker.highest_bid),
  };
}

/** Shared RN/Web normalization for Graphene ticker payloads. */
export function normalizeGrapheneTicker<T extends { latest: string; lowest_ask: string; highest_bid: string; percent_change: string }>(raw: T): T {
  const invert = (value: string): string => {
    const price = Number(value);
    return Number.isFinite(price) && price > 0 ? String(1 / price) : '0';
  };
  const percent = Number(raw.percent_change);
  const inverted = !Number.isFinite(percent) || percent <= -100 ? raw.percent_change : String((-percent / (100 + percent)) * 100);
  return { ...raw, latest: invert(raw.latest), lowest_ask: invert(raw.highest_bid), highest_bid: invert(raw.lowest_ask), percent_change: inverted };
}

export function atomicToDecimal(amount: string | number, precision: number): number {
  return toFiniteNumber(amount) / 10 ** precision;
}

/** Convert a user-entered decimal amount to a Graphene integer amount safely. */
export function decimalToAtomic(value: string, precision: number): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('请输入有效的资产数量');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > precision) throw new Error(`该资产最多支持 ${precision} 位小数`);
  const padded = fraction.padEnd(precision, '0');
  const atomic = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  if (BigInt(atomic || '0') <= 0n) throw new Error('转账数量必须大于 0');
  return atomic || '0';
}

/**
 * Calculate a safe minimum receive amount for a pool quote.
 *
 * The chain stores receive amounts as integers. Using `toFixed()` directly
 * can round a small quote up (for example 0.099 -> 0.10), making
 * `min_to_receive` greater than the amount the pool can actually produce.
 * Floor to the destination asset's atomic unit instead.
 */
export function minimumReceiveWithSlippage(value: number, precision: number, slippageBps = 50): string {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(precision) || precision < 0 || precision > 20) return '';
  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) return '';
  const scale = 10 ** precision;
  const atomic = Math.floor(value * scale * (10_000 - slippageBps) / 10_000);
  return atomic > 0 ? (atomic / scale).toFixed(precision) : '';
}

export function formatPrice(value: number, maximumFractionDigits = 8): string {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits,
    minimumFractionDigits: value > 0 && value < 1 ? Math.min(4, maximumFractionDigits) : 2,
  }).format(value);
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}
