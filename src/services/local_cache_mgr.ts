/**
 * 本地缓存管理器
 * 使用 MMKV 实现高性能的内存 + 磁盘同步缓存
 * 
 * 设计思路：
 * 1. 启动时：加载所有数据到内存缓存
 * 2. 运行时：写入内存，同步写入磁盘（不阻塞）
 * 3. 读取时：直接从内存读取，无 IO 开销
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';
import { CURRENT_CHANNEL_TYPE } from '../config/constants';
import type {
  CachedMarketData,
  OnChainMarketConfig,
  StoredAccountsData,
  LastTradingPairData,
  CustomTradingPair,
  ApiNodeSettings,
  AssetObject,
} from '../types';
import { WsNodeConfig } from '../config/constants';

// ============================================
// MMKV 存储 Key 常量
// ============================================

const CACHE_KEYS = {
  // 市场相关
  MARKET_DATA: 'market_data',           // 市场数据缓存
  MARKET_CONFIG: 'market_config',       // 市场配置缓存
  USER_FAVORITES: 'user_favorites',     // 用户收藏列表
  POOL_FAVORITES: 'pool_favorites',     // 收藏的流动性池 ID
  CUSTOM_TRADING_PAIRS: 'custom_trading_pairs', // 用户自定义交易对
  LAST_SYNC_TIME: 'last_sync_time',     // 最后同步时间

  // 账号相关
  ACCOUNTS_DATA: 'accounts_data',       // 账号列表数据

  // 交易相关
  LAST_TRADING_PAIR: 'last_trading_pair', // 上次交易对

  // API 节点相关
  API_NODE_SETTINGS: 'api_node_settings', // API 节点设置
  CHAIN_WS_NODES: 'chain_ws_nodes',     // 链动态节点列表

  // 资产相关
  ASSET_CACHE: 'asset_cache',           // 资产对象缓存
  VALUATION_ASSET: 'valuation_asset',   // 用户选择的资产估值币种

  // 调试工具相关
  OBJECT_VIEWER_HISTORY: 'object_viewer_history', // 对象查看器查询历史
} as const;

// 缓存有效期（毫秒）
const CACHE_EXPIRY = {
  MARKET_DATA: 24 * 60 * 60 * 1000,     // 市场数据：24小时
  MARKET_CONFIG: 7 * 24 * 60 * 60 * 1000, // 市场配置：7天
  ASSET_CACHE: 2 * 24 * 60 * 60 * 1000,  // 资产缓存：2天
};

// ============================================
// 缓存数据类型定义
// ============================================

type CacheKey = typeof CACHE_KEYS[keyof typeof CACHE_KEYS];

/**
 * 带缓存时间的资产对象
 */
export interface CachedAssetObject {
  /** 缓存时间戳（该资产存入缓存的时间） */
  cacheTime: number;
  /** 资产对象 */
  asset: AssetObject;
}

/**
 * 资产缓存磁盘存储结构 { asset_id => CachedAssetObject }
 */
type AssetCacheDiskData = Record<string, CachedAssetObject>;

/**
 * 资产内存缓存结构（运行时使用）
 */
interface AssetMemoryCache {
  /** asset_id => CachedAssetObject（磁盘数据引用） */
  byId: AssetCacheDiskData;
  /** asset_symbol => CachedAssetObject */
  bySymbol: Record<string, CachedAssetObject>;
}

/**
 * 内存缓存数据结构
 */
interface MemoryCache {
  // 市场相关
  [CACHE_KEYS.MARKET_DATA]: CachedMarketData | null;
  [CACHE_KEYS.MARKET_CONFIG]: OnChainMarketConfig | null;
  [CACHE_KEYS.USER_FAVORITES]: string[];
  [CACHE_KEYS.POOL_FAVORITES]: string[];
  [CACHE_KEYS.CUSTOM_TRADING_PAIRS]: CustomTradingPair[];
  [CACHE_KEYS.LAST_SYNC_TIME]: number | null;

  // 账号相关
  [CACHE_KEYS.ACCOUNTS_DATA]: StoredAccountsData | null;

