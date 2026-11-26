/**
 * 市场行情状态管理
 * 
 * 数据结构：
 * 1. tickerMap: Ticker 数据
 * 2. favorites: 本地自选列表
 * 
 * 衍生数据（useMemo）：
 * - 完整市场列表
 * - 分组市场列表
 * - 自选列表
 * - 首页 Top5 列表
 * 
 * 注意：链上配置（chainConfigMap、appSettings）已迁移到 useChainConfigStore
 */

import { create } from 'zustand';
import { useMemo } from 'react';
import { localCacheManager } from '../services/local_cache_mgr';
import { useChainConfigStore } from './useChainConfigStore';
import {
  CURRENT_NETWORK,
  CURRENT_NETWORK_TYPE,
  DEFAULT_MAINNET_MARKET_GROUP,
} from '../config';
import type {
  MarketCategory,
  TickerData,
  SortState,
  IChainAppSettings,
  CustomTradingPair,
} from '../types';

type MarketDefinition = {
  groupKey: string;
  base: string;
  quote: string;
};

const MAX_CUSTOM_TRADING_PAIRS = 100;

/** 将通用配置中的市场列表转换为主区展示定义。IMarket.list 使用 [quote, base]。 */
const getConfiguredMainnetDefinitions = (
  appSettings: IChainAppSettings | null,
): MarketDefinition[] => {
  if (!appSettings?.markets || !Array.isArray(appSettings.markets)) return [];

  const definitions: MarketDefinition[] = [];
  const seen = new Set<string>();
  appSettings.markets.forEach(market => {
    if (!Array.isArray(market?.list)) return;
    market.list.forEach(pair => {
      if (!Array.isArray(pair) || pair.length < 2) return;
      const quote = String(pair[0] || '').trim().toUpperCase();
      const base = String(pair[1] || '').trim().toUpperCase();
      const key = `${base}_${quote}`;
      if (!base || !quote || base === quote || seen.has(key)) return;
      seen.add(key);
      definitions.push({ base, quote, groupKey: DEFAULT_MAINNET_MARKET_GROUP });
    });
  });
  return definitions;
};

/**
 * 测试网市场来自节点，链上应用配置用于给已有市场分组；主网市场完全由链上配置决定。
 */
const getMarketDefinitions = (
  appSettings: IChainAppSettings | null,
  customPairs: CustomTradingPair[] = [],
  chainPairs: { base: string; quote: string }[] = [],
): MarketDefinition[] => {
  const definitions: MarketDefinition[] = CURRENT_NETWORK_TYPE === 'mainnet'
    ? getConfiguredMainnetDefinitions(appSettings)
    : chainPairs.map(pair => {
      const configuredGroup = appSettings?.markets?.find(market =>
        market.list?.some(([quote, base]) => base === pair.base && quote === pair.quote))?.base.name;
      return { ...pair, groupKey: configuredGroup || DEFAULT_MAINNET_MARKET_GROUP };
    });

  // 自定义交易对仅保存在本地，但与链上/内置交易对共享行情数据流。
  const customGroupKey = appSettings?.parameters?.custom_pair_default_groupkey || 'custom';
  const existing = new Set(definitions.map(({ base, quote }) => `${base}_${quote}`));
  customPairs.forEach(pair => {
    const base = pair.baseSymbol.trim().toUpperCase();
    const quote = pair.quoteSymbol.trim().toUpperCase();
    const key = `${base}_${quote}`;
    if (base && quote && base !== quote && !existing.has(key)) {
      definitions.push({ groupKey: customGroupKey, base, quote });
      existing.add(key);
    }
  });

  return definitions;
};

// ============================================
// 类型定义
// ============================================

/**
 * 计算后的市场项（用于 UI 展示）
 */
export interface ComputedMarketItem {
  id: string;                  // 唯一标识
  symbol: string;              // 交易对符号，如 BTC/USDT
  baseAsset: string;           // 基础资产，如 BTC
  quoteAsset: string;          // 计价资产，如 USDT
  price: number;               // 最新价格
  change24h: number;           // 24小时涨跌幅（百分比）
  volume24h: number;           // 24小时成交额原始值（用于排序）
  volume24hDisplay: number;    // 24小时成交额（格式化后的显示值）
  volumeUnit: string;          // 成交额单位（亿、万、空）
  amount24h: number;           // 24小时成交量原始值（用于排序）
  amount24hDisplay: number;    // 24小时成交量（格式化后的显示值）
  amountUnit: string;          // 成交量单位（亿、万、空）
  high24h: number;             // 24小时最高价
  low24h: number;              // 24小时最低价
  groupKey: string;            // 所属分组 key
  isFavorite: boolean;         // 是否收藏
  color: string;               // 图标颜色
}

