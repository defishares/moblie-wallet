/**
 * 后台服务
 * 负责定期更新数据，包括 ticker 行情、链上市场配置、账户余额等
 */

import { chainServiceMgr } from './chainservice_mgr';
import { localCacheManager } from './local_cache_mgr';
import { useMarketStore } from '../store/useMarketStore';
import { syncAnnouncementsFromChain } from '../store/useAppStore';
import { useChainConfigStore, type ChainStorageItem } from '../store/useChainConfigStore';
import { useAccountStore } from '../store/useAccountStore';
import { useBalanceStore } from '../store/useBalanceStore';
import { useLimitOrderStore } from '../store/useLimitOrderStore';
import { useOrderBookStore, DEFAULT_BASE_SYMBOL, DEFAULT_QUOTE_SYMBOL } from '../store/useOrderBookStore';
import {
  BTS_NETWORK_CORE_ASSET_ID,
  CURRENT_NETWORK_TYPE,
  getOnChainSettingsAccount,
  kAppStorageCatalogAppSettings,
  kAppStorageKeyAppSettings_CommonVer,
  kAppStorageKeyMainnetMarkets,
  ANNOUNCEMENT_ADMIN_ACCOUNT_IDS,
  kAppStorageKeyAnnouncements,
  kAppStorageKeyAnnouncementAdmins,
  setConfiguredAnnouncementAdmins,
  getConfiguredAnnouncementAdmins,
} from '../config';
import type { TickerData, AssetObject, IMarket } from '../types';
import type { LiquidityPoolValuation } from '../utils/liquidityPoolValuation';
import { mergeAnnouncementFeeds, parseAnnouncementList, parseAnnouncementAdminList } from '../utils/announcements';

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

/** 解析市场配置，兼容独立 key、通用配置 markets 字段及直接数组格式。 */
const normalizeMainnetMarkets = (value: unknown): IMarket[] | null => {
  let decoded = value;
  if (typeof decoded === 'string') {
    try { decoded = JSON.parse(decoded); } catch { return null; }
  }
  const raw = decoded && typeof decoded === 'object' && !Array.isArray(decoded)
    ? (decoded as any).markets || (decoded as any).pairs
    : decoded;
  if (!Array.isArray(raw)) return null;

  if (raw.every(item => item && typeof item === 'object' && !Array.isArray(item) && item.list)) {
    const groups = raw
      .map(item => ({
        base: { name: String(item.base?.name || item.name || '主网') },
        list: Array.isArray(item.list) ? item.list : [],
      }))
      .filter(item => item.list.length > 0);
    return groups.length > 0 ? groups : null;
  }

  const list = raw.filter(item => Array.isArray(item) && item.length >= 2);
  return list.length > 0 ? [{ base: { name: '主网' }, list }] : null;
};