  // 交易相关
  [CACHE_KEYS.LAST_TRADING_PAIR]: LastTradingPairData | null;

  // API 节点相关
  [CACHE_KEYS.API_NODE_SETTINGS]: ApiNodeSettings | null;
  [CACHE_KEYS.CHAIN_WS_NODES]: WsNodeConfig[];

  // 资产相关
  [CACHE_KEYS.ASSET_CACHE]: AssetMemoryCache | null;
  [CACHE_KEYS.VALUATION_ASSET]: string | null;

  // 调试工具相关
  [CACHE_KEYS.OBJECT_VIEWER_HISTORY]: string[];
}

// ============================================
// LocalCacheManager 类
// ============================================

class LocalCacheManager {
  private static instance: LocalCacheManager;

  // MMKV 实例
  private mmkv: MMKV;

  // 内存缓存
  private cache: MemoryCache;

  // 是否已初始化
  private initialized: boolean = false;

  private constructor() {
    // 创建 MMKV 实例，ID 根据渠道类型区分
    const mmkvId = `hdex_cache_${CURRENT_CHANNEL_TYPE}`;
    this.mmkv = createMMKV({ id: mmkvId });

    console.log(`[LocalCacheManager] 初始化 MMKV，ID: ${mmkvId}`);

    // 初始化内存缓存
    this.cache = {
      [CACHE_KEYS.MARKET_DATA]: null,
      [CACHE_KEYS.MARKET_CONFIG]: null,
      [CACHE_KEYS.USER_FAVORITES]: [],
      [CACHE_KEYS.POOL_FAVORITES]: [],
      [CACHE_KEYS.CUSTOM_TRADING_PAIRS]: [],
      [CACHE_KEYS.LAST_SYNC_TIME]: null,
      [CACHE_KEYS.ACCOUNTS_DATA]: null,
      [CACHE_KEYS.LAST_TRADING_PAIR]: null,
      [CACHE_KEYS.API_NODE_SETTINGS]: null,
      [CACHE_KEYS.CHAIN_WS_NODES]: [],
      [CACHE_KEYS.ASSET_CACHE]: null,
      [CACHE_KEYS.VALUATION_ASSET]: null,
      [CACHE_KEYS.OBJECT_VIEWER_HISTORY]: [],
    };
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): LocalCacheManager {
    if (!LocalCacheManager.instance) {
      LocalCacheManager.instance = new LocalCacheManager();
    }
    return LocalCacheManager.instance;
  }

  // ============================================
  // 初始化方法
  // ============================================