/**
 * 市场分组信息
 */
export interface MarketGroupInfo {
  key: string;                 // 分组 key
  name: string;                // 分组名称
  items: ComputedMarketItem[]; // 该分组下的市场项
}

/**
 * 市场 Store 状态接口
 */
interface MarketState {
  // ========== 市场数据 ==========
  /** Ticker 数据 Map，key 格式为 "BASE_QUOTE"（如 "BTC_USDT"） */
  tickerMap: Map<string, TickerData>;

  /** 收藏的交易对列表，格式为 "BASE_QUOTE" */
  favorites: string[];

  /** 用户本地添加的交易对 */
  customPairs: CustomTradingPair[];

  chainPairs: { base: string; quote: string }[];
  chainMarketsLoaded: boolean;
  chainMarketsLoading: boolean;
  chainMarketsError: string | null;
  chainMarketsUpdatedAt: number;
  /** null 表示全部报价币种。 */
  selectedQuoteAsset: string | null;
  defaultQuoteAsset: string;
  /** 用户是否手动选择过报价币种；未选择时跟随资产页估值币种。 */
  quoteAssetSelectionTouched: boolean;

  /** 数据是否已加载 */
  isLoaded: boolean;

  // ========== UI 状态 ==========
  /** 当前选中的市场分类 */
  selectedCategory: MarketCategory;

  /** 市场列表排序状态 */
  sortState: SortState;

  /** 搜索关键词 */
  searchKeyword: string;

  // ========== Actions ==========
  /** 批量更新 Ticker 数据 */
  updateTickers: (tickers: Map<string, TickerData>) => void;
  updateChainMarkets: (tickers: Map<string, TickerData>) => void;
  setSelectedQuoteAsset: (asset: string | null) => void;
  setDefaultQuoteAsset: (asset: string) => void;

  /** 更新单个 Ticker */
  updateTicker: (key: string, ticker: TickerData) => void;

  /** 设置收藏列表 */
  setFavorites: (favorites: string[]) => void;

  /** 切换收藏状态 */
  toggleFavorite: (pairKey: string) => Promise<void>;

  /** 设置数据加载状态 */
  setLoaded: (loaded: boolean) => void;

  /** 设置当前分类 */
  setSelectedCategory: (category: MarketCategory) => void;

  /** 设置排序状态 */
  setSortState: (state: SortState) => void;

  /** 设置搜索关键词 */
  setSearchKeyword: (keyword: string) => void;

  /** 从本地加载收藏列表 */
  loadFavoritesFromCache: () => Promise<void>;

  /** 从本地加载自定义交易对 */
  loadCustomPairsFromCache: () => Promise<void>;

  /** 添加自定义交易对 */
  addCustomPair: (baseSymbol: string, quoteSymbol: string) => Promise<boolean>;

  /** 删除自定义交易对 */
  removeCustomPair: (pairKey: string) => Promise<void>;

  /** 重置 store */
  reset: () => void;

  /** 获取所有交易对列表（用于查询 ticker） */
  getAllPairs: () => { base: string; quote: string }[];
}

// ============================================
// 辅助函数
// ============================================

/**
 * 获取资产图标颜色
 */
const getAssetColor = (symbol: string): string => {
  const colorMap: Record<string, string> = {
    BTC: '#F7931A',
    ETH: '#627EEA',
    USDT: '#26A17B',
    SOL: '#9945FF',
    DOGE: '#C2A633',
    XRP: '#23292F',
    BCH: '#8DC351',
    PAXG: '#E4B831',
    HBW: '#00D094',
    OKB: '#2D60E0',
    BNB: '#F3BA2F',
  };
  return colorMap[symbol] || '#888888';
};

/**
 * 格式化数量（自动转换单位）
 */
const formatVolume = (value: number): { value: number; unit: string } => {
  if (value >= 100000000) {
    return { value: value / 100000000, unit: '亿' };
  } else if (value >= 10000) {
    return { value: value / 10000, unit: '万' };
  }
  return { value, unit: '' };
};

/**
 * 根据交易对和 ticker 计算市场项
 */
