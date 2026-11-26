// /**
//  * 持久化存储服务
//  * 使用 AsyncStorage 管理本地缓存数据
//  */

// import AsyncStorage from '@react-native-async-storage/async-storage';
// import type { CachedMarketData, OnChainMarketConfig, MarketItem, StoredAccountsData, LastTradingPairData, ApiNodeSettings } from '../types';

// // 存储 Key 常量
// const STORAGE_KEYS = {
//   MARKET_DATA: '@hdex/market_data',           // 市场数据缓存
//   MARKET_CONFIG: '@hdex/market_config',       // 市场配置缓存
//   USER_FAVORITES: '@hdex/user_favorites',     // 用户收藏列表
//   LAST_SYNC_TIME: '@hdex/last_sync_time',     // 最后同步时间
//   // 账号相关
//   ACCOUNTS_DATA: '@hdex/accounts_data',       // 账号列表数据
//   // 交易相关
//   LAST_TRADING_PAIR: '@hdex/last_trading_pair', // 上次交易对
//   // API 节点相关
//   API_NODE_SETTINGS: '@hdex/api_node_settings', // API 节点设置
// };

// // 缓存有效期（毫秒）
// const CACHE_EXPIRY = {
//   MARKET_DATA: 24 * 60 * 60 * 1000,     // 市场数据：24小时
//   MARKET_CONFIG: 7 * 24 * 60 * 60 * 1000, // 市场配置：7天
// };

// class StorageService {
//   private static instance: StorageService;

//   private constructor() { }

//   /**
//    * 获取单例实例
//    */
//   public static getInstance(): StorageService {
//     if (!StorageService.instance) {
//       StorageService.instance = new StorageService();
//     }
//     return StorageService.instance;
//   }

//   // ============================================
//   // 通用存储方法
//   // ============================================

//   /**
//    * 存储 JSON 数据
//    */
//   private async setJSON<T>(key: string, value: T): Promise<boolean> {
//     try {
//       const jsonValue = JSON.stringify(value);
//       await AsyncStorage.setItem(key, jsonValue);
//       return true;
//     } catch (error) {
//       console.error(`[Storage] 存储数据失败 key=${key}:`, error);
//       return false;
//     }
//   }

//   /**
//    * 读取 JSON 数据
//    */
//   private async getJSON<T>(key: string): Promise<T | null> {
//     try {
//       const jsonValue = await AsyncStorage.getItem(key);
//       if (jsonValue === null) {
//         return null;
//       }
//       return JSON.parse(jsonValue) as T;
//     } catch (error) {
//       console.error(`[Storage] 读取数据失败 key=${key}:`, error);
//       return null;
//     }
//   }

//   /**
//    * 删除数据
//    */
//   private async remove(key: string): Promise<boolean> {
//     try {
//       await AsyncStorage.removeItem(key);
//       return true;
//     } catch (error) {
//       console.error(`[Storage] 删除数据失败 key=${key}:`, error);
//       return false;
//     }
//   }

//   // ============================================
//   // 市场数据缓存
//   // ============================================

//   /**
//    * 保存市场数据缓存
//    */
//   public async saveMarketData(data: CachedMarketData): Promise<boolean> {
//     return this.setJSON(STORAGE_KEYS.MARKET_DATA, data);
//   }

//   /**
//    * 加载市场数据缓存
//    * @param checkExpiry 是否检查过期（默认 true）
//    */
//   public async loadMarketData(checkExpiry: boolean = true): Promise<CachedMarketData | null> {
//     const data = await this.getJSON<CachedMarketData>(STORAGE_KEYS.MARKET_DATA);

//     if (!data) {
//       console.log('[Storage] 市场数据缓存不存在');
//       return null;
//     }

//     // 检查缓存是否过期
//     if (checkExpiry) {
//       const now = Date.now();
//       const elapsed = now - data.cacheTime;
//       if (elapsed > CACHE_EXPIRY.MARKET_DATA) {
//         console.log('[Storage] 市场数据缓存已过期');
//         return null;
//       }
//     }

//     console.log('[Storage] 成功加载市场数据缓存');
//     return data;
//   }