  /**
   * 初始化缓存管理器
   * 从磁盘加载所有数据到内存
   * 应在应用启动时调用
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[LocalCacheManager] 已经初始化过，跳过');
      return;
    }

    console.log('[LocalCacheManager] 开始加载缓存数据...');

    try {
      // 并行加载所有数据到内存
      this.cache[CACHE_KEYS.MARKET_DATA] = this.loadFromDisk<CachedMarketData>(CACHE_KEYS.MARKET_DATA);
      this.cache[CACHE_KEYS.MARKET_CONFIG] = this.loadFromDisk<OnChainMarketConfig>(CACHE_KEYS.MARKET_CONFIG);
      this.cache[CACHE_KEYS.USER_FAVORITES] = this.loadFromDisk<string[]>(CACHE_KEYS.USER_FAVORITES) || [];
      this.cache[CACHE_KEYS.POOL_FAVORITES] = this.loadFromDisk<string[]>(CACHE_KEYS.POOL_FAVORITES) || [];
      this.cache[CACHE_KEYS.CUSTOM_TRADING_PAIRS] = this.loadFromDisk<CustomTradingPair[]>(CACHE_KEYS.CUSTOM_TRADING_PAIRS) || [];
      this.cache[CACHE_KEYS.LAST_SYNC_TIME] = this.loadFromDisk<number>(CACHE_KEYS.LAST_SYNC_TIME);
      this.cache[CACHE_KEYS.ACCOUNTS_DATA] = this.loadFromDisk<StoredAccountsData>(CACHE_KEYS.ACCOUNTS_DATA);
      this.cache[CACHE_KEYS.LAST_TRADING_PAIR] = this.loadFromDisk<LastTradingPairData>(CACHE_KEYS.LAST_TRADING_PAIR);
      this.cache[CACHE_KEYS.API_NODE_SETTINGS] = this.loadFromDisk<ApiNodeSettings>(CACHE_KEYS.API_NODE_SETTINGS);
      this.cache[CACHE_KEYS.CHAIN_WS_NODES] = this.loadFromDisk<WsNodeConfig[]>(CACHE_KEYS.CHAIN_WS_NODES) || [];
      this.cache[CACHE_KEYS.VALUATION_ASSET] = this.loadFromDisk<string>(CACHE_KEYS.VALUATION_ASSET);
      this.cache[CACHE_KEYS.OBJECT_VIEWER_HISTORY] = this.loadFromDisk<string[]>(CACHE_KEYS.OBJECT_VIEWER_HISTORY) || [];

      // 加载资产缓存并构建 bySymbol 索引
      const byId = this.loadFromDisk<AssetCacheDiskData>(CACHE_KEYS.ASSET_CACHE);
      if (byId && Object.keys(byId).length > 0) {
        this.cache[CACHE_KEYS.ASSET_CACHE] = this.buildAssetMemoryCache(byId);
        console.log(`[LocalCacheManager] 加载了 ${Object.keys(byId).length} 个资产缓存`);
      }

      this.initialized = true;
      console.log('[LocalCacheManager] 缓存数据加载完成');
    } catch (error) {
      console.error('[LocalCacheManager] 加载缓存数据失败:', error);
      this.initialized = true; // 即使失败也标记为已初始化，避免重复尝试
    }
  }

  /**
   * 从磁盘数据构建资产内存缓存（构建 bySymbol 索引）
   */
  private buildAssetMemoryCache(byId: AssetCacheDiskData): AssetMemoryCache {
    const bySymbol: Record<string, CachedAssetObject> = {};

    Object.values(byId).forEach(cachedAsset => {
      bySymbol[cachedAsset.asset.symbol] = cachedAsset;
    });

    return { byId, bySymbol };
  }

  /**
   * 检查是否已初始化
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================
  // 通用磁盘操作方法（同步）
  // ============================================

  /**
   * 从磁盘加载 JSON 数据
   */
  private loadFromDisk<T>(key: CacheKey): T | null {
    try {
      const jsonString = this.mmkv.getString(key);
      if (jsonString === undefined) {
        return null;
      }
      return JSON.parse(jsonString) as T;
    } catch (error) {
      console.error(`[LocalCacheManager] 从磁盘加载数据失败 key=${key}:`, error);
      return null;
    }
  }

  /**
   * 保存 JSON 数据到磁盘（同步写入）
   * 注意：MMKV 的 set 操作是同步的，但内部有优化，速度很快
   */
  private saveToDisk<T>(key: CacheKey, value: T): boolean {
    try {
      const jsonString = JSON.stringify(value);
      this.mmkv.set(key, jsonString);
      return true;
    } catch (error) {
      console.error(`[LocalCacheManager] 保存数据到磁盘失败 key=${key}:`, error);
      return false;
    }
  }

  /**
   * 从磁盘删除数据
   */
  private removeFromDisk(key: CacheKey): boolean {
    try {
      this.mmkv.remove(key);
      return true;
    } catch (error) {
      console.error(`[LocalCacheManager] 从磁盘删除数据失败 key=${key}:`, error);
      return false;
    }
  }

  // ============================================
  // 市场数据缓存
  // ============================================

  /**
   * 保存市场数据缓存
   */
  public saveMarketData(data: CachedMarketData): boolean {
    // 1. 更新内存
    this.cache[CACHE_KEYS.MARKET_DATA] = data;
    // 2. 同步写入磁盘（不阻塞，MMKV 很快）
    this.saveToDisk(CACHE_KEYS.MARKET_DATA, data);
    return true;
  }

