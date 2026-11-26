const QUOTE_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
  KRW: '₩',
};

/** Display a market price in its actual quote currency, including the symbol. */
export const formatQuotePrice = (price: number, quoteAsset: string, format: (value: number) => string): string => {
  const symbol = QUOTE_SYMBOLS[quoteAsset];
  return symbol ? `≈ ${symbol}${format(price)}` : `≈ ${format(price)} ${quoteAsset}`;
};
