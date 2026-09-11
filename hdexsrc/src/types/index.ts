/**
 * 类型定义文件
 * 定义应用中使用的所有 TypeScript 类型
 */

// 导出区块链相关类型
export * from './chain';
import { WsNodeConfig } from '../config/constants';

// 加密货币数据类型（首页用）
export interface CryptoAsset {
  id: string;           // 唯一标识
  symbol: string;       // 货币符号，如 BTC、ETH
  name: string;         // 货币名称，如 Bitcoin、Ethereum
  price: number;        // 当前价格
  priceUsd: number;     // 美元价格
  change24h: number;    // 24小时涨跌幅（百分比）
  color: string;        // 图标颜色
}

// 市场行情数据类型（行情列表用）
export interface MarketItem {
  id: string;              // 唯一标识
  symbol: string;          // 交易对符号，如 BTC
  baseAsset: string;       // 基础资产，如 BTC
  quoteAsset: string;      // 计价资产，如 USDT
  price: number;           // 最新价格
  priceUsd: number;        // 美元价格
  change24h: number;       // 24小时涨跌幅（百分比）
  volume24h: number;       // 24小时成交额（原始值，用于排序）
  volume24hDisplay: number; // 24小时成交额（格式化后的显示值）
  volumeUnit: string;      // 成交额单位（亿、万）
  high24h: number;         // 24小时最高价
  low24h: number;          // 24小时最低价
  amount24h: number;       // 24小时成交量（原始值）
  amount24hDisplay: number; // 24小时成交量（格式化后的显示值）
  amountUnit: string;      // 成交量单位（万）
  color: string;           // 图标颜色
  category: MarketCategory; // 分类：自选、RWA、crypto
  isFavorite: boolean;     // 是否收藏
}

// 市场分类类型（支持动态分组）
// 'favorites' 是固定的自选分类，其他分组从链上配置获取
export type MarketCategory = 'favorites' | string;

// 排序字段类型
export type SortField = 'name' | 'volume' | 'price' | 'change';

// 排序方向类型
export type SortDirection = 'asc' | 'desc' | 'none';

// 排序状态
export interface SortState {
  field: SortField;
  direction: SortDirection;
}

// 公告/新闻类型
export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'new_coin' | 'event' | 'news';  // 公告类型
}

// 用户资产类型
export interface UserAsset {
  totalBalance: number;       // 总资产
  currency: string;           // 计价货币
}

// 用户持有资产项类型（资产页面用）
export interface UserHolding {
  id: string;                 // 唯一标识
  symbol: string;             // 货币符号，如 BTC、ETH
  name: string;               // 货币名称
  balance: number;            // 持有数量
  valueUsd: number;           // 美元价值
  price: number;              // 当前价格
  change24h: number;          // 24小时涨跌幅
  color: string;              // 图标颜色
}

// Tab 类型（首页用，支持动态分组）
export type TabType = 'favorites' | string;

// K线时间周期类型
export type KLineInterval = '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

// K线数据类型
export interface KLineData {
  time: number;      // 时间戳
  open: number;      // 开盘价
  high: number;      // 最高价
  low: number;       // 最低价
  close: number;     // 收盘价
  volume: number;    // 成交量
}

// ============================================
// 链上市场配置相关类型
// ============================================

// 单个市场配置（交易对）
export interface MarketPairConfig {
  base: string;          // 基础资产符号，如 BTC
  quote: string;         // 计价资产符号，如 USDT
  category: MarketCategory; // 所属分类
  priority?: number;     // 优先级（用于排序）
}

// 链上加载的市场列表配置
export interface OnChainMarketConfig {
  version: number;                   // 配置版本号
  lastUpdate: number;                // 最后更新时间戳
  markets: MarketPairConfig[];       // 市场列表
  categories: {                      // 分类信息
    [key: string]: {
      name: string;                  // 分类名称
      order: number;                 // 分类排序
    };
  };
}

// 本地缓存的完整市场数据（包含 ticker 数据）
export interface CachedMarketData {
  config: OnChainMarketConfig;       // 链上配置
  marketList: MarketItem[];          // 完整市场列表（含价格等）
  cacheTime: number;                 // 缓存时间戳
}

// Ticker 更新数据
export interface TickerUpdateData {
  base: string;
  quote: string;
  latest: string;           // 最新价格
  percent_change: string;   // 24h 涨跌幅
  base_volume: string;      // 基础资产24h成交量
  quote_volume: string;     // 计价资产24h成交额
  highest_bid: string;      // 最高买价
  lowest_ask: string;       // 最低卖价
}

// ============================================
// 账号相关类型
// ============================================

/**
 * 账号基本信息（不包含密钥）
 * 存储在本地持久化存储中
 */
export interface AccountInfo {
  id: string;                    // 账号 ID，如 "1.2.xxxxx"
  name: string;                  // 账号名称
  createdAt: number;             // 创建时间戳
  lastLoginAt: number;           // 最后登录时间戳
  avatarColor?: string;          // 头像背景颜色（自动生成）
}

/**
 * 存储的账号列表数据结构
 */
export interface StoredAccountsData {
  currentAccountId: string | null;  // 当前登录的账号 ID
  accounts: AccountInfo[];          // 所有账号列表
}