  /**
   * 加载市场数据缓存
   * @param checkExpiry 是否检查过期（默认 true）
   */
  public loadMarketData(checkExpiry: boolean = true): CachedMarketData | null {
    const data = this.cache[CACHE_KEYS.MARKET_DATA];

    if (!data) {
      return null;
    }

    // 检查缓存是否过期
    if (checkExpiry) {
      const now = Date.now();
      const elapsed = now - data.cacheTime;
      if (elapsed > CACHE_EXPIRY.MARKET_DATA) {
        console.log('[LocalCacheManager] 市场数据缓存已过期');
        return null;
      }
    }

    return data;
  }

  /**
   * 清除市场数据缓存
   */
  public clearMarketData(): boolean {
    this.cache[CACHE_KEYS.MARKET_DATA] = null;
    this.removeFromDisk(CACHE_KEYS.MARKET_DATA);
    return true;
  }

  // ============================================
  // 市场配置缓存
  // ============================================

  /**
   * 保存市场配置
   */
  public saveMarketConfig(config: OnChainMarketConfig): boolean {
    this.cache[CACHE_KEYS.MARKET_CONFIG] = config;
    this.saveToDisk(CACHE_KEYS.MARKET_CONFIG, config);
    return true;
  }

  /**
   * 加载市场配置
   */
  public loadMarketConfig(): OnChainMarketConfig | null {
    return this.cache[CACHE_KEYS.MARKET_CONFIG];
  }

  /**
   * 清除市场配置
   */
  public clearMarketConfig(): boolean {
    this.cache[CACHE_KEYS.MARKET_CONFIG] = null;
    this.removeFromDisk(CACHE_KEYS.MARKET_CONFIG);
    return true;
  }

  // ============================================
  // 用户收藏
  // ============================================

  /**
   * 保存用户收藏列表
   * @param favorites 收藏的交易对数组，格式：["BTC_USDT", "ETH_USDT"]
   */
  public saveFavorites(favorites: string[]): boolean {
    this.cache[CACHE_KEYS.USER_FAVORITES] = [...favorites];
    this.saveToDisk(CACHE_KEYS.USER_FAVORITES, favorites);
    return true;
  }

  /**
   * 加载用户收藏列表
   */
  public loadFavorites(): string[] {
    return [...this.cache[CACHE_KEYS.USER_FAVORITES]];
  }

  /**
   * 添加到收藏
   */
  public addFavorite(pairKey: string): boolean {
    const favorites = this.cache[CACHE_KEYS.USER_FAVORITES];
    if (!favorites.includes(pairKey)) {
      favorites.push(pairKey);
      this.saveToDisk(CACHE_KEYS.USER_FAVORITES, favorites);
    }
    return true;
  }

  /**
   * 从收藏移除
   */
  public removeFavorite(pairKey: string): boolean {
    const favorites = this.cache[CACHE_KEYS.USER_FAVORITES];
    const index = favorites.indexOf(pairKey);
    if (index > -1) {
      favorites.splice(index, 1);
      this.saveToDisk(CACHE_KEYS.USER_FAVORITES, favorites);
    }
    return true;
  }

  /**
   * 检查是否已收藏
   */
  public isFavorite(pairKey: string): boolean {
    return this.cache[CACHE_KEYS.USER_FAVORITES].includes(pairKey);
  }

  public savePoolFavorites(poolIds: string[]): boolean {
    const favorites = [...new Set(poolIds)];
    if (!this.saveToDisk(CACHE_KEYS.POOL_FAVORITES, favorites)) return false;
    this.cache[CACHE_KEYS.POOL_FAVORITES] = favorites;
    return true;
  }

  public loadPoolFavorites(): string[] {
    return [...this.cache[CACHE_KEYS.POOL_FAVORITES]];
  }

  // ============================================
  // 用户自定义交易对
  // ============================================

  public saveCustomTradingPairs(pairs: CustomTradingPair[]): boolean {
    const normalized = pairs.map(pair => ({ ...pair }));
    this.cache[CACHE_KEYS.CUSTOM_TRADING_PAIRS] = normalized;
    this.saveToDisk(CACHE_KEYS.CUSTOM_TRADING_PAIRS, normalized);
    return true;
  }

