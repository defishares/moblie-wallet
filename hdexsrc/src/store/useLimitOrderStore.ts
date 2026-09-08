/**
 * 用户限价单状态管理 Store
 * 
 * 数据结构：
 * 1. rawOrders: 原始限价单列表（从链上获取）
 * 2. assetInfoMap: 资产详情缓存（用于解析订单）
 * 
 * 衍生数据（useMemo）：
 * - useParsedLimitOrders: 根据优先级配置动态解析订单
 * - useOrdersByTradingPair: 按交易对过滤的订单列表
 */

import { create } from 'zustand';
import { useMemo } from 'react';
import type { AssetObject, LimitOrder, TradingPair } from '../types';

// ============================================
// 类型定义
// ============================================

/**
 * 解析后的限价单
 */
export interface ParsedLimitOrder {
  /** 订单 ID */
  id: string;
  /** 订单方向：buy 买入 / sell 卖出 */
  side: 'buy' | 'sell';
  /** 交易对符号，如 "ETH/USDT" */
  symbol: string;
  /** base 资产 ID */
  baseId: string;
  /** base 资产符号 */
  baseSymbol: string;
  /** base 资产精度 */
  basePrecision: number;
  /** quote 资产 ID */
  quoteId: string;
  /** quote 资产符号 */
  quoteSymbol: string;
  /** quote 资产精度 */
  quotePrecision: number;
  /** 价格（quote / base） */
  price: number;
  /** 总数量（base 资产） */
  amount: number;
  /** 已成交数量（base 资产） */
  filledAmount: number;
  /** 剩余数量（base 资产） */
  remainingAmount: number;
  /** 成交百分比 (0-100) */
  filledPercent: number;
  /** 过期时间 */
  expiration: string;
  /** 创建时间（从订单ID解析，近似值） */
  createTime: Date;
  /** 原始订单数据 */
  raw: LimitOrder;
}

/**
 * 限价单 Store 状态接口
 */
interface LimitOrderState {
  // ========== 基础数据（只存储原始数据） ==========
  /** 原始限价单列表 */
  rawOrders: LimitOrder[];

  /** 资产详情缓存 Map (assetId -> AssetObject) */
  assetInfoMap: Map<string, AssetObject>;

  /** 数据是否已加载 */
  isLoaded: boolean;

  /** 是否正在加载 */
  isLoading: boolean;

  /** 最后更新时间 */
  lastUpdateTime: number;

  /** 当前账户 ID */
  currentAccountId: string | null;

  // ========== Actions ==========
  /** 
   * 更新限价单数据（只存储原始数据）
   * @param orders 原始限价单列表
   * @param assetInfoMap 资产详情 Map
   */
  updateOrders: (orders: LimitOrder[], assetInfoMap: Map<string, AssetObject>) => void;

  /** 设置当前账户 */
  setCurrentAccount: (accountId: string | null) => void;

  /** 清空订单数据 */
  clearOrders: () => void;

  /** 更新资产详情缓存 */
  updateAssetInfoMap: (assets: AssetObject[]) => void;

  /** 设置加载状态 */
  setLoading: (loading: boolean) => void;

  /** 设置已加载状态 */
  setLoaded: (loaded: boolean) => void;
}

// ============================================
// 辅助函数
// ============================================

/**
 * 从订单 ID 解析创建时间（近似值）
 * BitShares 对象 ID 格式: x.y.z，z 是自增序列号
 */
const parseCreateTimeFromId = (orderId: string): Date => {
  // 由于无法从 ID 直接获取时间，返回当前时间作为占位
  // 实际可以通过 expiration 和订单有效期推算
  return new Date();
};

/**
 * 解析限价单
 * 
 * @param order 原始链上订单数据
 * @param assetInfoMap 资产详情 Map
 * @param assetQuotePriority 资产作为 quote 的优先级配置（优先级高的作为 quote/计价货币）
 */
