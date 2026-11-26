import type { TickerData } from '../types';
import { normalizeGrapheneTicker } from '@defishares/core/domain';

/** Convert a percentage when the displayed price is inverted (1 / price). */
export const invertPercentChange = (value: string): string => {
  const percent = Number(value);
  // If the source price reached zero, the inverse quote is undefined. Keep
  // the source value rather than inventing a finite percentage.
  if (!Number.isFinite(percent) || percent <= -100) return value;
  const inverted = (-percent / (100 + percent)) * 100;
  return Number.isFinite(inverted) ? String(inverted) : value;
};

/** Normalize the node's base/quote price to quote units per traded asset. */
export const normalizeMarketTicker = (raw: TickerData): TickerData => {
  return normalizeGrapheneTicker(raw);
};

/** Only accept pairs explicitly returned by the node; never combine arbitrary assets. */
export const buildChainMarketTickers = (rows: TickerData[]): Map<string, TickerData> => {
  const tickers = new Map<string, TickerData>();
  for (const row of rows) {
    if (!row?.base || !row.quote || row.base === row.quote) continue;
    tickers.set(`${row.base}_${row.quote}`, normalizeMarketTicker(row));
  }
  return tickers;
};
