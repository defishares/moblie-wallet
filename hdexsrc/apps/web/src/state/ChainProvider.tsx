import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  GrapheneRpcClient,
  type AccountAssetBalance,
  type AccountHistoryEntry,
  type AccountOrder,
  type CancelOrderPreview,
  type FullAccountData,
  type LimitOrderPreview,
  type LendingOverview,
  type LendingPreview,
  type LiquidityPool,
  type LiquidityPreview,
  type KLineData,
  type MarketPair,
  type MarketTrade,
  type MarketTicker,
  type OrderBookData,
  type StorageAdapter,
  type TransferPreview,
} from '@defishares/core';
import { IndexedDbStorage } from '../platform/IndexedDbStorage';
import { defaultPairs, runtimeConfig, webSocketNodes } from '../services/runtime';
import { authenticateAccountPassword, type WebWalletSession } from '../auth/accountPassword';
import { signOperation, signTransferPreview } from '../services/transferSigning';

export type ConnectionStatus = 'connecting' | 'connected' | 'offline' | 'error';

interface AccountAssets {
  account: FullAccountData['account'];
  balances: AccountAssetBalance[];
}

interface ChainContextValue {
  client: GrapheneRpcClient;
  storage: StorageAdapter;
  status: ConnectionStatus;
  error: string | null;
  connectedUrl: string | null;
  tickers: MarketTicker[];
  favoriteKeys: string[];
  valuationAsset: string;
  setValuationAsset: (asset: string) => Promise<void>;
  toggleFavorite: (key: string) => Promise<void>;
  refreshTickers: () => Promise<void>;
  loadOrderBook: (pair: MarketPair, limit?: number) => Promise<OrderBookData>;
  loadKlines: (pair: MarketPair, bucketSeconds?: number) => Promise<KLineData[]>;
  loadRecentTrades: (pair: MarketPair, limit?: number) => Promise<MarketTrade[]>;
  loadAccountAssets: (nameOrId: string) => Promise<AccountAssets>;
  loadAccountOrders: (nameOrId: string) => Promise<{ account: FullAccountData['account']; orders: AccountOrder[] }>;
  loadAccountHistory: (nameOrId: string, limit?: number) => Promise<AccountHistoryEntry[]>;
  prefetchAccountData: (nameOrId: string) => Promise<void>;
  loadTransferPreview: (params: { fromAccountNameOrId: string; toAccountNameOrId: string; assetSymbolOrId: string; amount: string; feeAssetId?: string; memo?: string }) => Promise<TransferPreview>;
  loadLimitOrderPreview: (params: { accountNameOrId: string; baseSymbolOrId: string; quoteSymbolOrId: string; side: 'buy' | 'sell'; amount: string; price: string; feeAssetId?: string }) => Promise<LimitOrderPreview>;
  loadCancelOrderPreview: (accountNameOrId: string, orderId: string, feeAssetId?: string) => Promise<CancelOrderPreview>;
  loadLendingOverview: (accountNameOrId: string) => Promise<LendingOverview>;
  loadLendingPreview: (params: { accountNameOrId: string; debtAssetSymbolOrId: string; targetCollateral: string; targetDebt: string; feeAssetId?: string }) => Promise<LendingPreview>;
  loadLiquidityPools: (limit?: number) => Promise<LiquidityPool[]>;
  loadLiquidityPoolHistory: (poolId: string, limit?: number) => Promise<Array<Record<string, unknown>>>;
  loadLiquidityPreview: (params: Parameters<GrapheneRpcClient['getLiquidityPreview']>[0]) => Promise<LiquidityPreview>;
  signTransferPreview: (preview: TransferPreview, privateKeyWif: string) => Promise<Record<string, unknown>>;
  signOperation: (operationName: string, operation: Record<string, unknown>, privateKeyWif: string) => Promise<Record<string, unknown>>;
  broadcastTransaction: (transaction: Record<string, unknown>) => Promise<unknown>;
  authenticateAccount: (accountName: string, password: string) => Promise<WebWalletSession>;
  switchNode: (url: string) => Promise<void>;
  customNodes: string[];
  addCustomNode: (url: string) => Promise<void>;
  removeCustomNode: (url: string) => Promise<void>;
  addCustomPair: (pair: MarketPair) => Promise<void>;
  removeCustomPair: (pair: MarketPair) => Promise<void>;
  customPairs: MarketPair[];
}

