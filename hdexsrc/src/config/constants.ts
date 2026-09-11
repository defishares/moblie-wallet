/**
 * 应用配置常量
 */

import { NativeModules, Platform } from 'react-native';

// 导入 Native Module 类型
import '../types/native_modules.d';

// ============================================
// 网络类型定义
// ============================================

export type NetworkType = 'mainnet' | 'testnet';

// ============================================
// 渠道类型定义
// ============================================

export type ChannelType = 'hdextest' | 'hdextestadmin' | 'hdexmain' | 'hdexmainadmin';

// ============================================
// 网络配置接口
// ============================================

/**
 * WebSocket 节点配置
 */
export interface WsNodeConfig {
  name: string;            // 节点名称
  url: string;             // WebSocket URL
}

export interface NetworkConfig {
  // 网络类型
  type: NetworkType;
  // 网络名称
  name: string;
  // 节点列表（新格式：包含名称和URL）
  wsNodes: WsNodeConfig[];
  // 默认节点
  defaultWsNode: string;
  // 核心资产符号
  coreAsset: string;
  // 核心资产 ID
  coreAssetId: string;
  // 默认报价资产
  defaultQuoteAsset: string;
  // 链 ID（用于签名验证）
  chainId: string;
}

// ============================================
// 渠道配置接口
// ============================================

export interface ChannelConfig {
  // 渠道类型
  type: ChannelType;
  // 应用 ID
  // applicationId: string;
  // 应用名称
  appName: string;
  // 渠道 ID
  channelId: number;
  // 是否管理员模式
  isAdminMode: boolean;
  // 配置文件名
  // configFile: string;
  // 链上设置账户
  onChainSettingsAccount: string;
  // 对应的网络类型
  networkType: NetworkType;
}

// ============================================
// 模块开关配置接口
// ============================================

export interface ModuleConfig {
  // 启用市场标签页
  enableTabMarket: boolean;
  // 启用债务标签页
  enableTabDebt: boolean;
  // 启用 OTC 功能
  enableOTC: boolean;
  // 启用网关功能
  enableGateway: boolean;
}

// ============================================
// 默认模块配置
// ============================================

export const DEFAULT_MODULE_CONFIG: ModuleConfig = {
  enableTabMarket: true,
  enableTabDebt: false,
  enableOTC: true,
  enableGateway: true,
};

// ============================================
// 主网配置
// ============================================

export const MAINNET_CONFIG: NetworkConfig = {
  type: 'mainnet',
  name: '主网',
  wsNodes: [
    { name: 'DefiShares 节点01', url: 'wss://api-01.defishares.org/ws/' },
    { name: '官方节点01', url: 'wss://api.rwacn.org' },
    { name: '官方节点02', url: 'wss://api1.rwacn.org' },
    { name: '官方节点03', url: 'wss://api2.rwacn.org' },
    { name: 'DeFiShares 节点', url: 'wss://api.defishares.org/ws/' },
  ],
  defaultWsNode: 'wss://api-01.defishares.org/ws/',
  coreAsset: 'HBW',
  coreAssetId: '1.3.0',
  defaultQuoteAsset: 'USDT',
  // 主网链 ID
  chainId: 'd8ee83d8ca641c9bb06d0e1fe09f170fdced44ab55798b41c90f2d47116986d4',
};

// ============================================
// 测试网配置
// ============================================

export const TESTNET_CONFIG: NetworkConfig = {
  type: 'testnet',
  name: '测试网',
  wsNodes: [
    { name: 'DefiShares 节点01', url: 'wss://api-01.defishares.org/ws/' },
    { name: 'DeFiShares 节点', url: 'wss://api.defishares.org/ws/' },
    { name: '测试节点01', url: 'wss://testapi.rwacn.org' },
  ],
  defaultWsNode: 'wss://api-01.defishares.org/ws/',
  coreAsset: 'DFS',
  coreAssetId: '1.3.0',
  defaultQuoteAsset: 'CNY',
  // 测试网链 ID
  chainId: '7089639ad55d91ef53946f3fc4dc86ea5b8a4917edcfce6d3c39bc259657acb5',
};

// 主网基础交易对兜底配置。
// IMarket.list 使用 [quote, base] 顺序，这些交易对的行情仍通过节点实时查询。
export const DEFAULT_MAINNET_MARKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['CNY', 'DFS'],
  ['CNY', 'GOLD'],
  ['CNY', 'USD'],
];

export const DEFAULT_MAINNET_MARKET_GROUP = '主网';

// ============================================
// 所有网络配置
// ============================================

export const NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
  mainnet: MAINNET_CONFIG,
  testnet: TESTNET_CONFIG,
};

// ============================================
// 渠道配置
// ============================================

