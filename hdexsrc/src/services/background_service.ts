/**
 * 后台服务
 * 负责定期更新数据，包括 ticker 行情、链上市场配置、账户余额等
 */

import { chainServiceMgr } from './chainservice_mgr';
import { localCacheManager } from './local_cache_mgr';
import { useMarketStore, getComputedMarketList } from '../store/useMarketStore';
import { useChainConfigStore, type ChainStorageItem } from '../store/useChainConfigStore';
import { useAccountStore } from '../store/useAccountStore';
import { useBalanceStore } from '../store/useBalanceStore';
import { useLimitOrderStore } from '../store/useLimitOrderStore';
import { useOrderBookStore, DEFAULT_BASE_SYMBOL, DEFAULT_QUOTE_SYMBOL } from '../store/useOrderBookStore';
import { BTS_NETWORK_CORE_ASSET_ID, getOnChainSettingsAccount, kAppStorageCatalogAppSettings } from '../config';
import type { TickerData, AssetObject } from '../types';

// 更新间隔配置（毫秒）
const UPDATE_INTERVALS = {
  TICKER: 10 * 1000,              // Ticker 更新：10秒
  MARKET_CONFIG: 5 * 60 * 1000,   // 市场配置更新：5分钟
  BALANCE: 30 * 1000,             // 余额更新：30秒
  LIMIT_ORDERS: 10 * 1000,        // 限价单更新：10秒
  ORDER_BOOK: 3 * 1000,           // 盘口更新：默认3秒
};

// 盘口配置
const ORDER_BOOK_FETCH_COUNT = 20; // 接口加载数量

class BackgroundService {
  private static instance: BackgroundService;
  private isRunning: boolean = false;
  private tickerTimer: ReturnType<typeof setTimeout> | null = null;
  private marketConfigTimer: ReturnType<typeof setTimeout> | null = null;
  private balanceTimer: ReturnType<typeof setTimeout> | null = null;
  private limitOrderTimer: ReturnType<typeof setTimeout> | null = null;
  private orderBookTimer: ReturnType<typeof setTimeout> | null = null;

  // 盘口刷新间隔（默认3秒，活跃界面1秒）
  private orderBookInterval: number = UPDATE_INTERVALS.ORDER_BOOK;
  // 是否正在查询盘口数据
  private isQueryingOrderBook: boolean = false;

  private constructor() { }

  /**
   * 获取单例实例
   */
  public static getInstance(): BackgroundService {
    if (!BackgroundService.instance) {
      BackgroundService.instance = new BackgroundService();
    }
    return BackgroundService.instance;
  }

  /**
   * 启动后台服务
   */
  public start(): void {
    if (this.isRunning) {
      console.log('[BackgroundService] 服务已在运行中');
      return;
    }

    console.log('[BackgroundService] 启动后台服务');
    this.isRunning = true;

    // 启动 Ticker 更新循环（使用 setTimeout 避免堆积）
    this.scheduleTickerUpdate();

    // 启动市场配置更新循环
    this.scheduleMarketConfigUpdate();

    // 启动余额更新循环
    this.scheduleBalanceUpdate();

    // 启动限价单更新循环
    this.scheduleLimitOrderUpdate();

    // 启动盘口数据更新循环
    this.scheduleOrderBookUpdate();
  }

  /**
   * 调度下一次 Ticker 更新（避免使用 setInterval 导致堆积）
   */
  private async scheduleTickerUpdate(): Promise<void> {
    if (!this.isRunning) return;

    // 执行更新
    await this.updateTickers();

    // 如果服务仍在运行，调度下一次更新
    if (this.isRunning) {
      this.tickerTimer = setTimeout(() => {
        this.scheduleTickerUpdate();
      }, UPDATE_INTERVALS.TICKER);
    }
  }

  /**
   * 调度下一次市场配置更新
   */
  private async scheduleMarketConfigUpdate(): Promise<void> {
    if (!this.isRunning) return;

    // 执行更新
    await this.reloadChainConfig();

    // 如果服务仍在运行，调度下一次更新
    if (this.isRunning) {
      this.marketConfigTimer = setTimeout(() => {
        this.scheduleMarketConfigUpdate();
      }, UPDATE_INTERVALS.MARKET_CONFIG);
    }
  }

  /**
   * 调度下一次余额更新
   */
  private async scheduleBalanceUpdate(): Promise<void> {
    if (!this.isRunning) return;

    // 执行更新
    await this.updateAccountBalance();

    // 如果服务仍在运行，调度下一次更新
    if (this.isRunning) {
      this.balanceTimer = setTimeout(() => {
        this.scheduleBalanceUpdate();
      }, UPDATE_INTERVALS.BALANCE);
    }
  }