const parseLimitOrder = (
  order: LimitOrder,
  assetInfoMap: Map<string, AssetObject>,
  assetQuotePriority?: Record<string, number>
): ParsedLimitOrder | null => {
  const sellPrice = order.sell_price;
  const rawBase = sellPrice.base;  // 原始 sell_price.base（卖出的资产）
  const rawQuote = sellPrice.quote; // 原始 sell_price.quote（换取的资产）

  // 获取资产信息
  const rawBaseAsset = assetInfoMap.get(rawBase.asset_id);
  const rawQuoteAsset = assetInfoMap.get(rawQuote.asset_id);

  if (!rawBaseAsset || !rawQuoteAsset) {
    // 缺少资产信息，无法解析
    return null;
  }

  const rawBasePrecisionPow = Math.pow(10, rawBaseAsset.precision);
  const rawQuotePrecisionPow = Math.pow(10, rawQuoteAsset.precision);

  // 计算原始订单参数
  // sell_price.base 是卖出的资产，quote 是换取的资产
  const sellAmount = Number(rawBase.amount) / rawBasePrecisionPow;
  const receiveAmount = Number(rawQuote.amount) / rawQuotePrecisionPow;

  // 剩余待卖数量（以 sell_price.base 计）
  const forSale = Number(order.for_sale) / rawBasePrecisionPow;

  // 原始价格 = receiveAmount / sellAmount（获得的资产 / 卖出的资产）
  const rawPrice = receiveAmount / sellAmount;

  // ========== 根据 assetQuotePriority 确定最终的 base/quote ==========
  // 规则：优先级高的资产作为 quote（计价货币），优先级低的作为 base（交易标的）

  const rawBasePriority = assetQuotePriority?.[rawBaseAsset.symbol] || 0;
  const rawQuotePriority = assetQuotePriority?.[rawQuoteAsset.symbol] || 0;

  // 判断是否需要交换 base/quote
  // 如果 rawBase 的优先级 > rawQuote 的优先级，说明 rawBase 应该作为 quote，需要交换
  const needSwap = rawBasePriority > rawQuotePriority;

  let finalBaseAsset: AssetObject;
  let finalQuoteAsset: AssetObject;
  let finalBaseId: string;
  let finalQuoteId: string;
  let finalPrice: number;
  let finalAmount: number;
  let finalFilledAmount: number;
  let finalRemainingAmount: number;
  let finalSide: 'buy' | 'sell';

  if (needSwap) {
    // 需要交换：原来的 rawBase 变成 quote，rawQuote 变成 base
    finalBaseAsset = rawQuoteAsset;
    finalQuoteAsset = rawBaseAsset;
    finalBaseId = rawQuote.asset_id;
    finalQuoteId = rawBase.asset_id;

    // 价格取倒数：新价格 = 1 / rawPrice
    finalPrice = rawPrice > 0 ? 1 / rawPrice : 0;

    // 数量需要转换为新 base 的数量
    // 原来卖出 sellAmount 的 rawBase，换取 receiveAmount 的 rawQuote
    // 交换后，base 是 rawQuote，所以 base 数量 = receiveAmount
    finalAmount = receiveAmount;
    // 剩余数量也需要转换
    const remainingRatio = forSale / sellAmount;
    finalRemainingAmount = receiveAmount * remainingRatio;
    finalFilledAmount = finalAmount - finalRemainingAmount;

    // 方向反转：原来是卖出 rawBase 换取 rawQuote
    // 交换后变成：买入 newBase（rawQuote）支付 newQuote（rawBase）
    finalSide = 'buy';
  } else {
    // 不需要交换：保持原样
    finalBaseAsset = rawBaseAsset;
    finalQuoteAsset = rawQuoteAsset;
    finalBaseId = rawBase.asset_id;
    finalQuoteId = rawQuote.asset_id;
    finalPrice = rawPrice;
    finalAmount = sellAmount;
    finalRemainingAmount = forSale;
    finalFilledAmount = finalAmount - finalRemainingAmount;

    // 卖出 base 换取 quote，方向为 sell
    finalSide = 'sell';
  }

  const filledPercent = finalAmount > 0 ? (finalFilledAmount / finalAmount) * 100 : 0;

  return {
    id: order.id,
    side: finalSide,
    symbol: `${finalBaseAsset.symbol}/${finalQuoteAsset.symbol}`,
    baseId: finalBaseId,
    baseSymbol: finalBaseAsset.symbol,
    basePrecision: finalBaseAsset.precision,
    quoteId: finalQuoteId,
    quoteSymbol: finalQuoteAsset.symbol,
    quotePrecision: finalQuoteAsset.precision,
    price: finalPrice,
    amount: finalAmount,
    filledAmount: finalFilledAmount,
    remainingAmount: finalRemainingAmount,
    filledPercent,
    expiration: order.expiration,
    createTime: parseCreateTimeFromId(order.id),
    raw: order,
  };
};

