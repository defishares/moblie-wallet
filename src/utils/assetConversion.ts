export interface TickerLike {
  latest: string | number;
}

/** Return the amount of `toAsset` represented by one `fromAsset`. */
export const getAssetConversionRate = (
  fromAsset: string,
  toAsset: string,
  tickerMap: Map<string, TickerLike>,
): number => {
  if (fromAsset === toAsset) return 1;

  const graph = new Map<string, Array<{ asset: string; rate: number }>>();
  tickerMap.forEach((ticker, key) => {
    const [base, quote] = key.split('_');
    const price = Number(ticker.latest);
    if (!base || !quote || !Number.isFinite(price) || price <= 0) return;
    graph.set(base, [...(graph.get(base) || []), { asset: quote, rate: price }]);
    graph.set(quote, [...(graph.get(quote) || []), { asset: base, rate: 1 / price }]);
  });

  const queue: Array<{ asset: string; rate: number }> = [{ asset: fromAsset, rate: 1 }];
  const visited = new Set([fromAsset]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.get(current.asset) || []) {
      if (edge.asset === toAsset) return current.rate * edge.rate;
      if (!visited.has(edge.asset)) {
        visited.add(edge.asset);
        queue.push({ asset: edge.asset, rate: current.rate * edge.rate });
      }
    }
  }
  return 0;
};
