export interface LiquidityPoolStatistics {
  _24h_exchange_a2b_amount_a?: string | number;
  _24h_exchange_b2a_amount_a?: string | number;
  _24h_balance_delta_a?: string | number;
  _24h_balance_delta_b?: string | number;
}

export interface LiquidityPoolMetricsInput {
  assetA: string;
  assetB: string;
  balanceA: number;
  balanceB: number;
  precisionA: number;
  precisionB: number;
  statistics?: LiquidityPoolStatistics | null;
}

export interface LiquidityPoolMetrics {
  /** 24 小时价格变化百分比；统计字段不完整时为 null。 */
  change24h: number | null;
  /** 24 小时 A 资产成交量；统计字段不完整时为 null。 */
  volume24h: number | null;
}

const amountFromChain = (value: string | number | undefined, precision: number): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  return raw / 10 ** precision;
};

const poolPrice = (assetA: string, assetB: string, balanceA: number, balanceB: number): number => {
  if (!(balanceA > 0) || !(balanceB > 0)) return 0;
  // Keep the same quote convention as the pool list: non-DFS/DFS is quoted
  // as the non-DFS asset per DFS, while DFS/non-DFS is quoted as B per A.
  return assetB === 'DFS' && assetA !== 'DFS' ? balanceA / balanceB : balanceB / balanceA;
};

export const getLiquidityPoolMetrics = (input: LiquidityPoolMetricsInput): LiquidityPoolMetrics => {
  const statistics = input.statistics;
  if (!statistics) return { change24h: null, volume24h: null };

  const exchangeA2B = amountFromChain(statistics._24h_exchange_a2b_amount_a, input.precisionA);
  const exchangeB2A = amountFromChain(statistics._24h_exchange_b2a_amount_a, input.precisionA);
  const volume24h = exchangeA2B !== null && exchangeB2A !== null ? exchangeA2B + exchangeB2A : null;

  const deltaA = amountFromChain(statistics._24h_balance_delta_a, input.precisionA);
  const deltaB = amountFromChain(statistics._24h_balance_delta_b, input.precisionB);
  let change24h: number | null = null;
  if (deltaA !== null && deltaB !== null) {
    const previousA = input.balanceA - deltaA;
    const previousB = input.balanceB - deltaB;
    const currentPrice = poolPrice(input.assetA, input.assetB, input.balanceA, input.balanceB);
    const previousPrice = poolPrice(input.assetA, input.assetB, previousA, previousB);
    if (currentPrice > 0 && previousPrice > 0) {
      change24h = ((currentPrice / previousPrice) - 1) * 100;
    }
  }

  return { change24h, volume24h };
};