/**
 * 解析所有限价单
 */
const parseAllOrders = (
  orders: LimitOrder[],
  assetInfoMap: Map<string, AssetObject>,
  assetQuotePriority?: Record<string, number>
): ParsedLimitOrder[] => {
  const result: ParsedLimitOrder[] = [];

  for (const order of orders) {
    const parsed = parseLimitOrder(order, assetInfoMap, assetQuotePriority);
    if (parsed) {
      result.push(parsed);
    }
  }

  return result;
};

// ============================================
// 创建 Store（只存储原始数据）
// ============================================

export const useLimitOrderStore = create<LimitOrderState>((set, get) => ({
  // ========== 初始状态 ==========
  rawOrders: [],
  assetInfoMap: new Map(),
  isLoaded: false,
  isLoading: false,
  lastUpdateTime: 0,
  currentAccountId: null,

  // ========== Actions ==========
  updateOrders: (orders, assetInfoMap) => {
    // 合并资产信息
    const currentAssetInfoMap = get().assetInfoMap;
    const newAssetInfoMap = new Map(currentAssetInfoMap);
    for (const [assetId, assetInfo] of assetInfoMap.entries()) {
      newAssetInfoMap.set(assetId, assetInfo);
    }

    set({
      rawOrders: orders,
      assetInfoMap: newAssetInfoMap,
      isLoaded: true,
      isLoading: false,
      lastUpdateTime: Date.now(),
    });

    console.log(`[LimitOrderStore] 存储了 ${orders.length} 个原始限价单`);
  },

  setCurrentAccount: (accountId) => {
    const current = get().currentAccountId;
    if (current !== accountId) {
      // 账户变化时清空订单
      set({
        currentAccountId: accountId,
        rawOrders: [],
        isLoaded: false,
      });
    }
  },

  clearOrders: () => {
    set({
      rawOrders: [],
      isLoaded: false,
      lastUpdateTime: 0,
    });
  },

  updateAssetInfoMap: (assets) => {
    const { assetInfoMap } = get();
    const newMap = new Map(assetInfoMap);
    for (const asset of assets) {
      newMap.set(asset.id, asset);
    }

    set({
      assetInfoMap: newMap,
    });
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setLoaded: (loaded) => {
    set({ isLoaded: loaded });
  },
}));

// ============================================
// 衍生数据 Hooks
// ============================================

/**
 * 获取解析后的限价单列表（根据优先级配置动态解析）
 * 
 * 使用方式：
 * 1. 链上配置：{ HBW: 999, USDT: 1000 } -> USDT 作为 quote
 * 2. 如果当前交易对是翻转的（如 USDT/HBW），则需要合并优先级：
 *    将当前交易对的 quote（HBW）设置为最高优先级 Number.MAX_SAFE_INTEGER
 * 
 * @param assetQuotePriority 合并后的资产优先级配置
 */
export const useParsedLimitOrders = (
  assetQuotePriority?: Record<string, number>
): ParsedLimitOrder[] => {
  const rawOrders = useLimitOrderStore(state => state.rawOrders);
  const assetInfoMap = useLimitOrderStore(state => state.assetInfoMap);

  return useMemo(() => {
    return parseAllOrders(rawOrders, assetInfoMap, assetQuotePriority);
  }, [rawOrders, assetInfoMap, assetQuotePriority]);
};

/**
 * 获取指定交易对的限价单列表
 * 会根据传入的交易对自动将其 quote 资产设置为最高优先级
 * 
 * @param tradingPair 交易对信息（可为 null）
 * @param baseAssetQuotePriority 基础优先级配置（链上配置）
 */
export const useOrdersByTradingPair = (
  tradingPair: TradingPair | null,
  baseAssetQuotePriority?: Record<string, number>
): {
  orders: ParsedLimitOrder[];
  buyOrders: ParsedLimitOrder[];
  sellOrders: ParsedLimitOrder[];
} => {
  const rawOrders = useLimitOrderStore(state => state.rawOrders);
  const assetInfoMap = useLimitOrderStore(state => state.assetInfoMap);

  return useMemo(() => {
    if (!tradingPair) {
      return { orders: [], buyOrders: [], sellOrders: [] };
    }

    // 合并优先级：将当前交易对的 quote 设置为最高优先级
    const mergedPriority: Record<string, number> = {
      ...baseAssetQuotePriority,
      [tradingPair.quoteSymbol]: Number.MAX_SAFE_INTEGER,
    };

    // 解析订单
    const parsedOrders = parseAllOrders(rawOrders, assetInfoMap, mergedPriority);

    const { baseId, quoteId } = tradingPair;
    const orders: ParsedLimitOrder[] = [];
    const buyOrders: ParsedLimitOrder[] = [];
    const sellOrders: ParsedLimitOrder[] = [];

    for (const order of parsedOrders) {
      // 判断订单是否属于当前交易对
      const matchesPair =
        (order.baseId === baseId && order.quoteId === quoteId) ||
        (order.baseId === quoteId && order.quoteId === baseId);

      if (!matchesPair) {
        continue;
      }

      // 由于已经用 mergedPriority 解析，base/quote 应该已经正确
      // 但需要确保方向正确
      if (order.baseId === baseId && order.quoteId === quoteId) {
        // 标准匹配：订单的 base/quote 与交易对一致
        if (order.side === 'buy') {
          buyOrders.push(order);
        } else {
          sellOrders.push(order);
        }
        orders.push(order);
      }
    }

    // 排序：按价格排序
    buyOrders.sort((a, b) => b.price - a.price); // 买单价格从高到低
    sellOrders.sort((a, b) => a.price - b.price); // 卖单价格从低到高
    orders.sort((a, b) => {
      // 先按方向排序（卖单在前），再按价格排序
      if (a.side !== b.side) {
        return a.side === 'sell' ? -1 : 1;
      }
      return a.side === 'buy' ? b.price - a.price : a.price - b.price;
    });

    return { orders, buyOrders, sellOrders };
  }, [rawOrders, assetInfoMap, tradingPair, baseAssetQuotePriority]);
};

/**
 * 获取限价单加载状态
 */
export const useLimitOrderLoading = (): boolean => {
  return useLimitOrderStore(state => state.isLoading);
};

/**
 * 获取限价单是否已加载
 */
export const useLimitOrderLoaded = (): boolean => {
  return useLimitOrderStore(state => state.isLoaded);
};

/**
 * 获取原始限价单数量
 */
export const useLimitOrderCount = (): number => {
  return useLimitOrderStore(state => state.rawOrders.length);
};

// ============================================
// 非 Hook 选择器（用于组件外部调用）
// ============================================

/**
 * 获取原始限价单列表（非响应式）
 */
export const getRawLimitOrders = (): LimitOrder[] => {
  return useLimitOrderStore.getState().rawOrders;
};

/**
 * 获取当前资产信息 Map（非响应式）
 */
export const getAssetInfoMap = (): Map<string, AssetObject> => {
  return useLimitOrderStore.getState().assetInfoMap;
};

export default useLimitOrderStore;