// 测试网渠道
export const CHANNEL_HDEXTEST: ChannelConfig = {
  type: 'hdextest',
  appName: 'DefiShares测试网',
  channelId: 1001,
  isAdminMode: false,
  onChainSettingsAccount: '1.2.185991',// 链上 APP 配置账户
  networkType: 'testnet',
};

// 测试网管理员渠道
export const CHANNEL_HDEXTESTADMIN: ChannelConfig = {
  type: 'hdextestadmin',
  appName: 'DefiShares管理(测)',
  channelId: 1001,
  isAdminMode: true,
  onChainSettingsAccount: '1.2.185991',// 链上 APP 配置账户
  networkType: 'testnet',
};

// 主网渠道
export const CHANNEL_HDEXMAIN: ChannelConfig = {
  type: 'hdexmain',
  appName: 'DefiShares',
  channelId: 1000,
  isAdminMode: false,
  onChainSettingsAccount: '',// 可设置配置数据
  networkType: 'mainnet',
};

// 主网管理员渠道
export const CHANNEL_HDEXMAINADMIN: ChannelConfig = {
  type: 'hdexmainadmin',
  appName: 'DefiShares管理(主)',
  channelId: 1000,
  isAdminMode: true,
  onChainSettingsAccount: '',// 可设置配置数据
  networkType: 'mainnet',
};

// ============================================
// 所有渠道配置
// ============================================

export const CHANNEL_CONFIGS: Record<ChannelType, ChannelConfig> = {
  hdextest: CHANNEL_HDEXTEST,
  hdextestadmin: CHANNEL_HDEXTESTADMIN,
  hdexmain: CHANNEL_HDEXMAIN,
  hdexmainadmin: CHANNEL_HDEXMAINADMIN,
};

// ============================================
// 当前渠道类型（从原生层读取或使用默认值）
// ============================================

/**
 * 从 Native Module 获取渠道类型
 * Android: 通过 productFlavors 的 buildConfigField 传入
 * iOS: 通过 Info.plist 或 Build Configuration 传入（待实现）
 * 开发时 fallback 到默认值
 */
const getNativeChannelType = (): ChannelType => {
  try {
    const { AppConfig } = NativeModules;
    if (AppConfig?.CHANNEL_TYPE) {
      const channelType = AppConfig.CHANNEL_TYPE as ChannelType;
      // 验证渠道类型是否有效
      if (CHANNEL_CONFIGS[channelType]) {
        return channelType;
      }
      console.warn(`[Constants] Invalid channel type from native: ${channelType}, using default`);
    }
  } catch (error) {
    console.warn('[Constants] Failed to get channel type from native module:', error);
  }
  
  // 默认值：开发时使用主网
  // 可以通过环境变量 __DEV__ 判断是否开发模式
  return __DEV__ ? 'hdextest' : 'hdexmain';
};

// 当前渠道类型（从原生层读取）
export const CURRENT_CHANNEL_TYPE: ChannelType = getNativeChannelType();
// export const CURRENT_CHANNEL_TYPE = 'hdexmain';//TODO:测试ios

// 获取当前渠道配置
export const getCurrentChannelConfig = (): ChannelConfig => {
  return CHANNEL_CONFIGS[CURRENT_CHANNEL_TYPE];
};

// 当前渠道配置（便捷访问）
export const CURRENT_CHANNEL = getCurrentChannelConfig();

// 打印当前渠道信息（仅开发模式）
if (__DEV__) {
  console.log(`[Constants] Current channel: ${CURRENT_CHANNEL_TYPE}`);
  console.log(`[Constants] App name: ${CURRENT_CHANNEL.appName}`);
  console.log(`[Constants] Network: ${CURRENT_CHANNEL.networkType}`);
  console.log(`[Constants] Platform: ${Platform.OS}`);
}

// ============================================
// 当前网络类型（根据渠道自动确定）
// ============================================

export const CURRENT_NETWORK_TYPE: NetworkType = CURRENT_CHANNEL.networkType;

// 获取当前网络配置
export const getCurrentNetworkConfig = (): NetworkConfig => {
  return NETWORK_CONFIGS[CURRENT_NETWORK_TYPE];
};

// 当前网络配置（便捷访问）
export const CURRENT_NETWORK = getCurrentNetworkConfig();

// ============================================
// 通用配置（与网络无关）
// ============================================

// 连接超时时间（毫秒）
export const CONNECTION_TIMEOUT = 15000;

// 重连间隔时间（毫秒）
export const RECONNECT_INTERVAL = 3000;

// 最大重连次数
export const MAX_RECONNECT_ATTEMPTS = 5;

// ============================================
// 应用配置
// ============================================

// 应用名称（根据渠道配置）
export const APP_NAME = CURRENT_CHANNEL.appName;

// 应用版本
export const APP_VERSION = '0.1.2';

// 版本号
export const APP_VERSION_CODE = 202511261;

// ============================================
// API 配置
// ============================================

// API 请求超时时间（毫秒）
export const API_TIMEOUT = 30000;