  public loadCustomTradingPairs(): CustomTradingPair[] {
    return this.cache[CACHE_KEYS.CUSTOM_TRADING_PAIRS].map(pair => ({ ...pair }));
  }

  public addCustomTradingPair(pair: CustomTradingPair): boolean {
    const pairs = this.cache[CACHE_KEYS.CUSTOM_TRADING_PAIRS];
    if (!pairs.some(item => item.pairKey === pair.pairKey)) {
      pairs.push({ ...pair });
      this.saveToDisk(CACHE_KEYS.CUSTOM_TRADING_PAIRS, pairs);
    }
    return true;
  }

  public removeCustomTradingPair(pairKey: string): boolean {
    const pairs = this.cache[CACHE_KEYS.CUSTOM_TRADING_PAIRS].filter(item => item.pairKey !== pairKey);
    this.cache[CACHE_KEYS.CUSTOM_TRADING_PAIRS] = pairs;
    this.saveToDisk(CACHE_KEYS.CUSTOM_TRADING_PAIRS, pairs);
    return true;
  }

  // ============================================
  // 同步时间记录
  // ============================================

  /**
   * 更新最后同步时间
   */
  public updateLastSyncTime(): boolean {
    const now = Date.now();
    this.cache[CACHE_KEYS.LAST_SYNC_TIME] = now;
    this.saveToDisk(CACHE_KEYS.LAST_SYNC_TIME, now);
    return true;
  }

  /**
   * 获取最后同步时间
   */
  public getLastSyncTime(): number | null {
    return this.cache[CACHE_KEYS.LAST_SYNC_TIME];
  }

  // ============================================
  // 账号数据存储
  // ============================================

  /**
   * 保存账号数据
   * @param data 账号数据（包含当前账号ID和账号列表）
   */
  public saveAccounts(data: StoredAccountsData): boolean {
    this.cache[CACHE_KEYS.ACCOUNTS_DATA] = data;
    this.saveToDisk(CACHE_KEYS.ACCOUNTS_DATA, data);
    console.log(`[LocalCacheManager] 已保存 ${data.accounts.length} 个账号数据`);
    return true;
  }

  /**
   * 加载账号数据
   */
  public loadAccounts(): StoredAccountsData | null {
    const data = this.cache[CACHE_KEYS.ACCOUNTS_DATA];
    if (data) {
      console.log(`[LocalCacheManager] 加载了 ${data.accounts.length} 个账号数据`);
    }
    return data;
  }

  /**
   * 清除账号数据
   */
  public clearAccounts(): boolean {
    this.cache[CACHE_KEYS.ACCOUNTS_DATA] = null;
    this.removeFromDisk(CACHE_KEYS.ACCOUNTS_DATA);
    return true;
  }

  /**
   * 检查是否有已保存的账号
   */
  public hasStoredAccounts(): boolean {
    const data = this.cache[CACHE_KEYS.ACCOUNTS_DATA];
    return data !== null && data.accounts.length > 0;
  }

  // ============================================
  // 交易对存储
  // ============================================

  /**
   * 保存上次使用的交易对
   * @param baseSymbol 基础资产符号
   * @param quoteSymbol 报价资产符号
   */
  public saveLastTradingPair(baseSymbol: string, quoteSymbol: string): boolean {
    const data: LastTradingPairData = {
      baseSymbol,
      quoteSymbol,
      savedAt: Date.now(),
    };
    this.cache[CACHE_KEYS.LAST_TRADING_PAIR] = data;
    this.saveToDisk(CACHE_KEYS.LAST_TRADING_PAIR, data);
    console.log(`[LocalCacheManager] 已保存上次交易对: ${baseSymbol}/${quoteSymbol}`);
    return true;
  }

  /**
   * 加载上次使用的交易对
   * @returns 上次交易对数据，如果不存在则返回 null
   */
  public loadLastTradingPair(): LastTradingPairData | null {
    const data = this.cache[CACHE_KEYS.LAST_TRADING_PAIR];
    if (data) {
      console.log(`[LocalCacheManager] 加载上次交易对: ${data.baseSymbol}/${data.quoteSymbol}`);
    }
    return data;
  }

