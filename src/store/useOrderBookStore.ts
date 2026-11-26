/**
 * 盘口数据状态管理
 * 
 * 功能：
 * 1. 管理当前交易对的盘口数据
 * 2. 支持交易对切换时自动清空数据
 * 3. 供 TradeScreen、KLineScreen 等页面使用
 * 
 * 数据流：
 * 1. 启动时从 localCacheManager 加载上次交易对
 * 2. BackgroundService 定时刷新盘口数据
 * 3. 切换交易对时先清空数据，再查询新数据
 */

import { create } from 'zustand';
import type { OrderBookData, TradingPair } from '../types';
import { CURRENT_NETWORK_TYPE, DEFAULT_MAINNET_MARKET_PAIRS } from '../config';

// 默认交易对
const [DEFAULT_QUOTE_SYMBOL, DEFAULT_BASE_SYMBOL] =
  CURRENT_NETWORK_TYPE === 'mainnet'
    ? DEFAULT_MAINNET_MARKET_PAIRS[0]
    : ['USDT', 'HBW'];

/**
 * OrderBook Store 状态接口
 */
interface OrderBookState {
  // ========== 当前交易对 ==========
  /** 当前交易对基础资产符号 */
  baseSymbol: string;
  /** 当前交易对报价资产符号 */
  quoteSymbol: string;

  // ========== 盘口数据 ==========
  /** 盘口数据 */
  orderBook: OrderBookData;
  /** 交易对详细信息（包含精度等） */
  tradingPair: TradingPair | null;

  // ========== 加载状态 ==========
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 最后更新时间 */
  lastUpdatedAt: number | null;

  // ========== Actions ==========
  /**
   * 设置当前交易对
   * 如果交易对变化，会先清空盘口数据
   * @param baseSymbol 基础资产符号
   * @param quoteSymbol 报价资产符号
   * @returns 是否发生变化
   */
  setTradingPair: (baseSymbol: string, quoteSymbol: string) => boolean;

  /**
   * 获取当前交易对的 key（格式：BASE_QUOTE）
   */
  getTradingPairKey: () => string;

  /**
   * 更新盘口数据
   */
  updateOrderBook: (orderBook: OrderBookData, tradingPair: TradingPair | null) => void;

  /**
   * 设置加载状态
   */
  setLoading: (isLoading: boolean) => void;

  /**
   * 设置错误信息
   */
  setError: (error: string | null) => void;

  /**
   * 清空盘口数据（交易对切换时调用）
   */
  clearOrderBook: () => void;

  /**
   * 重置 store
   */
  reset: () => void;
}

// ============================================
// 创建 Store
// ============================================

export const useOrderBookStore = create<OrderBookState>()((set, get) => ({
  // ========== 初始状态 ==========
  baseSymbol: DEFAULT_BASE_SYMBOL,
  quoteSymbol: DEFAULT_QUOTE_SYMBOL,
  orderBook: { bids: [], asks: [] },
  tradingPair: null,
  isLoading: false,
  error: null,
  lastUpdatedAt: null,

  // ========== Actions ==========
  setTradingPair: (baseSymbol: string, quoteSymbol: string): boolean => {
    const state = get();

    // 检查交易对是否发生变化
    if (state.baseSymbol === baseSymbol && state.quoteSymbol === quoteSymbol) {
      console.log(`[OrderBookStore] 交易对未变化: ${baseSymbol}/${quoteSymbol}`);
      return false;
    }

    console.log(`[OrderBookStore] 交易对变化: ${state.baseSymbol}/${state.quoteSymbol} -> ${baseSymbol}/${quoteSymbol}`);

    // 交易对变化，先清空数据
    set({
      baseSymbol,
      quoteSymbol,
      orderBook: { bids: [], asks: [] },
      tradingPair: null,
      error: null,
      lastUpdatedAt: null,
    });

    return true;
  },

  getTradingPairKey: (): string => {
    const state = get();
    return `${state.baseSymbol}_${state.quoteSymbol}`;
  },

  updateOrderBook: (orderBook: OrderBookData, tradingPair: TradingPair | null) => {
    set({
      orderBook,
      tradingPair,
      isLoading: false,
      error: null,
      lastUpdatedAt: Date.now(),
    });
  },

  setLoading: (isLoading: boolean) => {
    set({ isLoading });
  },

  setError: (error: string | null) => {
    set({
      error,
      isLoading: false,
    });
  },

  clearOrderBook: () => {
    set({
      orderBook: { bids: [], asks: [] },
      tradingPair: null,
      error: null,
      lastUpdatedAt: null,
    });
  },

  reset: () => {
    set({
      baseSymbol: DEFAULT_BASE_SYMBOL,
      quoteSymbol: DEFAULT_QUOTE_SYMBOL,
      orderBook: { bids: [], asks: [] },
      tradingPair: null,
      isLoading: false,
      error: null,
      lastUpdatedAt: null,
    });
  },
}));

// ============================================
// 导出常量
// ============================================

export { DEFAULT_BASE_SYMBOL, DEFAULT_QUOTE_SYMBOL };

export default useOrderBookStore;