/**
 * 生物认证类型
 */
export type BiometricType = 'FaceID' | 'TouchID' | 'Fingerprint' | 'Iris' | 'None';

/**
 * 解锁结果
 */
export interface UnlockResult {
  success: boolean;
  privateKey?: string;           // 解密后的私钥
  error?: string;                // 错误信息
}

/**
 * 转账页面参数
 */
export interface TransferScreenParams {
  assetSymbol?: string;              // 预选的资产符号
}

// 导航参数类型
export type RootStackParamList = {
  Launch: undefined;
  Login: undefined;                   // 登录页面
  Register: undefined;                // 注册页面
  MainTabs: { screen?: string; params?: { marketItem?: MarketItem } } | undefined;
  KLine: { marketItem: MarketItem; source?: KLineSource };  // K线页面参数，source 标识来源
  Settings: undefined;                // 设置页面
  About: undefined;                   // 关于页面
  SetupPin: {                         // 设置 PIN 码页面
    accountId: string;
    accountName: string;
    privateKey: string;              // 待加密存储的私钥
  };
  Transfer: TransferScreenParams | undefined;  // 转账页面
  WebView: {                          // 内置网页查看页面
    url: string;                     // 网页 URL
    title?: string;                  // 页面标题
  };
  Invitation: undefined;              // 邀请计划页面
  DailyCheckin: undefined;            // 每日签到页面
  Lending: undefined;                 // DFS 抵押借贷页面
};

// K线来源类型
export type KLineSource = 'market' | 'trade';

export type MainTabParamList = {
  Home: undefined;
  Market: undefined;
  Trade: { marketItem?: MarketItem } | undefined;
  Predict: undefined;
  Assets: undefined;
};

// ============================================
// 版本检测相关类型
// ============================================

/**
 * 链上 APP 信息配置
 */
export interface ChainAppInfo {
  appURL: string;           // 下载链接
  force: boolean;           // 是否强制更新
  newVersionInfo: string;   // 新版本信息（动态多语言 key）
  version: string;          // 最新版本号
}

/**
 * 版本检测结果
 */
export interface VersionCheckResult {
  hasUpdate: boolean;       // 是否有更新
  isForceUpdate: boolean;   // 是否强制更新
  currentVersion: string;   // 当前版本
  latestVersion: string;    // 最新版本
  downloadUrl: string;      // 下载链接
  updateInfo: string;       // 更新信息
}

// ============================================
// API 节点相关类型
// ============================================

/**
 * API 节点信息（运行时使用，含额外状态信息）
 */
export interface ApiNodeInfo {
  id: string;              // 唯一标识（内置节点使用固定 ID，自定义节点使用 UUID）
  name: string;            // 节点名称
  url: string;             // WebSocket URL
  isBuiltin: boolean;      // 是否内置节点
  isChainNode?: boolean;   // 是否链动态节点
  latency?: number;        // 延迟（毫秒）
  isOnline?: boolean;      // 是否在线
}

/**
 * Ping 结果
 */
export interface PingResult {
  url: string;
  success: boolean;
  latency: number;         // 延迟（毫秒），失败时为 Infinity
  error?: string;
}

/**
 * 排序后的节点信息（带延迟）
 */
export interface SortedNodeInfo extends WsNodeConfig {
  latency: number;
}

/**
 * API 节点设置
 */
export interface ApiNodeSettings {
  autoSelect: boolean;              // 是否自动选择
  selectedNodeId: string | null;    // 选中的节点 ID（autoSelect 为 false 时使用）
  customNodes: ApiNodeInfo[];       // 自定义节点列表
}

/**
 * 节点测试结果
 */
export interface NodeTestResult {
  success: boolean;
  latency?: number;        // 延迟（毫秒）
  error?: string;          // 错误信息
}

// ============================================
// 联系人相关类型
// ============================================

/**
 * 联系人明文对象
 */
export interface PlainContactObject {
  blockchain: string;      // 区块链类型，如 'HBW'
  address: string;         // 钱包地址/账户名
  memo: string;            // 备注信息
  name: string;            // 联系人别名
}

/**
 * 联系人密文对象（加密存储）
 */
export interface CipherContactObject {
  from: string;            // 加密发送方公钥
  to: string;              // 加密接收方公钥
  nonce: string;           // 加密随机数
  message: string;         // 加密后的消息（十六进制）
}

/**
 * 联系人存储项（链上存储格式）
 */
export interface ContactStorageItem {
  id: string;              // 存储对象 ID
  account: string;         // 账户 ID
  catalog: string;         // 存储目录
  key: string;             // 存储键
  value: PlainContactObject | CipherContactObject;  // 存储值
}

/**
 * 联系人列表项（UI 展示用）
 */
export interface ContactListItem {
  contact: PlainContactObject | CipherContactObject;  // 联系人对象
  storage: ContactStorageItem;                        // 原始存储数据
  isCipher: boolean;                                  // 是否加密
  isDecryptFailed: boolean;                           // 解密是否失败
}

/**
 * 隐私级别枚举
 */
export enum PrivacyLevel {
  Unknown = 0,                    // 未选择
  Plaintext = 1,                  // 明文存储
  Ciphertext = 2,                 // 密文存储
}
