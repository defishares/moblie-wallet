import { getAssetConversionRate, type TickerLike } from './assetConversion';

export interface LiquidityPoolValuation {
  shareAssetId: string;
  shareSymbol: string;
  /** 当前流通 LP 数量，已按 LP 精度换算。 */
  shareSupply: number;
  /** 池内储备，已按各自资产精度换算。 */
  reserves: Array<{ symbol: string; amount: number }>;
}

/** 将 LP 的储备净值加入估值汇率，支持 LP 持仓和以 LP 为估值单位。 */
export const withLiquidityPoolValuation = (
  tickerMap: Map<string, TickerLike>,
  pools: Map<string, LiquidityPoolValuation>,
): Map<string, TickerLike> => {
  if (!pools.size) return tickerMap;
  const rates = new Map(tickerMap);
  const shareSymbols = new Set(Array.from(pools.values(), pool => pool.shareSymbol));
  // LP 使用当前储备净值，避免旧的 LP 成交价覆盖份额价值。
  rates.forEach((_ticker, key) => {
    if (key.split('_').some(symbol => shareSymbols.has(symbol))) rates.delete(key);
  });

  const pending = new Map(pools);
  // 多轮解析允许池内持有另一种已能估值的 LP；循环依赖保持未估值。
  for (let pass = 0; pass < pools.size && pending.size; pass += 1) {
    let resolved = false;
    pending.forEach((pool, id) => {
      if (!Number.isFinite(pool.shareSupply) || pool.shareSupply <= 0 || !pool.reserves.length ||
        pool.reserves.some(reserve => !Number.isFinite(reserve.amount) || reserve.amount < 0)) return;
      for (const reference of pool.reserves) {
        const values = pool.reserves.map(reserve => {
          if (reserve.amount === 0) return 0;
          const rate = getAssetConversionRate(reserve.symbol, reference.symbol, rates);
          return rate > 0 ? reserve.amount * rate : NaN;
        });
        // 两种非零储备均能估值时才计入，避免把缺少行情的半边误算为零。
        const unitValue = values.reduce((sum, value) => sum + value, 0) / pool.shareSupply;
        if (!Number.isFinite(unitValue) || unitValue <= 0) continue;
        rates.set(`${pool.shareSymbol}_${reference.symbol}`, { latest: unitValue });
        pending.delete(id);
        resolved = true;
        break;
      }
    });
    if (!resolved) break;
  }
  return rates;
};
