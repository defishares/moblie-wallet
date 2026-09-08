/**
 * 链上配置状态管理
 * 
 * 数据结构：
 * 1. chainConfigMap: 链上配置原始 Map (key -> value)
 * 2. appSettings: 解析后的 IChainAppSettings
 * 
 * 功能：
 * - 动态多语言支持
 * - APP 信息配置
 * - 版本检测
 */

import { create } from 'zustand';
import type {
  IChainAppSettings,
  ChainAppInfo,
  VersionCheckResult,
} from '../types';
import {
  kAppStorageKeyAppSettings_CommonVer,
  kAppStorageKeyAppSettings_LangKeyBase,
  kDefaultDynamicLangKey,
  APP_VERSION,
} from '../config';

// ============================================
// 类型定义
// ============================================

/**
 * 链上存储项
 */
export interface ChainStorageItem {
  id: string;
  account: string;
  catalog: string;
  key: string;
  value: any;
}

/** 链上 APP 信息配置的 key */
const kAppStorageKeyAppInfo = 'app.info';

/**
 * 比较版本号
 * @returns 正数表示 v1 > v2，负数表示 v1 < v2，0 表示相等
 */
const compareVersions = (v1: string, v2: string): number => {
  const parts1 = v1.split('.').map(n => parseInt(n, 10) || 0);
  const parts2 = v2.split('.').map(n => parseInt(n, 10) || 0);

  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) {
      return p1 - p2;
    }
  }

  return 0;
};

/**
 * 链上配置 Store 状态接口
 */
interface ChainConfigState {
  // ========== 链上配置数据 ==========
  /** 链上配置原始 Map (key -> value) */
  chainConfigMap: Map<string, any>;

  /** 解析后的 APP 设置 */
  appSettings: IChainAppSettings | null;

  // ========== Actions ==========
  /** 设置链上配置 Map */
  setChainConfigMap: (configMap: Map<string, any>) => void;

  /** 从链上存储数据解析配置 */
  parseChainStorageData: (storageData: ChainStorageItem[]) => void;

  /** 设置 APP 设置 */
  setAppSettings: (settings: IChainAppSettings) => void;

  /** 获取动态多语言字符串 */
  getAppDynamicLang: (strKey: string, langKey?: string) => string;

  /** 获取链上 APP 信息配置 */
  getAppInfo: () => ChainAppInfo | null;

  /** 检查版本更新 */
  checkVersion: () => VersionCheckResult | null;

  /** 获取链动态配置中出现的所有资产 symbol */
  getAllAssetSymbols: () => Set<string>;

  /** 重置 store */
  reset: () => void;
}

// ============================================
// 创建 Store
// ============================================

