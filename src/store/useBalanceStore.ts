/**
 * 用户资产余额状态管理 Store
 * 
 * 数据结构：
 * 1. balanceItems: 基本资产列表（从链上获取）
 * 2. assetInfoMap: 资产详情缓存（精度、符号等）
 * 
 * 衍生数据（useMemo）：
 * - balanceItemsWithValue: 带估算价值的资产列表
 * - totalEstimatedValue: 总估值
 */

import { create } from 'zustand';
import { useMemo } from 'react';
import { useMarketStore } from './useMarketStore';
import type { AssetObject, FullAccountData, LimitOrder, CallOrder, SettleOrder } from '../types';
import { BTS_NETWORK_CORE_ASSET_ID, CURRENT_NETWORK } from '../config';
import { getAssetConversionRate } from '../utils/assetConversion';
import { withLiquidityPoolValuation, type LiquidityPoolValuation } from '../utils/liquidityPoolValuation';
import { localCacheManager } from '../services/local_cache_mgr';

/** 可用于资产估值的币种列表，按产品要求固定为四种资产。 */
const VALUATION_ASSETS = ['CNY', 'USD', 'USDT', 'GOLD'] as const;

// ============================================
// 类型定义
// ============================================

/**
 * 资产余额类型
 */
export enum BalanceType {
    /** 基本余额（可用） */
    AVAILABLE = 'available',
    /** 挂单中余额（限价单 + 清算单） */
    ON_ORDER = 'on_order',
    /** 抵押中余额（债仓抵押） */
    COLLATERAL = 'collateral',
    /** 债务（欠款） */
    DEBT = 'debt',
}

/**
 * 单个资产的详细余额信息
 */
export interface AssetBalanceDetail {
    /** 资产 ID，如 "1.3.0" */
    assetId: string;
    /** 资产符号，如 "BTC" */
    symbol: string;
    /** 资产精度 */
    precision: number;
    /** 可用余额（已转换为实际数量） */
    available: number;
    /** 挂单中余额（已转换为实际数量） */
    onOrder: number;
    /** 抵押中余额（已转换为实际数量） */
    collateral: number;
    /** 债务（已转换为实际数量） */
    debt: number;
    /** 总余额 = 可用 + 挂单 + 抵押 - 债务 */
    total: number;
}

/**
 * 带估算价值的资产余额信息（用于 UI 展示）
 */
export interface BalanceItemWithValue extends AssetBalanceDetail {
    /** 估算单价（以估值资产为单位） */
    estimatedPrice: number;
    /** 估算总价值（以估值资产为单位） */
    estimatedValue: number;
    /** 24小时涨跌幅（百分比） */
    change24h: number;
    /** 图标颜色 */
    color: string;
}

/**
 * 根据行情交易对获取两个资产之间的换算汇率。
 * 支持正向、反向以及通过其他交易对的多跳换算，避免估值币种切换后只有
 * 恰好存在 BASE_QUOTE 交易对的资产才有价值。
 */
/**
 * 余额 Store 状态接口
 */
interface BalanceState {
    // ========== 基础数据 ==========
    /** 资产余额列表 */
    balanceItems: AssetBalanceDetail[];

    /** 资产详情缓存 Map (assetId -> AssetObject) */
    assetInfoMap: Map<string, AssetObject>;
    liquidityPoolValuations: Map<string, LiquidityPoolValuation>;

    /** 数据是否已加载 */
    isLoaded: boolean;

    /** 最后更新时间 */
    lastUpdateTime: number;

    /** 估值基础资产符号（默认为 USDT） */
    valuationAsset: string;

    // ========== Actions ==========
    /** 
     * 从 FullAccountData 解析并更新余额数据 
     * @param fullAccountData 完整账户数据
     * @param assetInfoMap 资产详情 Map（需要外部提供）
     */
    updateFromFullAccount: (
        fullAccountData: FullAccountData,
        assetInfoMap: Map<string, AssetObject>
    ) => void;