const computeMarketItemFromPair = (
  base: string,
  quote: string,
  groupKey: string,
  ticker: TickerData | undefined,
  favorites: string[],
  index: number
): ComputedMarketItem => {
  const pairKey = `${base}_${quote}`;

  const price = ticker ? parseFloat(ticker.latest) || 0 : 0;
  const change24h = ticker ? parseFloat(ticker.percent_change) || 0 : 0;
  const quoteVolume = ticker ? parseFloat(ticker.quote_volume) || 0 : 0;
  const baseVolume = ticker ? parseFloat(ticker.base_volume) || 0 : 0;

  const volumeFormatted = formatVolume(quoteVolume);
  const amountFormatted = formatVolume(baseVolume);

  return {
    id: `${groupKey}_${index}`,
    symbol: `${base}/${quote}`,
    baseAsset: base,
    quoteAsset: quote,
    price,
    change24h,
    volume24h: quoteVolume,
    volume24hDisplay: volumeFormatted.value,
    volumeUnit: volumeFormatted.unit,
    amount24h: baseVolume,
    amount24hDisplay: amountFormatted.value,
    amountUnit: amountFormatted.unit,
    high24h: ticker ? price * 1.02 : 0,
    low24h: ticker ? price * 0.98 : 0,
    groupKey,
    isFavorite: favorites.includes(pairKey),
    color: getAssetColor(base),
  };
};

// ============================================
// 创建 Store
// ============================================