  /**
   * 调度下一次限价单更新
   */
  private async scheduleLimitOrderUpdate(): Promise<void> {
    if (!this.isRunning) return;

    // 执行更新
    await this.updateLimitOrders();

    // 如果服务仍在运行，调度下一次更新
    if (this.isRunning) {
      this.limitOrderTimer = setTimeout(() => {
        this.scheduleLimitOrderUpdate();
      }, UPDATE_INTERVALS.LIMIT_ORDERS);
    }
  }

  /**
   * 调度下一次盘口数据更新
   */
  private async scheduleOrderBookUpdate(): Promise<void> {
    if (!this.isRunning) return;

    // 执行更新
    await this.updateOrderBook();

    // 如果服务仍在运行，调度下一次更新
    if (this.isRunning) {
      this.orderBookTimer = setTimeout(() => {
        this.scheduleOrderBookUpdate();
      }, this.orderBookInterval);
    }
  }

  /**
   * 停止后台服务
   */
  public stop(): void {
    console.log('[BackgroundService] 停止后台服务');
    this.isRunning = false;

    if (this.tickerTimer) {
      clearTimeout(this.tickerTimer);
      this.tickerTimer = null;
    }

    if (this.marketConfigTimer) {
      clearTimeout(this.marketConfigTimer);
      this.marketConfigTimer = null;
    }

    if (this.balanceTimer) {
      clearTimeout(this.balanceTimer);
      this.balanceTimer = null;
    }

    if (this.limitOrderTimer) {
      clearTimeout(this.limitOrderTimer);
      this.limitOrderTimer = null;
    }

    if (this.orderBookTimer) {
      clearTimeout(this.orderBookTimer);
      this.orderBookTimer = null;
    }
  }

  /**
   * 检查服务是否正在运行
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  // ============================================
  // Ticker 更新
  // ============================================

  /**
   * 更新所有市场的 Ticker 数据
   */
  private async updateTickers(): Promise<void> {
    try {
      const marketStore = useMarketStore.getState();

      // 获取所有交易对
      const pairs = marketStore.getAllPairs();

      if (pairs.length === 0) {
        console.log('[BackgroundService] 无交易对，跳过 Ticker 更新');
        return;
      }

      // 批量查询 Ticker
      const tickerMap = await chainServiceMgr.queryTickers(pairs);

      if (tickerMap.size === 0) {
        console.log('[BackgroundService] 未获取到 Ticker 数据');
        return;
      }

      // 更新 MarketStore 中的 tickerMap
      marketStore.updateTickers(tickerMap);

      console.log(`[BackgroundService] Ticker 更新完成，共 ${tickerMap.size} 个交易对`);
    } catch (error) {
      console.log('[BackgroundService] Ticker 更新失败:', error);
    }
  }

  // ============================================
  // 链上配置加载
  // ============================================

  /**
   * 从链上加载配置数据
   */
  public async loadChainConfigFromChain(): Promise<ChainStorageItem[] | null> {
    try {
      const settingsAccount = getOnChainSettingsAccount();
      console.log(`[BackgroundService] 准备从链上加载配置。`);

      // 从链上获取存储信息
      const storageData = await chainServiceMgr.getStorageInfo(
        settingsAccount,
        kAppStorageCatalogAppSettings
      );

      console.log('[BackgroundService] 链上存储信息:', storageData);

      if (!storageData || storageData.length === 0) {
        console.log('[BackgroundService] 链上未找到配置数据');
        return null;
      }

      return storageData as ChainStorageItem[];
    } catch (error) {
      console.log('[BackgroundService] 加载链上配置失败:', error);
      return null;
    }
  }

  /**
   * 重新加载链上配置
   */
  private async reloadChainConfig(): Promise<void> {
    try {
      const storageData = await this.loadChainConfigFromChain();
      if (storageData) {
        const chainConfigStore = useChainConfigStore.getState();
        chainConfigStore.parseChainStorageData(storageData);
        console.log('[BackgroundService] 链上配置更新完成');
      }
    } catch (error) {
      console.log('[BackgroundService] 重新加载链上配置失败:', error);
    }
  }

  // ============================================
  // 盘口数据更新
  // ============================================