    /** 清空余额数据 */
    clearBalances: () => void;

    /** 设置估值基础资产 */
    setValuationAsset: (symbol: string) => void;

    /** 从本地缓存恢复用户上次选择的估值资产 */
    loadValuationAssetFromCache: () => void;

    /** 更新资产详情缓存 */
    updateAssetInfoMap: (assets: AssetObject[]) => void;
    updateLiquidityPoolValuations: (pools: Map<string, LiquidityPoolValuation>) => void;

    /** 设置加载状态 */
    setLoaded: (loaded: boolean) => void;
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
        TEST: '#888888',
    };
    return colorMap[symbol] || '#888888';
};

/**
 * 将整数金额转换为实际数量（根据精度）
 */
const toRealAmount = (amount: string | number, precision: number): number => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return numAmount / Math.pow(10, precision);
};

/**
 * 从 FullAccountData 计算用户资产详细信息
 * 参考 Android 版本的 calcUserAssetDetailInfos 方法
 */
const calcUserAssetDetailInfos = (
    fullAccountData: FullAccountData,
    assetInfoMap: Map<string, AssetObject>
): AssetBalanceDetail[] => {
    // 1. 计算所有资产的总挂单量信息（限价单 + 清算单）
    const onOrderValues = new Map<string, bigint>();

    // 限价单
    const limitOrders = fullAccountData.limit_orders || [];
    for (const order of limitOrders) {
        const sellAssetId = order.sell_price.base.asset_id;
        const sellAmount = BigInt(order.for_sale);
        const currentValue = onOrderValues.get(sellAssetId) || BigInt(0);
        onOrderValues.set(sellAssetId, currentValue + sellAmount);
    }

    // 清算单
    const settleOrders = fullAccountData.settle_orders || [];
    for (const order of settleOrders) {
        const assetId = order.balance.asset_id;
        const amount = BigInt(order.balance.amount);
        const currentValue = onOrderValues.get(assetId) || BigInt(0);
        onOrderValues.set(assetId, currentValue + amount);
    }

    // 2. 计算所有资产的总抵押量信息和总债务信息
    const callOrderValues = new Map<string, bigint>(); // 抵押
    const debtValues = new Map<string, bigint>(); // 债务

    const callOrders = fullAccountData.call_orders || [];
    for (const order of callOrders) {
        // 计算抵押
        const collateralAssetId = order.call_price.base.asset_id;
        const collateralAmount = BigInt(order.collateral);
        const currentCollateral = callOrderValues.get(collateralAssetId) || BigInt(0);
        callOrderValues.set(collateralAssetId, currentCollateral + collateralAmount);

        // 计算债务
        const debtAssetId = order.call_price.quote.asset_id;
        const debtAmount = BigInt(order.debt);
        const currentDebt = debtValues.get(debtAssetId) || BigInt(0);
        debtValues.set(debtAssetId, currentDebt + debtAmount);
    }

    // 3. 收集有效余额（去掉余额为0的资产）
    const validBalancesMap = new Map<string, bigint>();
    const balances = fullAccountData.balances || [];
    for (const balance of balances) {
        const balanceAmount = BigInt(balance.balance);
        if (balanceAmount !== BigInt(0)) {
            validBalancesMap.set(balance.asset_type, balanceAmount);
        }
    }

    // 4. 添加必须显示的资产（核心资产、有挂单没余额、有抵押没余额、有债务没余额）
    if (!validBalancesMap.has(BTS_NETWORK_CORE_ASSET_ID)) {
        validBalancesMap.set(BTS_NETWORK_CORE_ASSET_ID, BigInt(0));
    }

    for (const assetId of onOrderValues.keys()) {
        if (!validBalancesMap.has(assetId)) {
            validBalancesMap.set(assetId, BigInt(0));
        }
    }

    for (const assetId of callOrderValues.keys()) {
        if (!validBalancesMap.has(assetId)) {
            validBalancesMap.set(assetId, BigInt(0));
        }
    }

    for (const assetId of debtValues.keys()) {
        if (!validBalancesMap.has(assetId)) {
            validBalancesMap.set(assetId, BigInt(0));
        }
    }

    // 5. 构建资产余额详情列表
    const result: AssetBalanceDetail[] = [];

    for (const [assetId, availableAmount] of validBalancesMap.entries()) {
        const assetInfo = assetInfoMap.get(assetId);
        const symbol = assetInfo?.symbol || assetId;
        const precision = assetInfo?.precision ?? 5;

        const onOrder = onOrderValues.get(assetId) || BigInt(0);
        const collateral = callOrderValues.get(assetId) || BigInt(0);
        const debt = debtValues.get(assetId) || BigInt(0);

        const availableReal = toRealAmount(availableAmount.toString(), precision);
        const onOrderReal = toRealAmount(onOrder.toString(), precision);
        const collateralReal = toRealAmount(collateral.toString(), precision);
        const debtReal = toRealAmount(debt.toString(), precision);

        // 总余额 = 可用 + 挂单 + 抵押 - 债务
        const total = availableReal + onOrderReal + collateralReal - debtReal;

        result.push({
            assetId,
            symbol,
            precision,
            available: availableReal,
            onOrder: onOrderReal,
            collateral: collateralReal,
            debt: debtReal,
            total,
        });
    }

    // 按总余额降序排序，核心资产始终排第一
    result.sort((a, b) => {
        if (a.assetId === BTS_NETWORK_CORE_ASSET_ID) return -1;
        if (b.assetId === BTS_NETWORK_CORE_ASSET_ID) return 1;
        return b.total - a.total;
    });

    return result;
};