  /**
   * 清除上次交易对
   */
  public clearLastTradingPair(): boolean {
    this.cache[CACHE_KEYS.LAST_TRADING_PAIR] = null;
    this.removeFromDisk(CACHE_KEYS.LAST_TRADING_PAIR);
    return true;
  }

  // ============================================
  // 资产估值币种
  // ============================================

  /**
   * 保存用户选择的资产估值币种
   */
  public saveValuationAsset(symbol: string): boolean {
    this.cache[CACHE_KEYS.VALUATION_ASSET] = symbol;
    this.saveToDisk(CACHE_KEYS.VALUATION_ASSET, symbol);
    return true;
  }

  /**
   * 加载用户上次选择的资产估值币种
   */
  public loadValuationAsset(): string | null {
    return this.cache[CACHE_KEYS.VALUATION_ASSET];
  }

  /**
   * 清除资产估值币种
   */
  public clearValuationAsset(): boolean {
    this.cache[CACHE_KEYS.VALUATION_ASSET] = null;
    this.removeFromDisk(CACHE_KEYS.VALUATION_ASSET);
    return true;
  }

  // ============================================
  // API 节点设置存储
  // ============================================

  /**
   * 保存 API 节点设置
   * @param settings 节点设置
   */
  public saveApiNodeSettings(settings: ApiNodeSettings): boolean {
    this.cache[CACHE_KEYS.API_NODE_SETTINGS] = settings;
    this.saveToDisk(CACHE_KEYS.API_NODE_SETTINGS, settings);
    console.log(`[LocalCacheManager] 已保存 API 节点设置，自动选择: ${settings.autoSelect}，自定义节点数: ${settings.customNodes.length}`);
    return true;
  }

  /**
   * 加载 API 节点设置
   * @returns 节点设置，如果不存在则返回 null
   */
  public loadApiNodeSettings(): ApiNodeSettings | null {
    const settings = this.cache[CACHE_KEYS.API_NODE_SETTINGS];
    if (settings) {
      console.log(`[LocalCacheManager] 加载 API 节点设置，自动选择: ${settings.autoSelect}，自定义节点数: ${settings.customNodes.length}`);
    }
    return settings;
  }

  /**
   * 清除 API 节点设置
   */
  public clearApiNodeSettings(): boolean {
    this.cache[CACHE_KEYS.API_NODE_SETTINGS] = null;
    this.removeFromDisk(CACHE_KEYS.API_NODE_SETTINGS);
    return true;
  }

  // ============================================
  // 链动态节点存储
  // ============================================

  /**
   * 保存链动态节点列表
   * @param nodes 节点列表
   */
  public saveChainWsNodes(nodes: WsNodeConfig[]): boolean {
    this.cache[CACHE_KEYS.CHAIN_WS_NODES] = [...nodes];
    this.saveToDisk(CACHE_KEYS.CHAIN_WS_NODES, nodes);
    console.log(`[LocalCacheManager] 已保存 ${nodes.length} 个链动态节点`);
    return true;
  }

  /**
   * 加载链动态节点列表
   * @returns 节点列表
   */
  public loadChainWsNodes(): WsNodeConfig[] {
    return [...this.cache[CACHE_KEYS.CHAIN_WS_NODES]];
  }

  /**
   * 清除链动态节点列表
   */
  public clearChainWsNodes(): boolean {
    this.cache[CACHE_KEYS.CHAIN_WS_NODES] = [];
    this.removeFromDisk(CACHE_KEYS.CHAIN_WS_NODES);
    return true;
  }

  // ============================================
  // 资产缓存存储
  // ============================================