export const useMarketStore = create<MarketState>()((set, get) => ({
  // ========== 初始状态 ==========
  tickerMap: new Map(),
  favorites: [],
  customPairs: [],
  chainPairs: [],
  chainMarketsLoaded: false,
  chainMarketsLoading: false,
  chainMarketsError: null,
  chainMarketsUpdatedAt: 0,
  selectedQuoteAsset: null,
  defaultQuoteAsset: CURRENT_NETWORK.defaultQuoteAsset,
  quoteAssetSelectionTouched: false,
  isLoaded: false,
  selectedCategory: 'favorites',
  sortState: {
    field: 'volume',
    direction: 'none',
  },
  searchKeyword: '',

  // ========== Actions ==========
  updateTickers: (tickers) => {
    set({ tickerMap: new Map(tickers) });
  },

  updateChainMarkets: (tickers) => {
    const chainPairs = Array.from(tickers.values(), ticker => ({ base: ticker.base, quote: ticker.quote }));
    const mergedTickers = new Map(get().tickerMap);
    tickers.forEach((ticker, key) => mergedTickers.set(key, ticker));
    const state = get();
    const preferredQuoteAsset = state.quoteAssetSelectionTouched ? state.selectedQuoteAsset : state.defaultQuoteAsset;
    set({
      chainPairs,
      tickerMap: mergedTickers,
      chainMarketsLoaded: true,
      chainMarketsLoading: false,
      chainMarketsError: null,
      chainMarketsUpdatedAt: Date.now(),
      selectedQuoteAsset: chainPairs.some(pair => pair.quote === preferredQuoteAsset) ? preferredQuoteAsset : null,
    });
  },

  setSelectedQuoteAsset: (asset) => set({ selectedQuoteAsset: asset, quoteAssetSelectionTouched: true }),

  setDefaultQuoteAsset: (asset) => {
    set({
      defaultQuoteAsset: asset,
      quoteAssetSelectionTouched: false,
      selectedQuoteAsset: get().chainPairs.some(pair => pair.quote === asset) ? asset : null,
    });
  },

  updateTicker: (key, ticker) => {
    const { tickerMap } = get();
    const newMap = new Map(tickerMap);
    newMap.set(key, ticker);
    set({ tickerMap: newMap });
  },

  setFavorites: (favorites) => {
    set({ favorites });
  },

  loadCustomPairsFromCache: async () => {
    try {
      const seen = new Set<string>();
      const customPairs = localCacheManager.loadCustomTradingPairs()
        .map(pair => {
          const base = String(pair.baseSymbol || '').trim().toUpperCase();
          const quote = String(pair.quoteSymbol || '').trim().toUpperCase();
          return {
            ...pair,
            baseSymbol: base,
            quoteSymbol: quote,
            pairKey: `${base}_${quote}`,
          };
        })
        .filter(pair => {
          if (!pair.baseSymbol || !pair.quoteSymbol || pair.baseSymbol === pair.quoteSymbol || seen.has(pair.pairKey)) {
            return false;
          }
          seen.add(pair.pairKey);
          return true;
        });
      set({ customPairs });
      console.log(`[MarketStore] 从缓存加载了 ${customPairs.length} 个自定义交易对`);
    } catch (error) {
      console.error('[MarketStore] 加载自定义交易对失败:', error);
    }
  },

  addCustomPair: async (baseSymbol, quoteSymbol) => {
    const base = baseSymbol.trim().toUpperCase();
    const quote = quoteSymbol.trim().toUpperCase();
    if (!base || !quote || base === quote) {
      return false;
    }

    const pairKey = `${base}_${quote}`;
    const { customPairs } = get();
    const appSettings = useChainConfigStore.getState().appSettings;
    if (
      customPairs.some(pair => pair.pairKey === pairKey) ||
      getMarketDefinitions(appSettings, [], get().chainPairs).some(pair => `${pair.base}_${pair.quote}` === pairKey)
    ) {
      return false;
    }
    if (customPairs.length >= MAX_CUSTOM_TRADING_PAIRS) {
      return false;
    }

    const pair: CustomTradingPair = {
      pairKey,
      baseSymbol: base,
      quoteSymbol: quote,
      addedAt: Date.now(),
      lastValidatedAt: Date.now(),
    };
    const nextPairs = [...customPairs, pair];
    localCacheManager.saveCustomTradingPairs(nextPairs);
    set({ customPairs: nextPairs });
    return true;
  },

  removeCustomPair: async (pairKey) => {
    const nextPairs = get().customPairs.filter(pair => pair.pairKey !== pairKey);
    const nextFavorites = get().favorites.filter(favorite => favorite !== pairKey);
    localCacheManager.saveCustomTradingPairs(nextPairs);
    localCacheManager.saveFavorites(nextFavorites);
    set({ customPairs: nextPairs, favorites: nextFavorites });
  },

  toggleFavorite: async (pairKey) => {
    const { favorites } = get();
    const isFavorite = favorites.includes(pairKey);

    let newFavorites: string[];
    if (isFavorite) {
      newFavorites = favorites.filter(f => f !== pairKey);
      localCacheManager.removeFavorite(pairKey);
    } else {
      newFavorites = [...favorites, pairKey];
      localCacheManager.addFavorite(pairKey);
    }

    set({ favorites: newFavorites });
  },

  setLoaded: (loaded) => {
    set({ isLoaded: loaded });
  },

  setSelectedCategory: (category) => {
    set({ selectedCategory: category });
  },

  setSortState: (state) => {
    set({ sortState: state });
  },

  setSearchKeyword: (keyword) => {
    set({ searchKeyword: keyword });
  },

  loadFavoritesFromCache: async () => {
    try {
      // 从内存同步读取（数据已在 localCacheManager.initialize() 时加载）
      const favorites = localCacheManager.loadFavorites();
      set({ favorites });
      console.log(`[MarketStore] 从缓存加载了 ${favorites.length} 个自选`);
    } catch (error) {
      console.error('[MarketStore] 加载自选列表失败:', error);
    }
  },

  reset: () => {
    set({
      tickerMap: new Map(),
      favorites: [],
      customPairs: [],
      chainPairs: [],
      chainMarketsLoaded: false,
      chainMarketsLoading: false,
      chainMarketsError: null,
      chainMarketsUpdatedAt: 0,
      selectedQuoteAsset: null,
      defaultQuoteAsset: CURRENT_NETWORK.defaultQuoteAsset,
      quoteAssetSelectionTouched: false,
      isLoaded: false,
      selectedCategory: 'favorites',
      sortState: { field: 'volume', direction: 'none' },
      searchKeyword: '',
    });
  },

  getAllPairs: () => {
    // 从 ChainConfigStore 获取 appSettings
    const appSettings = useChainConfigStore.getState().appSettings;
    const { customPairs, chainPairs } = get();
    const pairsSet = new Set<string>();
    const pairs: { base: string; quote: string }[] = [];

    getMarketDefinitions(appSettings, customPairs, chainPairs).forEach(({ base, quote }) => {
      const key = `${base}_${quote}`;
      if (!pairsSet.has(key)) {
        pairsSet.add(key);
        pairs.push({ base, quote });
      }
    });

    // 自选列表只用于展示状态；自定义交易对已在上面的定义合并阶段加入。
    // favorites.forEach(pairKey => {
    //   if (!pairsSet.has(pairKey)) {
    //     const [base, quote] = pairKey.split('_');
    //     if (base && quote) {
    //       pairsSet.add(pairKey);
    //       pairs.push({ base, quote });
    //     }
    //   }
    // });

    return pairs;
  },
}));