// ============================================
// 便捷访问方法
// ============================================

// 是否为管理员模式
export const isAdminMode = (): boolean => CURRENT_CHANNEL.isAdminMode;

// 是否为测试网
export const isTestnet = (): boolean => CURRENT_NETWORK_TYPE === 'testnet';

// 是否为主网
export const isMainnet = (): boolean => CURRENT_NETWORK_TYPE === 'mainnet';

// 获取链上设置账户
export const getOnChainSettingsAccount = (): string => CURRENT_CHANNEL.onChainSettingsAccount;

// 获取链 ID
export const getChainId = (): string => CURRENT_NETWORK.chainId;

// ============================================
// 石墨烯链核心配置
// ============================================

// BTS主网核心资产ID号
export const BTS_NETWORK_CORE_ASSET_ID = '1.3.0';

// BTS网络全局属性对象ID号
export const BTS_GLOBAL_PROPERTIES_ID = '2.0.0';

// BTS网络动态全局信息对象ID号
export const BTS_DYNAMIC_GLOBAL_PROPERTIES_ID = '2.1.0';

// ============================================
// 石墨烯特殊账号
// ============================================

// 0:理事会账号
export const BTS_GRAPHENE_COMMITTEE_ACCOUNT = '1.2.0';

// 见证人账号
export const BTS_GRAPHENE_WITNESS_ACCOUNT = '1.2.1';

// 3:黑洞账号，没有任何权限
export const BTS_GRAPHENE_NULL_ACCOUNT = '1.2.3';

// 4:临时账号（隐私交易可能需要由该账号支付手续费等）不需要权限
export const BTS_GRAPHENE_TEMP_ACCOUNT = '1.2.4';

// 5:代理给自己
export const BTS_GRAPHENE_PROXY_TO_SELF = '1.2.5';

// ============================================
// 石墨烯链常量
// ============================================

// 资产最大供应量
export const GRAPHENE_MAX_SHARE_SUPPLY = 1000000000000000;

export const GRAPHENE_100_PERCENT = 10000;
export const GRAPHENE_1_PERCENT = GRAPHENE_100_PERCENT / 100;
export const GRAPHENE_FEE_RATE_DENOM = 1000000;

// 抵押率相关常量
export const GRAPHENE_COLLATERAL_RATIO_DENOM = 1000;
// 低于此值可能导致除以 0
export const GRAPHENE_MIN_COLLATERAL_RATIO = 1001;
// 高于此值没有必要，可能超过 int16 存储
export const GRAPHENE_MAX_COLLATERAL_RATIO = 32000;
// 当抵押品只能偿还 175% 的债务时调用
export const GRAPHENE_DEFAULT_MAINTENANCE_COLLATERAL_RATIO = 1750;
// 当抵押品只能偿还 150% 的债务时停止调用
export const GRAPHENE_DEFAULT_MAX_SHORT_SQUEEZE_RATIO = 1500;

// ============================================
// 链端数据存储 KEY 和类别定义
// ============================================

// 类别：APP设置
export const kAppStorageCatalogAppSettings = 'app.settings.v2';

// 类别：网格机器人的类别
export const kAppStorageCatalogBotsGridBots = 'system.bots.grid_bots';

// KEY：APP设置 > APP最新版本信息 %s - 渠道号，每个渠道不同
export const kAppStorageKeyAppSettings_AppInfo = 'app.info.%s';

// KEY：APP设置 > 通用配置
export const kAppStorageKeyAppSettings_CommonVer = 'common.settings.ver.v1';

// KEY：APP设置 > 动态多语言
export const kAppStorageKeyAppSettings_LangKeyBase = 'dynamic.lang.';

// KEY：APP设置 > 通用设置 扩展字段 中部分属性键值名定义
export const kExtKey_Symbol = 's';
export const kExtKey_Precision = 'p';
export const kExtKey_Name = 'n';

// KEY: 用户 > 联系人列表
export const kUserStorageCatalog_ContactList = 'bcdss.contact_list.v1';

// KEY: 用户 > 绑定的社交媒体信息
export const kUserStorageCatalog_SocialMedia = 'bcdss.socialmedia.v1';

// KEY: 用户 > 社交媒体 > 电报
export const kUserStorageKey_SocialMedia_telegram = 'telegram';

// KEY: APP社交媒体认证账号 > 用户绑定的社交媒体验证类别 占位符：目标账号ID
export const kAppStorageCatalog_SocialMediaVerified = 'bcdss.socialmedia.verified.v1.%s';

// KEY: 用户 > 提醒管理配置
export const kUserStorageCatalog_ReminderSettings = 'bcdss.reminder.settings.v1';
export const kUserStorageKey_ReminderSettings = 'app';

// ============================================
// 动态多语言配置
// ============================================

// 默认语言 KEY（简体中文）
export const kDefaultDynamicLangKey = 'zh-s';