// ============================================
// 创建 Store
// ============================================

export const useBalanceStore = create<BalanceState>((set, get) => ({
    // ========== 初始状态 ==========
    balanceItems: [],
    assetInfoMap: new Map(),
    liquidityPoolValuations: new Map(),
    isLoaded: false,
    lastUpdateTime: 0,
    valuationAsset: CURRENT_NETWORK.defaultQuoteAsset,

    // ========== Actions ==========
    updateFromFullAccount: (fullAccountData, assetInfoMap) => {
        // 先更新资产详情缓存
        const currentAssetInfoMap = get().assetInfoMap;
        const newAssetInfoMap = new Map(currentAssetInfoMap);
        for (const [assetId, assetInfo] of assetInfoMap.entries()) {
            newAssetInfoMap.set(assetId, assetInfo);
        }

        // 计算余额详情
        const balanceItems = calcUserAssetDetailInfos(fullAccountData, newAssetInfoMap);

        set({
            balanceItems,
            assetInfoMap: newAssetInfoMap,
            isLoaded: true,
            lastUpdateTime: Date.now(),
        });

        console.log(`[BalanceStore] 更新了 ${balanceItems.length} 个资产余额`);
    },

    clearBalances: () => {
        set({
            balanceItems: [],
            liquidityPoolValuations: new Map(),
            isLoaded: false,
            lastUpdateTime: 0,
        });
    },

    setValuationAsset: (symbol) => {
        set({ valuationAsset: symbol });
        localCacheManager.saveValuationAsset(symbol);
        useMarketStore.getState().setDefaultQuoteAsset(symbol);
    },

    loadValuationAssetFromCache: () => {
        const savedAsset = localCacheManager.loadValuationAsset();
        if (!savedAsset || !VALUATION_ASSETS.includes(savedAsset as typeof VALUATION_ASSETS[number])) {
            return;
        }

        set({ valuationAsset: savedAsset });
        useMarketStore.getState().setDefaultQuoteAsset(savedAsset);
    },

    updateAssetInfoMap: (assets) => {
        const { assetInfoMap } = get();
        const newMap = new Map(assetInfoMap);
        for (const asset of assets) {
            newMap.set(asset.id, asset);
        }
        set({ assetInfoMap: newMap });
    },

    updateLiquidityPoolValuations: (pools) => {
        set({ liquidityPoolValuations: new Map(pools) });
    },

    setLoaded: (loaded) => {
        set({ isLoaded: loaded });
    },
}));