// ============================================
// 衍生数据 Hooks
// ============================================

/**
 * 获取完整的市场列表（所有分组的市场项）
 */
export const useComputedMarketList = (): ComputedMarketItem[] => {
  const appSettings = useChainConfigStore(state => state.appSettings);
  const tickerMap = useMarketStore(state => state.tickerMap);
  const favorites = useMarketStore(state => state.favorites);
  const customPairs = useMarketStore(state => state.customPairs);
  const chainPairs = useMarketStore(state => state.chainPairs);

  return useMemo(() => {
    const items: ComputedMarketItem[] = [];
    getMarketDefinitions(appSettings, customPairs, chainPairs).forEach(({ groupKey, base, quote }, index) => {
      const tickerKey = `${base}_${quote}`;
      const ticker = tickerMap.get(tickerKey);
      items.push(computeMarketItemFromPair(base, quote, groupKey, ticker, favorites, index));
    });

    return items;
  }, [appSettings, tickerMap, favorites, customPairs, chainPairs]);
};

/**
 * 获取自选列表（响应式）
 * 会过滤掉链上市场配置中不存在的交易对
 */
export const useFavoritesList = (): ComputedMarketItem[] => {
  const appSettings = useChainConfigStore(state => state.appSettings);
  const tickerMap = useMarketStore(state => state.tickerMap);
  const favorites = useMarketStore(state => state.favorites);
  const customPairs = useMarketStore(state => state.customPairs);
  const chainPairs = useMarketStore(state => state.chainPairs);

  return useMemo(() => {
    const validPairsSet = new Set(
      getMarketDefinitions(appSettings, customPairs, chainPairs).map(({ base, quote }) => `${base}_${quote}`)
    );

    // 过滤自选列表，只保留链上配置中存在的交易对
    return favorites
      .filter(pairKey => validPairsSet.has(pairKey))
      .map((pairKey, index) => {
        const [base, quote] = pairKey.split('_');
        const ticker = tickerMap.get(pairKey);
        return computeMarketItemFromPair(base, quote, 'favorites', ticker, favorites, index);
      });
  }, [appSettings, tickerMap, favorites, customPairs, chainPairs]);
};

/**
 * 获取指定分组的市场列表
 */
export const useMarketListByGroup = (groupKey: string): ComputedMarketItem[] => {
  const marketList = useComputedMarketList();

  return useMemo(() => {
    return marketList.filter(item => item.groupKey === groupKey);
  }, [marketList, groupKey]);
};

/**
 * 获取所有分组信息
 */
export const useMarketGroups = (): MarketGroupInfo[] => {
  const appSettings = useChainConfigStore(state => state.appSettings);
  const marketList = useComputedMarketList();
  const customPairs = useMarketStore(state => state.customPairs);
  const chainPairs = useMarketStore(state => state.chainPairs);

  return useMemo(() => {
    const groups: MarketGroupInfo[] = [];
    const groupKeys = [...new Set(getMarketDefinitions(appSettings, customPairs, chainPairs).map(item => item.groupKey))];
    groupKeys.forEach(groupKey => {
      groups.push({ key: groupKey, name: groupKey, items: marketList.filter(item => item.groupKey === groupKey) });
    });

    return groups;
  }, [appSettings, marketList, customPairs, chainPairs]);
};

/**
 * 获取过滤和排序后的市场列表（用于 MarketScreen）
 */