  /**
   * 保存资产列表到缓存
   * @param assets 资产对象列表
   */
  public saveAssets(assets: AssetObject[]): boolean {
    const now = Date.now();

    // 获取或创建内存缓存
    let memoryCache = this.cache[CACHE_KEYS.ASSET_CACHE];
    if (!memoryCache) {
      memoryCache = {
        byId: {},
        bySymbol: {},
      };
    }

    // 添加/更新资产（每个资产有独立的 cacheTime）
    assets.forEach(asset => {
      const cachedAsset: CachedAssetObject = {
        cacheTime: now,
        asset,
      };
      memoryCache!.byId[asset.id] = cachedAsset;
      memoryCache!.bySymbol[asset.symbol] = cachedAsset;
    });

    // 更新内存缓存
    this.cache[CACHE_KEYS.ASSET_CACHE] = memoryCache;

    // 保存到磁盘（直接存储 byId 对象）
    this.saveToDisk(CACHE_KEYS.ASSET_CACHE, memoryCache.byId);

    console.log(`[LocalCacheManager] 已保存 ${assets.length} 个资产，总缓存 ${Object.keys(memoryCache.byId).length} 个`);
    return true;
  }

  /**
   * 通过 symbol 获取资产对象
   * @param symbol 资产符号
   * @param checkExpiry 是否检查过期（默认 true）
   */
  public getAssetBySymbol(symbol: string, checkExpiry: boolean = true): AssetObject | null {
    const cache = this.cache[CACHE_KEYS.ASSET_CACHE];
    if (!cache) {
      return null;
    }

    const cachedAsset = cache.bySymbol[symbol];
    if (!cachedAsset) {
      return null;
    }

    // 检查该资产是否过期
    if (checkExpiry && this.isAssetExpired(cachedAsset.cacheTime)) {
      return null;
    }

    return cachedAsset.asset;
  }

  /**
   * 通过 id 获取资产对象
   * @param id 资产 ID
   * @param checkExpiry 是否检查过期（默认 true）
   */
  public getAssetById(id: string, checkExpiry: boolean = true): AssetObject | null {
    const cache = this.cache[CACHE_KEYS.ASSET_CACHE];
    if (!cache) {
      return null;
    }

    const cachedAsset = cache.byId[id];
    if (!cachedAsset) {
      return null;
    }

    // 检查该资产是否过期
    if (checkExpiry && this.isAssetExpired(cachedAsset.cacheTime)) {
      return null;
    }

    return cachedAsset.asset;
  }

  /**
   * 批量获取缓存中存在且未过期的资产（按 symbol）
   * @param symbols 资产符号列表
   * @param checkExpiry 是否检查过期（默认 true）
   * @returns 缓存中存在且未过期的资产列表
   */
  public getAssetsBySymbols(symbols: string[], checkExpiry: boolean = true): AssetObject[] {
    const cache = this.cache[CACHE_KEYS.ASSET_CACHE];
    if (!cache) {
      return [];
    }

    const result: AssetObject[] = [];
    symbols.forEach(symbol => {
      const cachedAsset = cache.bySymbol[symbol];
      if (cachedAsset) {
        // 检查该资产是否过期
        if (!checkExpiry || !this.isAssetExpired(cachedAsset.cacheTime)) {
          result.push(cachedAsset.asset);
        }
      }
    });

    return result;
  }

  /**
   * 获取缓存中不存在或已过期的 symbols
   * @param symbols 资产符号列表
   * @param checkExpiry 是否检查过期（默认 true）
   * @returns 缓存中不存在或已过期的 symbol 列表
   */
  public getMissingSymbols(symbols: string[], checkExpiry: boolean = true): string[] {
    const cache = this.cache[CACHE_KEYS.ASSET_CACHE];
    if (!cache) {
      return symbols;
    }

    return symbols.filter(symbol => {
      const cachedAsset = cache.bySymbol[symbol];
      if (!cachedAsset) {
        return true; // 不存在
      }
      // 检查是否过期
      if (checkExpiry && this.isAssetExpired(cachedAsset.cacheTime)) {
        return true; // 已过期
      }
      return false;
    });
  }

  /**
   * 检查单个资产缓存是否过期
   */
  private isAssetExpired(cacheTime: number): boolean {
    const now = Date.now();
    const elapsed = now - cacheTime;
    return elapsed > CACHE_EXPIRY.ASSET_CACHE;
  }

  /**
   * 清除资产缓存
   */
  public clearAssetCache(): boolean {
    this.cache[CACHE_KEYS.ASSET_CACHE] = null;
    this.removeFromDisk(CACHE_KEYS.ASSET_CACHE);
    return true;
  }