  /**
   * 初始化盘口交易对
   * 从本地缓存加载上次交易对，如果没有则使用默认交易对
   */
  public initializeOrderBookTradingPair(): void {
    const orderBookStore = useOrderBookStore.getState();

    // 尝试从本地缓存加载上次交易对
    const lastPair = localCacheManager.loadLastTradingPair();
    if (lastPair) {
      orderBookStore.setTradingPair(lastPair.baseSymbol, lastPair.quoteSymbol);
      console.log(`[BackgroundService] 从缓存加载交易对: ${lastPair.baseSymbol}/${lastPair.quoteSymbol}`);
    } else {
      // 使用默认交易对
      orderBookStore.setTradingPair(DEFAULT_BASE_SYMBOL, DEFAULT_QUOTE_SYMBOL);
      console.log(`[BackgroundService] 使用默认交易对: ${DEFAULT_BASE_SYMBOL}/${DEFAULT_QUOTE_SYMBOL}`);
    }
  }

  /**
   * 切换盘口交易对
   * 如果交易对变化，会先清空数据再查询新数据
   * @param baseSymbol 基础资产符号
   * @param quoteSymbol 报价资产符号
   * @returns 是否发生变化
   */
  public async switchOrderBookTradingPair(baseSymbol: string, quoteSymbol: string): Promise<boolean> {
    const orderBookStore = useOrderBookStore.getState();

    // 检查是否变化，如果没变化直接返回
    const changed = orderBookStore.setTradingPair(baseSymbol, quoteSymbol);
    if (!changed) {
      return false;
    }

    // 保存到本地缓存
    localCacheManager.saveLastTradingPair(baseSymbol, quoteSymbol);

    // 立即刷新盘口数据
    await this.updateOrderBook();

    return true;
  }

  /**
   * 更新盘口数据
   */
  private async updateOrderBook(): Promise<void> {
    // 标记正在查询
    this.isQueryingOrderBook = true;
    try {
      const orderBookStore = useOrderBookStore.getState();
      const { baseSymbol, quoteSymbol } = orderBookStore;

      // 设置加载状态（仅首次加载时显示）
      if (!orderBookStore.lastUpdatedAt) {
        orderBookStore.setLoading(true);
      }

      // 查询盘口数据
      const result = await chainServiceMgr.queryOrderBookBySymbols(
        baseSymbol,
        quoteSymbol,
        ORDER_BOOK_FETCH_COUNT
      );

      if (result.tradingPair) {
        orderBookStore.updateOrderBook(result.orderBook, result.tradingPair);
        console.log(`[BackgroundService] 盘口数据更新完成: ${baseSymbol}/${quoteSymbol}, bids: ${result.orderBook.bids.length}, asks: ${result.orderBook.asks.length}`);
      } else {
        orderBookStore.setError('交易对不存在');
        console.log(`[BackgroundService] 盘口数据更新失败: 交易对 ${baseSymbol}/${quoteSymbol} 不存在`);
      }
    } catch (error) {
      console.log('[BackgroundService] 盘口数据更新失败:', error);
      const orderBookStore = useOrderBookStore.getState();
      orderBookStore.setError('加载失败');
    } finally {
      this.isQueryingOrderBook = false;
    }
  }

  // ============================================
  // 账户余额更新
  // ============================================

  // ============================================
  // 限价单更新
  // ============================================

  /**
   * 更新用户限价单
   * 每次 tick 检测，如果账号未登录则直接返回等待下一次 tick
   */
  private async updateLimitOrders(): Promise<void> {
    try {
      // 检查账号是否已登录
      const accountStore = useAccountStore.getState();
      const currentAccount = accountStore.currentAccount;

      if (!currentAccount) {
        // 账号未登录，清空限价单数据
        const limitOrderStore = useLimitOrderStore.getState();
        if (limitOrderStore.currentAccountId !== null) {
          limitOrderStore.setCurrentAccount(null);
        }
        return;
      }

      const limitOrderStore = useLimitOrderStore.getState();

      // 检查账户是否变化
      if (limitOrderStore.currentAccountId !== currentAccount.id) {
        limitOrderStore.setCurrentAccount(currentAccount.id);
      }

      limitOrderStore.setLoading(true);

      // 获取用户所有限价单
      const orders = await chainServiceMgr.getLimitOrdersByAccount(currentAccount.name, 100);

      // 收集所有涉及的资产 ID
      const assetIds = new Set<string>();
      for (const order of orders) {
        assetIds.add(order.sell_price.base.asset_id);
        assetIds.add(order.sell_price.quote.asset_id);
      }

      // 批量查询资产详情
      const assetIdsArray = Array.from(assetIds);
      const assetInfoMap = new Map<string, AssetObject>();

      if (assetIdsArray.length > 0) {
        const assets = await chainServiceMgr.getAssets(assetIdsArray);
        for (const asset of assets) {
          if (asset) {
            assetInfoMap.set(asset.id, asset);
          }
        }
      }

      // 更新 LimitOrderStore（只存储原始数据，不解析）
      limitOrderStore.updateOrders(orders, assetInfoMap);

      console.log(`[BackgroundService] 限价单更新完成，共 ${orders.length} 个订单`);
    } catch (error) {
      console.log('[BackgroundService] 更新限价单失败:', error);
      const limitOrderStore = useLimitOrderStore.getState();
      limitOrderStore.setLoading(false);
    }
  }

