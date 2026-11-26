import type { TickerData } from '../types';

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
  const invert = (value: string): string => {
    const price = Number(value);
    return Number.isFinite(price) && price > 0 ? String(1 / price) : '0';
  };
  return {
    ...raw,
    latest: invert(raw.latest),
    // Inverting a market also swaps bid and ask: 1 / highest bid is the new
    // lowest ask, and 1 / lowest ask is the new highest bid.
    lowest_ask: invert(raw.highest_bid),
    highest_bid: invert(raw.lowest_ask),
    percent_change: invertPercentChange(raw.percent_change),
  };
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