const ChainContext = createContext<ChainContextValue | null>(null);

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef(new GrapheneRpcClient());
  const storageRef = useRef<StorageAdapter>(new IndexedDbStorage(runtimeConfig.channel.type));
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [connectedUrl, setConnectedUrl] = useState<string | null>(null);
  const [tickers, setTickers] = useState<MarketTicker[]>([]);
  const [favoriteKeys, setFavoriteKeys] = useState<string[]>([]);
  const [pairs, setPairs] = useState<MarketPair[]>(defaultPairs);
  const [customNodes, setCustomNodes] = useState<string[]>([]);
  const [valuationAsset, setValuationAssetState] = useState(runtimeConfig.network.defaultQuoteAsset);
  const pairsRef = useRef<MarketPair[]>(defaultPairs);
  const accountAssetsCacheRef = useRef(new Map<string, AccountAssets>());
  const accountAssetsInflightRef = useRef(new Map<string, Promise<AccountAssets>>());
  const accountOrdersCacheRef = useRef(new Map<string, { account: FullAccountData['account']; orders: AccountOrder[] }>());
  const accountOrdersInflightRef = useRef(new Map<string, Promise<{ account: FullAccountData['account']; orders: AccountOrder[] }>>());
  const lendingCacheRef = useRef(new Map<string, LendingOverview>());
  const lendingInflightRef = useRef(new Map<string, Promise<LendingOverview>>());

  useEffect(() => {
    void storageRef.current.get<string>('asset_valuation.v1').then(saved => {
      if (saved && ['CNY', 'USD', 'USDT', 'GOLD'].includes(saved)) setValuationAssetState(saved);
    }).catch(() => undefined);
  }, []);

  const clearAccountCache = useCallback((nameOrId?: string) => {
    if (nameOrId) {
      accountAssetsCacheRef.current.delete(nameOrId);
      accountOrdersCacheRef.current.delete(nameOrId);
      lendingCacheRef.current.delete(nameOrId);
      return;
    }
    accountAssetsCacheRef.current.clear();
    accountOrdersCacheRef.current.clear();
    lendingCacheRef.current.clear();
  }, []);

  const refreshTickers = useCallback(async () => {
    const result = await clientRef.current.getTickers(pairsRef.current);
    setTickers(result);
  }, []);

  const loadConfiguredPairs = useCallback(async () => {
    try {
      const fallbackNode = runtimeConfig.network.wsNodes
        .map(node => node.url)
        .find(url => url !== clientRef.current.url);
      const rows = await clientRef.current.getStorageInfo(
        runtimeConfig.channel.onChainSettingsAccount,
        'app.settings.v2',
        fallbackNode || runtimeConfig.network.defaultWsNode,
        runtimeConfig.network.chainId,
      );
      const marketRow = rows.find(row => row?.key === 'mainnet.markets.v1' || row?.key === 'common.settings.ver.v1');
      const configured: MarketPair[] = Array.isArray(marketRow?.value?.markets) ? marketRow.value.markets.flatMap((market: any) =>
        Array.isArray(market?.list) ? market.list.flatMap((item: unknown) => {
          if (!Array.isArray(item) || item.length < 2) return [];
          const quote = String(item[0] ?? '').toUpperCase();
          const base = String(item[1] ?? '').toUpperCase();
          return base && quote && base !== quote ? [{ base, quote }] : [];
        }) : [],
      ) : [];
      const unique: MarketPair[] = [...new Map(configured.map((pair: MarketPair) => [`${pair.base}_${pair.quote}`, pair] as const)).values()];
      if (unique.length) {
        const custom = pairsRef.current.filter(pair => !defaultPairs.some(base => base.base === pair.base && base.quote === pair.quote));
        const merged = [...new Map([...unique, ...custom].map(pair => [`${pair.base}_${pair.quote}`, pair] as const)).values()];
        pairsRef.current = merged;
        setPairs(merged);
      }
    } catch {
      // The app still has safe defaults when the optional storage API is unavailable.
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const client = clientRef.current;
    const start = async () => {
      try {
        const savedFavorites = await storageRef.current.get<string[]>('favorite_markets.v1');
        if (!disposed && savedFavorites) setFavoriteKeys(savedFavorites);
        const savedNodes = await storageRef.current.get<string[]>('custom_ws_nodes.v1');
        if (!disposed && savedNodes) setCustomNodes(savedNodes);
        const savedPairs = await storageRef.current.get<MarketPair[]>('custom_pairs.v1');
        if (!disposed && savedPairs?.length) { pairsRef.current = [...defaultPairs, ...savedPairs]; setPairs(pairsRef.current); }
        const result = await client.connectWithFallback(
          webSocketNodes,
          runtimeConfig.network.chainId,
        );
        if (disposed) return;
        setConnectedUrl(result.url);
        setStatus('connected');
        setError(null);
        // Render the safe built-in market set immediately. The optional
        // custom_operations reader may need a fallback node and must not
        // block the first visible ticker data.
        await refreshTickers();
        await loadConfiguredPairs();
        if (pairsRef.current.length) await refreshTickers();
      } catch (cause) {
        if (!disposed) {
          setStatus('error');
          setError(cause instanceof Error ? cause.message : '无法连接到区块链节点');
        }
      }
    };
    void start();
    return () => {
      disposed = true;
      void client.disconnect();
    };
  }, [loadConfiguredPairs, refreshTickers]);

  useEffect(() => {
    if (status !== 'connected') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') {
          try { await refreshTickers(); } catch { /* connection status is surfaced by the next request */ }
        }
        schedule();
      }, 15_000);
    };
    schedule();
    const onVisibility = () => { if (document.visibilityState === 'visible') void refreshTickers(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshTickers, status]);

  const toggleFavorite = useCallback(async (key: string) => {
    const next = favoriteKeys.includes(key) ? favoriteKeys.filter(item => item !== key) : [...favoriteKeys, key];
    setFavoriteKeys(next);
    await storageRef.current.set('favorite_markets.v1', next);
  }, [favoriteKeys]);

  const loadOrderBook = useCallback((pair: MarketPair, limit = 30) => clientRef.current.getOrderBook(pair.base, pair.quote, limit), []);
  const loadKlines = useCallback((pair: MarketPair, bucketSeconds = 3_600) => clientRef.current.getMarketHistory(pair.base, pair.quote, bucketSeconds), []);
  const loadRecentTrades = useCallback((pair: MarketPair, limit = 30) => clientRef.current.getRecentTrades(pair.base, pair.quote, limit), []);
  const loadAccountAssets = useCallback((nameOrId: string) => {
    const cached = accountAssetsCacheRef.current.get(nameOrId);
    if (cached) return Promise.resolve(cached);
    const inflight = accountAssetsInflightRef.current.get(nameOrId);
    if (inflight) return inflight;
    const request = clientRef.current.getAccountAssets(nameOrId).then(result => {
      accountAssetsCacheRef.current.set(nameOrId, result);
      return result;
    }).finally(() => accountAssetsInflightRef.current.delete(nameOrId));
    accountAssetsInflightRef.current.set(nameOrId, request);
    return request;
  }, []);
  const loadAccountOrders = useCallback((nameOrId: string) => {
    const cached = accountOrdersCacheRef.current.get(nameOrId);
    if (cached) return Promise.resolve(cached);
    const inflight = accountOrdersInflightRef.current.get(nameOrId);
    if (inflight) return inflight;
    const request = clientRef.current.getAccountOrders(nameOrId).then(result => {
      accountOrdersCacheRef.current.set(nameOrId, result);
      return result;
    }).finally(() => accountOrdersInflightRef.current.delete(nameOrId));
    accountOrdersInflightRef.current.set(nameOrId, request);
    return request;
  }, []);
  const loadAccountHistory = useCallback((nameOrId: string, limit = 20) => clientRef.current.getAccountHistory(nameOrId, limit), []);
  const loadTransferPreview = useCallback((params: { fromAccountNameOrId: string; toAccountNameOrId: string; assetSymbolOrId: string; amount: string; feeAssetId?: string; memo?: string }) => clientRef.current.getTransferPreview(params), []);
  const loadLimitOrderPreview = useCallback((params: { accountNameOrId: string; baseSymbolOrId: string; quoteSymbolOrId: string; side: 'buy' | 'sell'; amount: string; price: string; feeAssetId?: string }) => clientRef.current.getLimitOrderPreview(params), []);
  const loadCancelOrderPreview = useCallback((accountNameOrId: string, orderId: string, feeAssetId?: string) => clientRef.current.getCancelOrderPreview(accountNameOrId, orderId, feeAssetId), []);
  const loadLendingOverview = useCallback((accountNameOrId: string) => {
    const cached = lendingCacheRef.current.get(accountNameOrId);
    if (cached) return Promise.resolve(cached);
    const inflight = lendingInflightRef.current.get(accountNameOrId);
    if (inflight) return inflight;
    const request = clientRef.current.getLendingOverview(accountNameOrId).then(result => {
      lendingCacheRef.current.set(accountNameOrId, result);
      return result;
    }).finally(() => lendingInflightRef.current.delete(accountNameOrId));
    lendingInflightRef.current.set(accountNameOrId, request);
    return request;
  }, []);
  const prefetchAccountData = useCallback(async (nameOrId: string) => {
    await Promise.allSettled([loadAccountAssets(nameOrId), loadAccountOrders(nameOrId), loadLendingOverview(nameOrId)]);
  }, [loadAccountAssets, loadAccountOrders, loadLendingOverview]);
  const setValuationAsset = useCallback(async (asset: string) => {
    if (!['CNY', 'USD', 'USDT', 'GOLD'].includes(asset)) return;
    setValuationAssetState(asset);
    await storageRef.current.set('asset_valuation.v1', asset);
  }, []);
  const loadLendingPreview = useCallback((params: { accountNameOrId: string; debtAssetSymbolOrId: string; targetCollateral: string; targetDebt: string; feeAssetId?: string }) => clientRef.current.getLendingPreview(params), []);
  const loadLiquidityPools = useCallback((limit = 100) => clientRef.current.getLiquidityPools(limit), []);
  const loadLiquidityPoolHistory = useCallback((poolId: string, limit = 50) => clientRef.current.getLiquidityPoolHistory(poolId, undefined, undefined, limit), []);
  const loadLiquidityPreview = useCallback((params: Parameters<GrapheneRpcClient['getLiquidityPreview']>[0]) => clientRef.current.getLiquidityPreview(params), []);
  const signPreview = useCallback((preview: TransferPreview, privateKeyWif: string) => signTransferPreview(clientRef.current, preview, privateKeyWif), []);
  const signGenericOperation = useCallback((operationName: string, operation: Record<string, unknown>, privateKeyWif: string) => signOperation(clientRef.current, operationName, operation, privateKeyWif), []);
  const broadcastTransaction = useCallback(async (transaction: Record<string, unknown>) => {
    const result = await clientRef.current.broadcastTransaction(transaction);
    clearAccountCache();
    return result;
  }, [clearAccountCache]);
  const authenticateAccount = useCallback(
    (accountName: string, password: string) => authenticateAccountPassword(clientRef.current, accountName, password),
    [],
  );
  const switchNode = useCallback(async (url: string) => {
    clearAccountCache();
    setStatus('connecting'); setError(null);
    try { const result = await clientRef.current.connect(url, runtimeConfig.network.chainId); setConnectedUrl(result.url); setStatus('connected'); await refreshTickers(); }
    catch (cause) { setStatus('error'); setError(cause instanceof Error ? cause.message : '节点连接失败'); throw cause; }
  }, [clearAccountCache, refreshTickers]);
  const addCustomNode = useCallback(async (url: string) => { const normalized = url.trim(); if (!/^wss?:\/\//i.test(normalized)) throw new Error('节点必须是 ws:// 或 wss:// 地址'); await switchNode(normalized); const next = [...new Set([...customNodes, normalized])]; setCustomNodes(next); await storageRef.current.set('custom_ws_nodes.v1', next); }, [customNodes, switchNode]);
  const removeCustomNode = useCallback(async (url: string) => { const next = customNodes.filter(item => item !== url); setCustomNodes(next); await storageRef.current.set('custom_ws_nodes.v1', next); }, [customNodes]);
  const addCustomPair = useCallback(async (pair: MarketPair) => { const normalized = { base: pair.base.trim().toUpperCase(), quote: pair.quote.trim().toUpperCase() }; if (!normalized.base || !normalized.quote || normalized.base === normalized.quote) throw new Error('请输入不同的基础资产和计价资产'); const assets = await clientRef.current.lookupAssets([normalized.base, normalized.quote]); if (!assets[0] || !assets[1]) throw new Error('交易对资产不存在'); const nextPairs = [...pairsRef.current.filter(item => item.base !== normalized.base || item.quote !== normalized.quote), normalized]; pairsRef.current = nextPairs; setPairs(nextPairs); const saved = nextPairs.filter(item => !defaultPairs.some(base => base.base === item.base && base.quote === item.quote)); await storageRef.current.set('custom_pairs.v1', saved); await refreshTickers(); }, [refreshTickers]);
  const removeCustomPair = useCallback(async (pair: MarketPair) => { const nextPairs = pairsRef.current.filter(item => item.base !== pair.base || item.quote !== pair.quote); pairsRef.current = nextPairs; setPairs(nextPairs); const saved = nextPairs.filter(item => !defaultPairs.some(base => base.base === item.base && base.quote === item.quote)); await storageRef.current.set('custom_pairs.v1', saved); setTickers(current => current.filter(item => item.base !== pair.base || item.quote !== pair.quote)); }, []);

  const value = useMemo<ChainContextValue>(() => ({
    client: clientRef.current,
    storage: storageRef.current,
    status,
    error,
    connectedUrl,
    tickers,
    favoriteKeys,
    valuationAsset,
    setValuationAsset,
    toggleFavorite,
    refreshTickers,
    loadOrderBook,
    loadKlines,
    loadRecentTrades,
    loadAccountAssets,
    loadAccountOrders,
    loadAccountHistory,
    prefetchAccountData,
    loadTransferPreview,
    loadLimitOrderPreview,
    loadCancelOrderPreview,
    loadLendingOverview,
    loadLendingPreview,
    loadLiquidityPools,
    loadLiquidityPoolHistory,
    loadLiquidityPreview,
    signTransferPreview: signPreview,
    signOperation: signGenericOperation,
    broadcastTransaction,
    authenticateAccount,
    switchNode,
    customNodes,
    addCustomNode,
    removeCustomNode,
    addCustomPair,
    removeCustomPair,
    customPairs: pairs.filter(item => !defaultPairs.some(base => base.base === item.base && base.quote === item.quote)),
  }), [addCustomNode, addCustomPair, authenticateAccount, broadcastTransaction, connectedUrl, customNodes, error, favoriteKeys, loadAccountAssets, loadAccountHistory, loadAccountOrders, loadCancelOrderPreview, loadKlines, loadRecentTrades, loadLendingOverview, loadLendingPreview, loadLiquidityPoolHistory, loadLiquidityPools, loadLiquidityPreview, loadLimitOrderPreview, loadOrderBook, loadTransferPreview, pairs, prefetchAccountData, refreshTickers, removeCustomNode, removeCustomPair, setValuationAsset, signGenericOperation, signPreview, status, switchNode, tickers, toggleFavorite, valuationAsset]);

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain(): ChainContextValue {
  const context = useContext(ChainContext);
  if (!context) throw new Error('useChain 必须在 ChainProvider 内使用');
  return context;
}