  /**
   * 更新账户余额
   * 每次 tick 检测，如果账号未登录则直接返回等待下一次 tick
   */
  private async updateAccountBalance(): Promise<void> {
    try {
      // 检查账号是否已登录
      const accountStore = useAccountStore.getState();
      const currentAccount = accountStore.currentAccount;

      if (!currentAccount) {
        console.log('[BackgroundService] 账号未登录，跳过余额更新');
        return;
      }

      console.log(`[BackgroundService] 开始更新账号 ${currentAccount.name} 的余额...`);

      // 获取完整账户信息
      const fullAccountData = await chainServiceMgr.queryFullAccountInfo(currentAccount.id);
      if (!fullAccountData) {
        console.log('[BackgroundService] 获取账户信息失败');
        return;
      }

      // 收集所有需要查询的资产 ID
      const assetIds = new Set<string>();

      // 核心资产
      assetIds.add(BTS_NETWORK_CORE_ASSET_ID);

      // 从余额中收集
      for (const balance of fullAccountData.balances || []) {
        assetIds.add(balance.asset_type);
      }

      // 从限价单中收集
      for (const order of fullAccountData.limit_orders || []) {
        assetIds.add(order.sell_price.base.asset_id);
        assetIds.add(order.sell_price.quote.asset_id);
      }

      // 从债仓中收集
      for (const order of fullAccountData.call_orders || []) {
        assetIds.add(order.call_price.base.asset_id);
        assetIds.add(order.call_price.quote.asset_id);
      }

      // 从清算单中收集
      for (const order of fullAccountData.settle_orders || []) {
        assetIds.add(order.balance.asset_id);
      }

      // 批量查询资产详情
      const assetIdsArray = Array.from(assetIds);
      let assetInfoMap = new Map<string, AssetObject>();

      if (assetIdsArray.length > 0) {
        const assets = await chainServiceMgr.getAssets(assetIdsArray);
        for (const asset of assets) {
          if (asset) {
            assetInfoMap.set(asset.id, asset);
          }
        }
      }

      // 更新 BalanceStore
      const balanceStore = useBalanceStore.getState();
      balanceStore.updateFromFullAccount(fullAccountData, assetInfoMap);

      console.log(`[BackgroundService] 账号余额更新完成`);
    } catch (error) {
      console.log('[BackgroundService] 更新账户余额失败:', error);
    }
  }

  /**
   * 初始化市场数据（供外部调用）
   * 每次启动都从链上加载配置
   */
  public async initializeMarketData(): Promise<boolean> {
    try {
      console.log('[BackgroundService] 初始化市场数据...');

      const marketStore = useMarketStore.getState();

      // 1. 加载收藏列表（本地数据）
      await marketStore.loadFavoritesFromCache();

      // 2. 尝试从内存缓存加载 ticker 数据（用于快速展示）
      const cachedData = localCacheManager.loadMarketData(false);
      let cachedTickerMap: Map<string, TickerData> | null = null;
      if (cachedData && cachedData.marketList && cachedData.marketList.length > 0) {
        cachedTickerMap = new Map();
        cachedData.marketList.forEach(item => {
          const key = `${item.baseAsset}_${item.quoteAsset}`;
          cachedTickerMap!.set(key, {
            base: item.baseAsset,
            quote: item.quoteAsset,
            latest: String(item.price),
            percent_change: String(item.change24h),
            base_volume: String(item.amount24h),
            quote_volume: String(item.volume24h),
            lowest_ask: '0',
            lowest_ask_base_size: '0',
            lowest_ask_quote_size: '0',
            highest_bid: '0',
            highest_bid_base_size: '0',
            highest_bid_quote_size: '0',
          });
        });
        console.log('[BackgroundService] 从缓存预加载了 ticker 数据');

        // 先应用缓存的 ticker
        marketStore.updateTickers(cachedTickerMap);
      }

      // 3. 从链上加载配置
      const storageData = await this.loadChainConfigFromChain();
      if (!storageData) {
        console.log('[BackgroundService] 获取链上配置失败');
        // 即使配置加载失败，如果有缓存数据也标记为已加载
        if (cachedTickerMap) {
          marketStore.setLoaded(true);
        }
        return false;
      }

      // 4. 解析并存储配置到 ChainConfigStore
      const chainConfigStore = useChainConfigStore.getState();
      chainConfigStore.parseChainStorageData(storageData);

      // 5. 初始化资产缓存
      await this.initAssetCache();

      // 6. 初始化盘口交易对
      this.initializeOrderBookTradingPair();

      // 7. 获取所有交易对的 Ticker
      const pairs = marketStore.getAllPairs();
      console.log(`[BackgroundService] 共 ${pairs.length} 个交易对需要获取 Ticker`);

      if (pairs.length > 0) {
        const tickerMap = await chainServiceMgr.queryTickers(pairs);
        if (tickerMap.size > 0) {
          marketStore.updateTickers(tickerMap);
          console.log(`[BackgroundService] 获取了 ${tickerMap.size} 个 Ticker`);
        }
      }

      // 8. 标记加载完成
      marketStore.setLoaded(true);

      console.log('[BackgroundService] 市场数据初始化完成');
      return true;
    } catch (error) {
      console.error('[BackgroundService] 初始化市场数据失败:', error);
      return false;
    }
  }