//   /**
//    * 清除市场数据缓存
//    */
//   public async clearMarketData(): Promise<boolean> {
//     return this.remove(STORAGE_KEYS.MARKET_DATA);
//   }

//   // ============================================
//   // 市场配置缓存
//   // ============================================

//   /**
//    * 保存市场配置
//    */
//   public async saveMarketConfig(config: OnChainMarketConfig): Promise<boolean> {
//     return this.setJSON(STORAGE_KEYS.MARKET_CONFIG, config);
//   }

//   /**
//    * 加载市场配置
//    */
//   public async loadMarketConfig(): Promise<OnChainMarketConfig | null> {
//     const config = await this.getJSON<OnChainMarketConfig>(STORAGE_KEYS.MARKET_CONFIG);

//     if (!config) {
//       console.log('[Storage] 市场配置缓存不存在');
//       return null;
//     }

//     console.log('[Storage] 成功加载市场配置缓存');
//     return config;
//   }

//   // ============================================
//   // 用户收藏
//   // ============================================

//   /**
//    * 保存用户收藏列表
//    * @param favorites 收藏的交易对数组，格式：["BTC_USDT", "ETH_USDT"]
//    */
//   public async saveFavorites(favorites: string[]): Promise<boolean> {
//     return this.setJSON(STORAGE_KEYS.USER_FAVORITES, favorites);
//   }

//   /**
//    * 加载用户收藏列表
//    */
//   public async loadFavorites(): Promise<string[]> {
//     const favorites = await this.getJSON<string[]>(STORAGE_KEYS.USER_FAVORITES);
//     return favorites || [];
//   }

//   /**
//    * 添加到收藏
//    */
//   public async addFavorite(pairKey: string): Promise<boolean> {
//     const favorites = await this.loadFavorites();
//     if (!favorites.includes(pairKey)) {
//       favorites.push(pairKey);
//       return this.saveFavorites(favorites);
//     }
//     return true;
//   }

//   /**
//    * 从收藏移除
//    */
//   public async removeFavorite(pairKey: string): Promise<boolean> {
//     const favorites = await this.loadFavorites();
//     const index = favorites.indexOf(pairKey);
//     if (index > -1) {
//       favorites.splice(index, 1);
//       return this.saveFavorites(favorites);
//     }
//     return true;
//   }

//   // ============================================
//   // 同步时间记录
//   // ============================================

//   /**
//    * 更新最后同步时间
//    */
//   public async updateLastSyncTime(): Promise<boolean> {
//     return this.setJSON(STORAGE_KEYS.LAST_SYNC_TIME, Date.now());
//   }

//   /**
//    * 获取最后同步时间
//    */
//   public async getLastSyncTime(): Promise<number | null> {
//     return this.getJSON<number>(STORAGE_KEYS.LAST_SYNC_TIME);
//   }

//   // ============================================
//   // 工具方法
//   // ============================================

//   /**
//    * 清除所有缓存数据
//    */
//   public async clearAll(): Promise<boolean> {
//     try {
//       const keys = Object.values(STORAGE_KEYS);
//       await AsyncStorage.multiRemove(keys);
//       console.log('[Storage] 已清除所有缓存数据');
//       return true;
//     } catch (error) {
//       console.error('[Storage] 清除所有数据失败:', error);
//       return false;
//     }
//   }

//   /**
//    * 获取缓存状态信息
//    */
//   public async getCacheStatus(): Promise<{
//     hasMarketData: boolean;
//     hasMarketConfig: boolean;
//     lastSyncTime: number | null;
//     marketDataAge: number | null;
//   }> {
//     const marketData = await this.getJSON<CachedMarketData>(STORAGE_KEYS.MARKET_DATA);
//     const marketConfig = await this.getJSON<OnChainMarketConfig>(STORAGE_KEYS.MARKET_CONFIG);
//     const lastSyncTime = await this.getLastSyncTime();

//     return {
//       hasMarketData: marketData !== null,
//       hasMarketConfig: marketConfig !== null,
//       lastSyncTime,
//       marketDataAge: marketData ? Date.now() - marketData.cacheTime : null,
//     };
//   }

//   // ============================================
//   // 账号数据存储
//   // ============================================