export const useChainConfigStore = create<ChainConfigState>()((set, get) => ({
  // ========== 初始状态 ==========
  chainConfigMap: new Map(),
  appSettings: null,

  // ========== Actions ==========
  setChainConfigMap: (configMap) => {
    set({ chainConfigMap: new Map(configMap) });
  },

  parseChainStorageData: (storageData) => {
    // 1. 将链上存储数据转换为 Map
    const configMap = new Map<string, any>();
    storageData.forEach(item => {
      // 尝试解析 JSON value
      let value = item.value;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          // 保持原值
        }
      }
      configMap.set(item.key, value);
    });

    console.log(`[ChainConfigStore] 解析链上配置，共 ${configMap.size} 项`);

    // 2. 获取最新版本的配置
    let appSettings: IChainAppSettings | null = null;
    if (configMap.has(kAppStorageKeyAppSettings_CommonVer)) {
      appSettings = configMap.get(kAppStorageKeyAppSettings_CommonVer) as IChainAppSettings;
      console.log(`[ChainConfigStore] 加载配置版本: ${kAppStorageKeyAppSettings_CommonVer}`);

      // 3. 处理链动态节点配置
      if (appSettings?.ws_nodes && Array.isArray(appSettings.ws_nodes) && appSettings.ws_nodes.length > 0) {
        // 动态导入以避免循环依赖
        import('../services').then(({ localCacheManager }) => {
          localCacheManager.saveChainWsNodes(appSettings!.ws_nodes!);
          console.log(`[ChainConfigStore] 已保存 ${appSettings!.ws_nodes!.length} 个链动态节点`);
        });

        // 同时更新 ApiNodeStore
        import('./useApiNodeStore').then(({ useApiNodeStore }) => {
          useApiNodeStore.getState().setChainNodes(appSettings!.ws_nodes!);
        });
      }
    }

    set({
      chainConfigMap: configMap,
      appSettings,
    });
  },

  setAppSettings: (settings) => {
    set({ appSettings: settings });
  },

  getAppDynamicLang: (strKey: string, langKey?: string) => {
    const { chainConfigMap, appSettings } = get();
    const currentLangKey = langKey || kDefaultDynamicLangKey;

    // 辅助函数：从指定语言的配置中获取字符串
    const getLangValueCore = (targetLangKey: string): string | null => {
      const storageKey = kAppStorageKeyAppSettings_LangKeyBase + targetLangKey;
      const langHash = chainConfigMap.get(storageKey);
      if (!langHash || typeof langHash !== 'object') {
        return null;
      }
      const value = langHash[strKey];
      return value !== undefined && value !== null ? String(value) : null;
    };

    // 1. 先查询指定语言
    let value = getLangValueCore(currentLangKey);
    if (value !== null) {
      return value;
    }

    // 2. 尝试从默认语言优先级列表查询
    // 优先使用链上配置的优先级列表，否则使用本地默认配置
    const dynamicLangPriority = appSettings?.parameters?.dynamic_lang_priority;
    if (dynamicLangPriority) {
      for (const defaultLangKey of dynamicLangPriority) {
        if (defaultLangKey === currentLangKey) {
          continue; // 已经查询过了，跳过
        }
        value = getLangValueCore(defaultLangKey);
        if (value !== null) {
          return value;
        }
      }
    }

    // 3. 未找到：返回 strKey 自身
    return strKey;
  },

  getAppInfo: () => {
    const { chainConfigMap } = get();
    const appInfo = chainConfigMap.get(kAppStorageKeyAppInfo);

    if (!appInfo || typeof appInfo !== 'object') {
      return null;
    }

    return appInfo as ChainAppInfo;
  },

  checkVersion: () => {
    const state = get();
    const appInfo = state.getAppInfo();

    if (!appInfo || !appInfo.version) {
      console.log('[ChainConfigStore] 未获取到链上版本信息');
      return null;
    }

    const currentVersion = APP_VERSION;
    const latestVersion = appInfo.version;

    // 比较版本号
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    // 获取更新信息（使用动态多语言）
    const updateInfo = appInfo.newVersionInfo
      ? state.getAppDynamicLang(appInfo.newVersionInfo)
      : '发现新版本，请更新以获得更好的体验。';

    const result: VersionCheckResult = {
      hasUpdate,
      isForceUpdate: hasUpdate && appInfo.force === true,
      currentVersion,
      latestVersion,
      downloadUrl: appInfo.appURL || '',
      updateInfo,
    };

    console.log('[ChainConfigStore] 版本检测结果:', result);

    return result;
  },

  getAllAssetSymbols: () => {
    const { appSettings } = get();
    const symbols = new Set<string>();

    if (!appSettings) {
      return symbols;
    }

    // 1. 从 asset_quote_priority 的 KEY 中提取
    if (appSettings.asset_quote_priority) {
      Object.keys(appSettings.asset_quote_priority).forEach(symbol => {
        symbols.add(symbol);
      });
    }

    // 2. 从 markets / list 的 base 和 quote 中提取
    if (appSettings.markets && Array.isArray(appSettings.markets)) {
      appSettings.markets.forEach(market => {
        if (market.list && Array.isArray(market.list)) {
          market.list.forEach(([base, quote]) => {
            if (quote) symbols.add(quote);
            if (base) symbols.add(base);
          });
        }
      });
    }

    // 3. 从 daily_checkin 中提取
    if (appSettings.daily_checkin) {
      symbols.add(appSettings.daily_checkin.fee_asset);
      symbols.add(appSettings.daily_checkin.reward_asset);
    }

    return symbols;
  },

  reset: () => {
    set({
      chainConfigMap: new Map(),
      appSettings: null,
    });
  },
}));

// ============================================
// 非 Hook 选择器（用于组件外部调用）
// ============================================

/**
 * 获取动态多语言字符串（非响应式）
 * @param strKey 字符串 key
 * @param langKey 可选的语言 key，默认使用 kDefaultDynamicLangKey
 */
export const getDynamicLang = (strKey: string, langKey?: string): string => {
  const state = useChainConfigStore.getState();
  return state.getAppDynamicLang(strKey, langKey);
};

/**
 * 获取链上 APP 信息配置（非响应式）
 */
export const getAppInfo = (): ChainAppInfo | null => {
  const state = useChainConfigStore.getState();
  return state.getAppInfo();
};

/**
 * 检查版本更新（非响应式）
 */
export const checkAppVersion = (): VersionCheckResult | null => {
  const state = useChainConfigStore.getState();
  return state.checkVersion();
};

export default useChainConfigStore;