const findMainnetMarkets = (feeds: ChainStorageItem[][]): IMarket[] | null => {
  for (const rows of feeds) {
    const dedicated = rows.find(item => item.key === kAppStorageKeyMainnetMarkets);
    const dedicatedMarkets = dedicated && normalizeMainnetMarkets(dedicated.value);
    if (dedicatedMarkets) return dedicatedMarkets;

    const common = rows.find(item => item.key === kAppStorageKeyAppSettings_CommonVer);
    const commonMarkets = common && normalizeMainnetMarkets(common.value);
    if (commonMarkets) return commonMarkets;
  }
  return null;
};

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
  // 盘口请求序号，防止快速切换交易对时旧请求覆盖新数据
  private orderBookRequestId: number = 0;
  private chainMarketRequest: Promise<void> | null = null;

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
      await this.refreshChainMarkets();
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

      // 合并更新，避免某个自定义交易对暂时无流动性/查询失败时清掉其他交易对的缓存行情
      const mergedTickerMap = new Map(marketStore.tickerMap);
      tickerMap.forEach((ticker, key) => mergedTickerMap.set(key, ticker));
      marketStore.updateTickers(mergedTickerMap);

      console.log(`[BackgroundService] Ticker 更新完成，共 ${tickerMap.size} 个交易对`);
    } catch (error) {
      console.log('[BackgroundService] Ticker 更新失败:', error);
    }
  }

  /** Refresh discovery separately from the ten-second price loop. */
  public refreshChainMarkets(force: boolean = false): Promise<void> {
    if (this.chainMarketRequest) return this.chainMarketRequest;
    const state = useMarketStore.getState();
    if (!force && state.chainMarketsLoaded &&
      Date.now() - state.chainMarketsUpdatedAt < UPDATE_INTERVALS.MARKET_CONFIG) {
      return Promise.resolve();
    }

    // 主网不再通过 get_top_markets 自动发现交易对。主区只展示链上管理员配置的列表；
    // 配置解析后 getAllPairs 会直接从 appSettings.markets 读取。
    if (CURRENT_NETWORK_TYPE === 'mainnet') {
      const configuredPairs = useMarketStore.getState().getAllPairs();
      useMarketStore.setState({
        chainPairs: configuredPairs,
        chainMarketsLoaded: true,
        chainMarketsLoading: false,
        chainMarketsError: null,
        chainMarketsUpdatedAt: Date.now(),
      });
      return Promise.resolve();
    }

    const nodeUrl = chainServiceMgr.getCurrentNodeUrl();
    useMarketStore.setState({ chainMarketsLoading: true, chainMarketsError: null });
    this.chainMarketRequest = chainServiceMgr.queryChainMarkets().then(tickers => {
      if (nodeUrl !== chainServiceMgr.getCurrentNodeUrl()) return;
      useMarketStore.getState().updateChainMarkets(tickers);
    }).catch(error => {
      if (nodeUrl === chainServiceMgr.getCurrentNodeUrl()) {
        useMarketStore.setState({ chainMarketsError: '市场数据加载失败，请重试' });
      }
      console.warn('[BackgroundService] 链上市场发现失败:', error);
    }).finally(() => {
      useMarketStore.setState({ chainMarketsLoading: false });
      this.chainMarketRequest = null;
    });
    return this.chainMarketRequest;
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
      // 空账号会查询所有账户，因此未设置通用配置账户时跳过该查询。
      // 公告始终从固定白名单读取，设备上的旧管理员设置不再参与授权。
      const [settings, ...rootFeeds] = await Promise.all([
        settingsAccount
          ? chainServiceMgr.getStorageInfo(settingsAccount, kAppStorageCatalogAppSettings)
          : Promise.resolve([]),
        ...ANNOUNCEMENT_ADMIN_ACCOUNT_IDS.map(id =>
          chainServiceMgr.getStorageInfo(id, kAppStorageCatalogAppSettings)),
      ]);
      const configuredAdmins = rootFeeds.flatMap(items => {
        const entry = items.find((item: ChainStorageItem) => item.key === kAppStorageKeyAnnouncementAdmins);
        if (!entry) return [];
        try { return parseAnnouncementAdminList(entry.value); } catch { return []; }
      });
      setConfiguredAnnouncementAdmins(configuredAdmins);
      const dynamicIds = getConfiguredAnnouncementAdmins().map(admin => admin.id);
      const dynamicFeeds = dynamicIds.length > 0
        ? await Promise.all(dynamicIds.map(id => chainServiceMgr.getStorageInfo(id, kAppStorageCatalogAppSettings)))
        : [];
      const adminFeeds = [...rootFeeds, ...dynamicFeeds];
      let storageData: ChainStorageItem[] = settings.filter(
        (item: ChainStorageItem) => item.key !== kAppStorageKeyAnnouncements,
      );

      // 主网市场只使用主网配置账户的链上列表；公告仍按固定管理员名单读取。
      // 同时兼容 common.settings.ver.v1.markets 及独立 mainnet.markets.v1 两种写法。
      if (CURRENT_NETWORK_TYPE === 'mainnet') {
        const mainnetMarkets = findMainnetMarkets([settings]);
        if (mainnetMarkets) {
          const commonSource = settings
            .find((item: ChainStorageItem) => item.key === kAppStorageKeyAppSettings_CommonVer);
          let commonValue: Record<string, unknown> = {};
          if (commonSource) {
            try {
              const parsed = typeof commonSource.value === 'string'
                ? JSON.parse(commonSource.value)
                : commonSource.value;
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                commonValue = { ...parsed };
              }
            } catch {
              // 独立市场配置仍可正常使用，无需通用配置的其它字段。
            }
          }
          commonValue.markets = mainnetMarkets;
          storageData = storageData.filter(item => item.key !== kAppStorageKeyAppSettings_CommonVer);
          storageData.push({
            id: commonSource?.id || 'mainnet-markets',
            account: commonSource?.account || '',
            catalog: kAppStorageCatalogAppSettings,
            key: kAppStorageKeyAppSettings_CommonVer,
            value: commonValue,
          });
        }
      }
      const feeds = adminFeeds.map((items: ChainStorageItem[]) => {
        // 查询已经按白名单账号限定；不同节点返回对象的 account 字段可能省略。
        const source = items.find(item => item.key === kAppStorageKeyAnnouncements);
        return source ? parseAnnouncementList(source.value) : [];
      });
      // 即使列表为空也同步，确保撤下或删除的公告不会继续显示。
      storageData.push({
        id: 'announcements', account: '', catalog: kAppStorageCatalogAppSettings,
        key: kAppStorageKeyAnnouncements, value: mergeAnnouncementFeeds(feeds),
      });

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
  private async reloadChainConfig(): Promise<boolean> {
    try {
      const storageData = await this.loadChainConfigFromChain();
      if (storageData) {
        const chainConfigStore = useChainConfigStore.getState();
        chainConfigStore.parseChainStorageData(storageData);
        syncAnnouncementsFromChain();
        console.log('[BackgroundService] 链上配置更新完成');
        return true;
      }
    } catch (error) {
      console.log('[BackgroundService] 重新加载链上配置失败:', error);
    }
    return false;
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
    await this.updateOrderBook(++this.orderBookRequestId);

    return true;
  }

  /**
   * 更新盘口数据
   */
  private async updateOrderBook(requestId: number = ++this.orderBookRequestId): Promise<void> {
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

      // 如果请求期间用户已经切换到另一交易对，丢弃旧响应。
      if (requestId !== this.orderBookRequestId) {
        return;
      }

      if (result.tradingPair) {
        orderBookStore.updateOrderBook(result.orderBook, result.tradingPair);
        console.log(`[BackgroundService] 盘口数据更新完成: ${baseSymbol}/${quoteSymbol}, bids: ${result.orderBook.bids.length}, asks: ${result.orderBook.asks.length}`);
      } else {
        orderBookStore.setError('交易对不存在');
        console.log(`[BackgroundService] 盘口数据更新失败: 交易对 ${baseSymbol}/${quoteSymbol} 不存在`);
      }
    } catch (error) {
      console.log('[BackgroundService] 盘口数据更新失败:', error);
      if (requestId !== this.orderBookRequestId) {
        return;
      }
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
      const nodeUrl = chainServiceMgr.getCurrentNodeUrl();
      const isCurrentAccount = () => useAccountStore.getState().currentAccount?.id === currentAccount.id &&
        chainServiceMgr.getCurrentNodeUrl() === nodeUrl;

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
      if (!isCurrentAccount()) return;
      const balanceStore = useBalanceStore.getState();
      balanceStore.updateFromFullAccount(fullAccountData, assetInfoMap);

      try {
        const pools = await this.queryLiquidityPoolValuations(assetInfoMap);
        if (isCurrentAccount()) balanceStore.updateLiquidityPoolValuations(pools);
      } catch (error) {
        console.warn('[BackgroundService] LP 估值数据更新失败:', error);
      }

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

      // 2. 加载用户本地自定义交易对，确保后续 ticker 查询包含它们
      await marketStore.loadCustomPairsFromCache();

      // 3. 尝试从内存缓存加载 ticker 数据（用于快速展示）
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

      // 4. 从链上加载配置
      await this.refreshChainMarkets(true);
      const storageData = await this.loadChainConfigFromChain();
      if (!storageData) {
        console.log('[BackgroundService] 获取链上配置失败');
        // 即使配置加载失败，如果有缓存数据也标记为已加载
        if (cachedTickerMap) {
          marketStore.setLoaded(true);
        }
        return false;
      }

      // 5. 解析并存储配置到 ChainConfigStore
      const chainConfigStore = useChainConfigStore.getState();
      chainConfigStore.parseChainStorageData(storageData);
      syncAnnouncementsFromChain();

      // 配置加载后立即同步报价资产选择器使用的主网交易对集合。
      if (CURRENT_NETWORK_TYPE === 'mainnet') await this.refreshChainMarkets(true);

      // 6. 初始化资产缓存
      await this.initAssetCache();

      // 7. 初始化盘口交易对
      this.initializeOrderBookTradingPair();

      // 8. 获取所有交易对的 Ticker
      const pairs = marketStore.getAllPairs();
      console.log(`[BackgroundService] 共 ${pairs.length} 个交易对需要获取 Ticker`);

      if (pairs.length > 0) {
        const tickerMap = await chainServiceMgr.queryTickers(pairs);
        if (tickerMap.size > 0) {
          marketStore.updateTickers(tickerMap);
          console.log(`[BackgroundService] 获取了 ${tickerMap.size} 个 Ticker`);
        }
      }

      // 9. 标记加载完成
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
      // 自定义交易对不在链上 APP 配置中，启动时也纳入资产缓存预热。
      useMarketStore.getState().customPairs.forEach(pair => {
        allSymbols.add(pair.baseSymbol);
        allSymbols.add(pair.quoteSymbol);
      });

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

  /** 用当前池储备和 LP 流通量计算份额净值所需数据。 */
  private async queryLiquidityPoolValuations(
    assetInfoMap: Map<string, AssetObject>,
  ): Promise<Map<string, LiquidityPoolValuation>> {
    const shares = Array.from(assetInfoMap.values()).filter(asset => asset.for_liquidity_pool);
    const valuations = new Map<string, LiquidityPoolValuation>();
    if (!shares.length) return valuations;

    const pools = (await chainServiceMgr.getLiquidityPools(
      shares.map(asset => asset.for_liquidity_pool!), false, false,
    )).filter(Boolean);
    const reserveIds = Array.from(new Set<string>(pools.flatMap(pool => [pool.asset_a, pool.asset_b])));
    const dynamicIds = shares.map(asset => asset.dynamic_asset_data_id).filter((id): id is string => !!id);
    const [reserveAssets, dynamicObjects] = await Promise.all([
      reserveIds.length ? chainServiceMgr.getAssets(reserveIds) : Promise.resolve([]),
      dynamicIds.length ? chainServiceMgr.getObjects(dynamicIds) : Promise.resolve([]),
    ]);
    const reservesById = new Map(reserveAssets.filter(Boolean).map(asset => [asset.id, asset]));
    const supplyById = new Map(dynamicObjects.filter(Boolean).map(object => [object.id, object.current_supply]));
    const sharesById = new Map(shares.map(asset => [asset.id, asset]));

    for (const pool of pools) {
      const share = sharesById.get(pool.share_asset);
      const assetA = reservesById.get(pool.asset_a);
      const assetB = reservesById.get(pool.asset_b);
      if (!share?.dynamic_asset_data_id || !assetA || !assetB) continue;
      // 使用 current_supply；累计存入份额不能代表扣除退出后的 LP 总量。
      const supply = Number(supplyById.get(share.dynamic_asset_data_id)) / Math.pow(10, share.precision);
      if (!Number.isFinite(supply) || supply <= 0) continue;
      valuations.set(share.id, {
        shareAssetId: share.id,
        shareSymbol: share.symbol,
        shareSupply: supply,
        reserves: [
          { symbol: assetA.symbol, amount: Number(pool.balance_a) / Math.pow(10, assetA.precision) },
          { symbol: assetB.symbol, amount: Number(pool.balance_b) / Math.pow(10, assetB.precision) },
        ],
      });
    }
    return valuations;
  }

  /**
   * 手动刷新 Ticker
   */
  public async refreshTickers(): Promise<void> {
    await this.updateTickers();
  }

  /**
   * 手动刷新链上配置
   */
  public async refreshChainConfig(): Promise<boolean> {
    return this.reloadChainConfig();
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