  // ============================================
  // 资产缓存初始化
  // ============================================

  /**
   * 初始化资产缓存
   * 根据链动态配置中的 symbols 查询并缓存资产对象
   */
  private async initAssetCache(): Promise<void> {
    try {
      // 1. 获取链动态配置中的所有 symbols
      const chainConfigStore = useChainConfigStore.getState();
      const allSymbols = chainConfigStore.getAllAssetSymbols();

      if (allSymbols.size === 0) {
        console.log('[BackgroundService] 链配置中没有资产 symbols，跳过资产缓存初始化');
        return;
      }

      console.log(`[BackgroundService] 链配置中共 ${allSymbols.size} 个资产 symbols`);

      // 2. 检查缓存中缺失的 symbols
      const symbolsArray = Array.from(allSymbols);
      const missingSymbols = localCacheManager.getMissingSymbols(symbolsArray);

      if (missingSymbols.length === 0) {
        console.log('[BackgroundService] 所有资产已在缓存中，跳过查询');
        return;
      }

      console.log(`[BackgroundService] 需要查询 ${missingSymbols.length} 个缺失的资产`);

      // 3. 从链上查询缺失的资产
      const assets = await chainServiceMgr.lookupAssetSymbols(missingSymbols);

      if (assets.length === 0) {
        console.log('[BackgroundService] 未查询到任何资产');
        return;
      }

      // 4. 保存到缓存
      localCacheManager.saveAssets(assets);

      console.log(`[BackgroundService] 资产缓存初始化完成，查询了 ${assets.length} 个资产`);
    } catch (error) {
      console.error('[BackgroundService] 初始化资产缓存失败:', error);
    }
  }

  // ============================================
  // 手动刷新方法（供外部调用）
  // ============================================

  /**
   * 手动刷新 Ticker
   */
  public async refreshTickers(): Promise<void> {
    await this.updateTickers();
  }

  /**
   * 手动刷新链上配置
   */
  public async refreshChainConfig(): Promise<void> {
    await this.reloadChainConfig();
  }

  /**
   * 手动刷新账户余额
   */
  public async refreshAccountBalance(): Promise<void> {
    await this.updateAccountBalance();
  }

  /**
   * 手动刷新限价单
   */
  public async refreshLimitOrders(): Promise<void> {
    await this.updateLimitOrders();
  }

  /**
   * 手动刷新盘口数据
   */
  public async refreshOrderBook(): Promise<void> {
    await this.updateOrderBook();
  }

  /**
   * 设置盘口刷新间隔
   * @param interval 刷新间隔（毫秒）
   */
  public setOrderBookInterval(interval: number): void {
    const oldInterval = this.orderBookInterval;
    this.orderBookInterval = interval;
    console.log(`[BackgroundService] 盘口刷新间隔: ${oldInterval}ms -> ${interval}ms`);

    // 如果正在查询中，不处理（查询完会自动使用新间隔）
    if (this.isQueryingOrderBook) {
      return;
    }

    // 如果在 setTimeout 等待中，清除定时器并立即重新调度
    if (this.orderBookTimer && this.isRunning) {
      clearTimeout(this.orderBookTimer);
      // 立即重新调度
      this.scheduleOrderBookUpdate();
    }
  }
}

// 导出单例实例
export const backgroundService = BackgroundService.getInstance();
export default backgroundService;
