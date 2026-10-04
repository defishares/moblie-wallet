export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export const STORAGE_KEYS = {
  favoriteMarkets: 'favorite_markets.v1',
  selectedNode: 'selected_node.v1',
  recentAccount: 'recent_account.v1',
  valuationAsset: 'valuation_asset.v1',
} as const;