  /**
   * 获取资产缓存统计信息
   */
  public getAssetCacheStats(): {
    hasCache: boolean;
    totalCount: number;
    validCount: number;
    expiredCount: number;
  } {
    const cache = this.cache[CACHE_KEYS.ASSET_CACHE];
    if (!cache) {
      return {
        hasCache: false,
        totalCount: 0,
        validCount: 0,
        expiredCount: 0,
      };
    }

    let validCount = 0;
    let expiredCount = 0;

    Object.values(cache.byId).forEach(cachedAsset => {
      if (this.isAssetExpired(cachedAsset.cacheTime)) {
        expiredCount++;
      } else {
        validCount++;
      }
    });

    return {
      hasCache: true,
      totalCount: Object.keys(cache.byId).length,
      validCount,
      expiredCount,
    };
  }

  // ============================================
  // 工具方法
  // ============================================

  /**
   * 清除所有缓存数据
   */
  public clearAll(): boolean {
    try {
      // 清除内存缓存
      this.cache = {
        [CACHE_KEYS.MARKET_DATA]: null,
        [CACHE_KEYS.MARKET_CONFIG]: null,
        [CACHE_KEYS.USER_FAVORITES]: [],
        [CACHE_KEYS.POOL_FAVORITES]: [],
        [CACHE_KEYS.CUSTOM_TRADING_PAIRS]: [],
        [CACHE_KEYS.LAST_SYNC_TIME]: null,
        [CACHE_KEYS.ACCOUNTS_DATA]: null,
        [CACHE_KEYS.LAST_TRADING_PAIR]: null,
        [CACHE_KEYS.API_NODE_SETTINGS]: null,
        [CACHE_KEYS.CHAIN_WS_NODES]: [],
        [CACHE_KEYS.ASSET_CACHE]: null,
        [CACHE_KEYS.VALUATION_ASSET]: null,
        [CACHE_KEYS.OBJECT_VIEWER_HISTORY]: [],
      };

      // 清除磁盘数据
      this.mmkv.clearAll();
      console.log('[LocalCacheManager] 已清除所有缓存数据');
      return true;
    } catch (error) {
      console.error('[LocalCacheManager] 清除所有数据失败:', error);
      return false;
    }
  }

  /**
   * 获取缓存状态信息
   */
  public getCacheStatus(): {
    hasMarketData: boolean;
    hasMarketConfig: boolean;
    lastSyncTime: number | null;
    marketDataAge: number | null;
    hasFavorites: boolean;
    favoritesCount: number;
    hasAccounts: boolean;
    accountsCount: number;
  } {
    const marketData = this.cache[CACHE_KEYS.MARKET_DATA];
    const accounts = this.cache[CACHE_KEYS.ACCOUNTS_DATA];

    return {
      hasMarketData: marketData !== null,
      hasMarketConfig: this.cache[CACHE_KEYS.MARKET_CONFIG] !== null,
      lastSyncTime: this.cache[CACHE_KEYS.LAST_SYNC_TIME],
      marketDataAge: marketData ? Date.now() - marketData.cacheTime : null,
      hasFavorites: this.cache[CACHE_KEYS.USER_FAVORITES].length > 0,
      favoritesCount: this.cache[CACHE_KEYS.USER_FAVORITES].length,
      hasAccounts: accounts !== null && accounts.accounts.length > 0,
      accountsCount: accounts?.accounts.length || 0,
    };
  }

  /**
   * 获取所有存储的 key 列表（调试用）
   */
  public getAllKeys(): string[] {
    return this.mmkv.getAllKeys();
  }

  /**
   * 获取存储大小信息（调试用）
   */
  public getStorageInfo(): {
    totalSize: number;
    allKeys: string[];
  } {
    return {
      totalSize: this.mmkv.size,
      allKeys: this.mmkv.getAllKeys(),
    };
  }
}

// 导出单例实例
export const localCacheManager = LocalCacheManager.getInstance();
export default localCacheManager;

// 导出类型（供外部使用）
export { CACHE_KEYS };