//   /**
//    * 保存账号数据
//    * @param data 账号数据（包含当前账号ID和账号列表）
//    */
//   public async saveAccounts(data: StoredAccountsData): Promise<boolean> {
//     const result = await this.setJSON(STORAGE_KEYS.ACCOUNTS_DATA, data);
//     if (result) {
//       console.log(`[Storage] 已保存 ${data.accounts.length} 个账号数据`);
//     }
//     return result;
//   }

//   /**
//    * 加载账号数据
//    */
//   public async loadAccounts(): Promise<StoredAccountsData | null> {
//     const data = await this.getJSON<StoredAccountsData>(STORAGE_KEYS.ACCOUNTS_DATA);
//     if (data) {
//       console.log(`[Storage] 加载了 ${data.accounts.length} 个账号数据`);
//     }
//     return data;
//   }

//   /**
//    * 清除账号数据
//    */
//   public async clearAccounts(): Promise<boolean> {
//     return this.remove(STORAGE_KEYS.ACCOUNTS_DATA);
//   }

//   /**
//    * 检查是否有已保存的账号
//    */
//   public async hasStoredAccounts(): Promise<boolean> {
//     const data = await this.loadAccounts();
//     return data !== null && data.accounts.length > 0;
//   }

//   // ============================================
//   // 交易对存储
//   // ============================================

//   /**
//    * 保存上次使用的交易对
//    * @param baseSymbol 基础资产符号
//    * @param quoteSymbol 报价资产符号
//    */
//   public async saveLastTradingPair(baseSymbol: string, quoteSymbol: string): Promise<boolean> {
//     const data: LastTradingPairData = {
//       baseSymbol,
//       quoteSymbol,
//       savedAt: Date.now(),
//     };
//     const result = await this.setJSON(STORAGE_KEYS.LAST_TRADING_PAIR, data);
//     if (result) {
//       console.log(`[Storage] 已保存上次交易对: ${baseSymbol}/${quoteSymbol}`);
//     }
//     return result;
//   }

//   /**
//    * 加载上次使用的交易对
//    * @returns 上次交易对数据，如果不存在则返回 null
//    */
//   public async loadLastTradingPair(): Promise<LastTradingPairData | null> {
//     const data = await this.getJSON<LastTradingPairData>(STORAGE_KEYS.LAST_TRADING_PAIR);
//     if (data) {
//       console.log(`[Storage] 加载上次交易对: ${data.baseSymbol}/${data.quoteSymbol}`);
//     }
//     return data;
//   }

//   /**
//    * 清除上次交易对
//    */
//   public async clearLastTradingPair(): Promise<boolean> {
//     return this.remove(STORAGE_KEYS.LAST_TRADING_PAIR);
//   }

//   // ============================================
//   // API 节点设置存储
//   // ============================================

//   /**
//    * 保存 API 节点设置
//    * @param settings 节点设置
//    */
//   public async saveApiNodeSettings(settings: ApiNodeSettings): Promise<boolean> {
//     const result = await this.setJSON(STORAGE_KEYS.API_NODE_SETTINGS, settings);
//     if (result) {
//       console.log(`[Storage] 已保存 API 节点设置，自动选择: ${settings.autoSelect}，自定义节点数: ${settings.customNodes.length}`);
//     }
//     return result;
//   }

//   /**
//    * 加载 API 节点设置
//    * @returns 节点设置，如果不存在则返回 null
//    */
//   public async loadApiNodeSettings(): Promise<ApiNodeSettings | null> {
//     const settings = await this.getJSON<ApiNodeSettings>(STORAGE_KEYS.API_NODE_SETTINGS);
//     if (settings) {
//       console.log(`[Storage] 加载 API 节点设置，自动选择: ${settings.autoSelect}，自定义节点数: ${settings.customNodes.length}`);
//     }
//     return settings;
//   }

//   /**
//    * 清除 API 节点设置
//    */
//   public async clearApiNodeSettings(): Promise<boolean> {
//     return this.remove(STORAGE_KEYS.API_NODE_SETTINGS);
//   }
// }

// // 导出单例实例
// export const storageService = StorageService.getInstance();
// export default storageService;