export const useFilteredMarketList = (): ComputedMarketItem[] => {
  const marketList = useComputedMarketList();
  const favoritesList = useFavoritesList();
  const selectedCategory = useMarketStore(state => state.selectedCategory);
  const sortState = useMarketStore(state => state.sortState);
  const searchKeyword = useMarketStore(state => state.searchKeyword);
  const selectedQuoteAsset = useMarketStore(state => state.selectedQuoteAsset);

  return useMemo(() => {
    // 1. 根据分类选择列表
    let filteredList: ComputedMarketItem[];
    if (selectedCategory === 'favorites') {
      filteredList = [...favoritesList];
    } else {
      // 按分组 key 过滤
      filteredList = marketList.filter(item => item.groupKey === selectedCategory);
    }

    if (selectedQuoteAsset) {
      filteredList = filteredList.filter(item => item.quoteAsset === selectedQuoteAsset);
    }

    // 2. 按搜索关键词过滤
    if (searchKeyword.trim()) {
      const keyword = searchKeyword.toLowerCase().trim();
      filteredList = filteredList.filter(item =>
        item.baseAsset.toLowerCase().includes(keyword) ||
        item.symbol.toLowerCase().includes(keyword)
      );
    }

    // 3. 排序
    if (sortState.direction !== 'none') {
      const { field, direction } = sortState;
      const multiplier = direction === 'asc' ? 1 : -1;

      filteredList = [...filteredList].sort((a, b) => {
        let compareValue = 0;
        switch (field) {
          case 'name':
            compareValue = a.baseAsset.localeCompare(b.baseAsset);
            break;
          case 'volume':
            compareValue = a.volume24h - b.volume24h;
            break;
          case 'price':
            compareValue = a.price - b.price;
            break;
          case 'change':
            compareValue = a.change24h - b.change24h;
            break;
        }
        return compareValue * multiplier;
      });
    }

    return filteredList;
  }, [marketList, favoritesList, selectedCategory, sortState, searchKeyword, selectedQuoteAsset]);
};

/**
 * 获取首页 Top5 列表（按涨跌幅降序，最多5个）
 */
export const useHomeTopList = (category: 'favorites' | string): ComputedMarketItem[] => {
  const marketList = useComputedMarketList();
  const favoritesList = useFavoritesList();

  return useMemo(() => {
    let list: ComputedMarketItem[];

    if (category === 'favorites') {
      list = [...favoritesList];
    } else {
      list = marketList.filter(item => item.groupKey === category);
    }

    // 按涨跌幅降序排列
    list.sort((a, b) => b.change24h - a.change24h);

    // 返回最多5个
    return list.slice(0, 5);
  }, [marketList, favoritesList, category]);
};

/**
 * 获取单个市场项
 */
export const useMarketItem = (baseAsset: string, quoteAsset: string): ComputedMarketItem | undefined => {
  const marketList = useComputedMarketList();
  const favoritesList = useFavoritesList();

  return useMemo(() => {
    // 先从完整列表找
    let item = marketList.find(
      item => item.baseAsset === baseAsset && item.quoteAsset === quoteAsset
    );

    // 如果没找到，从自选列表找
    if (!item) {
      item = favoritesList.find(
        item => item.baseAsset === baseAsset && item.quoteAsset === quoteAsset
      );
    }

    return item;
  }, [marketList, favoritesList, baseAsset, quoteAsset]);
};

// ============================================
// 非 Hook 选择器（用于组件外部调用）
// ============================================

/**
 * 获取当前的完整市场列表（非响应式）
 */
export const getComputedMarketList = (): ComputedMarketItem[] => {
  const marketState = useMarketStore.getState();
  const chainConfigState = useChainConfigStore.getState();
  const { tickerMap, favorites } = marketState;
  const { customPairs, chainPairs } = marketState;
  const { appSettings } = chainConfigState;

  const items: ComputedMarketItem[] = [];
  getMarketDefinitions(appSettings, customPairs, chainPairs).forEach(({ groupKey, base, quote }, index) => {
    const tickerKey = `${base}_${quote}`;
    const ticker = tickerMap.get(tickerKey);
    items.push(computeMarketItemFromPair(base, quote, groupKey, ticker, favorites, index));
  });

  return items;
};

/**
 * 获取自选列表（非响应式）
 * 会过滤掉链上市场配置中不存在的交易对
 */
export const getFavoritesList = (): ComputedMarketItem[] => {
  const marketState = useMarketStore.getState();
  const chainConfigState = useChainConfigStore.getState();
  const { tickerMap, favorites } = marketState;
  const { customPairs, chainPairs } = marketState;
  const { appSettings } = chainConfigState;

  const validPairsSet = new Set(
    getMarketDefinitions(appSettings, customPairs, chainPairs).map(({ base, quote }) => `${base}_${quote}`)
  );

  // 过滤自选列表，只保留链上配置中存在的交易对
  return favorites
    .filter(pairKey => validPairsSet.has(pairKey))
    .map((pairKey, index) => {
      const [base, quote] = pairKey.split('_');
      const ticker = tickerMap.get(pairKey);
      return computeMarketItemFromPair(base, quote, 'favorites', ticker, favorites, index);
    });
};

export default useMarketStore;