// ============================================
// 衍生数据 Hooks
// ============================================

/**
 * 获取带估算价值的资产列表
 * 根据 MarketStore 中的 ticker 数据估算资产价值
 */
export const useBalanceItemsWithValue = (): BalanceItemWithValue[] => {
    const balanceItems = useBalanceStore(state => state.balanceItems);
    const valuationAsset = useBalanceStore(state => state.valuationAsset);
    const tickerMap = useMarketStore(state => state.tickerMap);
    const liquidityPoolValuations = useBalanceStore(state => state.liquidityPoolValuations);

    return useMemo(() => {
        const valuationRates = withLiquidityPoolValuation(tickerMap, liquidityPoolValuations);
        return balanceItems.map(item => {
            const estimatedPrice = getAssetConversionRate(item.symbol, valuationAsset, valuationRates);
            const directTicker = tickerMap.get(`${item.symbol}_${valuationAsset}`)
                || tickerMap.get(`${valuationAsset}_${item.symbol}`);
            const change24h = directTicker ? parseFloat(String(directTicker.percent_change)) || 0 : 0;

            const estimatedValue = item.total * estimatedPrice;

            return {
                ...item,
                estimatedPrice,
                estimatedValue,
                change24h,
                color: getAssetColor(item.symbol),
            };
        });
    }, [balanceItems, valuationAsset, tickerMap, liquidityPoolValuations]);
};

/**
 * 获取总估值
 */
export const useTotalEstimatedValue = (): number => {
    const balanceItemsWithValue = useBalanceItemsWithValue();

    return useMemo(() => {
        return balanceItemsWithValue.reduce((sum, item) => {
            // 只计算正值（排除债务导致的负值）
            return sum + Math.max(0, item.estimatedValue);
        }, 0);
    }, [balanceItemsWithValue]);
};

/**
 * 获取估值资产符号
 */
export const useValuationAsset = (): string => {
    return useBalanceStore(state => state.valuationAsset);
};

export const useValuationAssets = (): string[] => [...VALUATION_ASSETS];

/**
 * 获取资产余额加载状态
 */
export const useBalanceLoaded = (): boolean => {
    return useBalanceStore(state => state.isLoaded);
};

// ============================================
// 非 Hook 选择器（用于组件外部调用）
// ============================================

/**
 * 获取当前资产列表（非响应式）
 */
export const getBalanceItems = (): AssetBalanceDetail[] => {
    return useBalanceStore.getState().balanceItems;
};

/**
 * 获取带估算价值的资产列表（非响应式）
 */
export const getBalanceItemsWithValue = (): BalanceItemWithValue[] => {
    const state = useBalanceStore.getState();
    const { balanceItems, valuationAsset, liquidityPoolValuations } = state;
    const marketState = useMarketStore.getState();
    const tickerMap = marketState.tickerMap;
    const valuationRates = withLiquidityPoolValuation(tickerMap, liquidityPoolValuations);

    return balanceItems.map(item => {
        const estimatedPrice = getAssetConversionRate(item.symbol, valuationAsset, valuationRates);
        const directTicker = tickerMap.get(`${item.symbol}_${valuationAsset}`)
            || tickerMap.get(`${valuationAsset}_${item.symbol}`);
        const change24h = directTicker ? parseFloat(String(directTicker.percent_change)) || 0 : 0;

        const estimatedValue = item.total * estimatedPrice;

        return {
            ...item,
            estimatedPrice,
            estimatedValue,
            change24h,
            color: getAssetColor(item.symbol),
        };
    });
};

/**
 * 获取总估值（非响应式）
 */
export const getTotalEstimatedValue = (): number => {
    const itemsWithValue = getBalanceItemsWithValue();
    return itemsWithValue.reduce((sum, item) => {
        return sum + Math.max(0, item.estimatedValue);
    }, 0);
};

export default useBalanceStore;
