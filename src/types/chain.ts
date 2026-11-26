/**
 * 区块链相关类型定义
 * 定义与 BitShares/Graphene 区块链交互时使用的数据类型
 */

// ============================================================
// 行情数据类型
// ============================================================
import { WsNodeConfig } from '../config/constants';

/**
 * Ticker 行情数据
 */
export interface TickerData {
  /** 基础资产符号 */
  base: string;
  /** 报价资产符号 */
  quote: string;
  /** 最新成交价 */
  latest: string;
  /** 最低卖价 */
  lowest_ask: string;
  /** 最低卖价的基础资产数量 */
  lowest_ask_base_size: string;
  /** 最低卖价的报价资产数量 */
  lowest_ask_quote_size: string;
  /** 最高买价 */
  highest_bid: string;
  /** 最高买价的基础资产数量 */
  highest_bid_base_size: string;
  /** 最高买价的报价资产数量 */
  highest_bid_quote_size: string;
  /** 24小时涨跌幅（百分比字符串） */
  percent_change: string;
  /** 基础资产24小时成交量 */
  base_volume: string;
  /** 报价资产24小时成交量 */
  quote_volume: string;
}

// ============================================================
// 资产相关类型
// ============================================================

/**
 * 资产对象
 */
export interface AssetObject {
  /** 资产 ID，如 "1.3.0" */
  id: string;
  /** 资产符号，如 "BTS"、"CNY" */
  symbol: string;
  /** 精度（小数位数） */
  precision: number;
  /** 发行者账户 ID */
  issuer: string;
  /** 资产选项配置 */
  options: AssetOptions;
  /** 动态资产数据 ID（可选） */
  dynamic_asset_data_id?: string;
  /** 智能资产数据 ID（可选，仅智能资产有） */
  bitasset_data_id?: string;
  /** LP 份额资产对应的流动性池 ID。 */
  for_liquidity_pool?: string;
}

/**
 * 资产选项配置
 */
export interface AssetOptions {
  /** 最大供应量 */
  max_supply: string;
  /** 市场手续费百分比 */
  market_fee_percent: number;
  /** 最大市场手续费 */
  max_market_fee: string;
  /** 发行者权限标志位 */
  issuer_permissions: number;
  /** 当前启用标志位 */
  flags: number;
  /** 核心兑换率 */
  core_exchange_rate: PriceType;
  /** 白名单账户 */
  whitelist_authorities: string[];
  /** 黑名单账户 */
  blacklist_authorities: string[];
  /** 白名单市场 */
  whitelist_markets: string[];
  /** 黑名单市场 */
  blacklist_markets: string[];
  /** 描述信息 */
  description: string;
  /** 扩展字段 */
  extensions: any;
}

/**
 * 价格类型
 */
export interface PriceType {
  /** 基础资产 */
  base: AmountType;
  /** 报价资产 */
  quote: AmountType;
}

/**
 * 金额类型
 */
export interface AmountType {
  /** 数量（整数，需除以精度） */
  amount: string | number;
  /** 资产 ID */
  asset_id: string;
}

// ============================================================
// 账户相关类型
// ============================================================

/**
 * 账户对象
 */
export interface AccountObject {
  /** 账户 ID，如 "1.2.100" */
  id: string;
  /** 账户名称 */
  name: string;
  /** 所有者权限 */
  owner: AuthorityType;
  /** 活跃权限 */
  active: AuthorityType;
  /** 账户选项 */
  options: AccountOptions;
  /** 账户统计信息 ID */
  statistics?: string;
  /** 白名单账户 */
  whitelisting_accounts?: string[];
  /** 黑名单账户 */
  blacklisting_accounts?: string[];
  /** 白名单资产 */
  whitelisted_accounts?: string[];
  /** 黑名单资产 */
  blacklisted_accounts?: string[];
  /** 注册人账户 ID */
  registrar?: string;
  /** 引荐人账户 ID */
  referrer?: string;
  /** 终身会员引荐人 */
  lifetime_referrer?: string;
  /** 手续费分成比例 */
  referrer_rewards_percentage?: number;
}

/**
 * 权限类型
 */
export interface AuthorityType {
  /** 权重阈值 */
  weight_threshold: number;
  /** 账户权限列表 [账户ID, 权重] */
  account_auths: Array<[string, number]>;
  /** 公钥权限列表 [公钥, 权重] */
  key_auths: Array<[string, number]>;
  /** 地址权限列表 [地址, 权重] */
  address_auths: Array<[string, number]>;
}

/**
 * 账户选项
 */
export interface AccountOptions {
  /** 备注公钥 */
  memo_key: string;
  /** 投票代理账户 */
  voting_account: string;
  /** 见证人投票数量 */
  num_witness: number;
  /** 理事会投票数量 */
  num_committee: number;
  /** 投票列表 */
  votes: string[];
  /** 扩展字段 */
  extensions: any[];
}

/**
 * 完整账户数据（get_full_accounts 返回）
 */
export interface FullAccountData {
  /** 账户基本信息 */
  account: AccountObject;
  /** 账户统计信息 */
  statistics?: AccountStatistics;
  /** 账户余额列表 */
  balances: AccountBalance[];
  /** 限价订单列表 */
  limit_orders: LimitOrder[];
  /** 爆仓订单列表 */
  call_orders: CallOrder[];
  /** 强清订单列表 */
  settle_orders: SettleOrder[];
  /** 提案列表 */
  proposals: Proposal[];
  /** 归属期余额列表 */
  vesting_balances: VestingBalance[];
  /** 推荐人列表 */
  referrer_name?: string;
  /** 注册人名称 */
  registrar_name?: string;
  /** 终身会员推荐人名称 */
  lifetime_referrer_name?: string;
  /** 投票列表 */
  votes?: any[];
  /** 资产列表 */
  assets?: string[];
  /** 提现权限 */
  withdraws_from?: any[];
  /** 充值权限 */
  withdraws_to?: any[];
}

/**
 * 账户统计信息
 */
export interface AccountStatistics {
  /** 统计对象 ID */
  id: string;
  /** 所属账户 */
  owner: string;
  /** 最近操作序号 */
  most_recent_op: string;
  /** 总操作数 */
  total_ops: number;
  /** 已移除操作数 */
  removed_ops: number;
  /** 总核心资产余额（包含锁定） */
  total_core_in_orders: string;
  /** 终身手续费已支付 */
  lifetime_fees_paid: string;
  /** 待解冻的归属期余额 */
  pending_fees: string;
  /** 待分发的归属期余额 */
  pending_vested_fees: string;
}

/**
 * 账户余额
 */
export interface AccountBalance {
  /** 余额对象 ID */
  id: string;
  /** 所属账户 */
  owner: string;
  /** 资产类型 */
  asset_type: string;
  /** 余额数量 */
  balance: string | number;
}

// ============================================================
// 订单相关类型
// ============================================================

/**
 * 限价订单
 */
export interface LimitOrder {
  /** 订单 ID */
  id: string;
  /** 过期时间（ISO格式） */
  expiration: string;
  /** 卖方账户 ID */
  seller: string;
  /** 待售数量 */
  for_sale: string;
  /** 卖出价格 */
  sell_price: PriceType;
  /** 递延手续费 */
  deferred_fee?: string;
  /** 递延手续费支付资产 */
  deferred_paid_fee?: AmountType;
}

/**
 * 爆仓订单（抵押借贷订单）
 */
export interface CallOrder {
  /** 订单 ID */
  id: string;
  /** 借款人账户 ID */
  borrower: string;
  /** 抵押品数量 */
  collateral: string;
  /** 借款数量 */
  debt: string;
  /** 爆仓价格 */
  call_price: PriceType;
  /** 目标抵押率 */
  target_collateral_ratio?: number;
}

/**
 * 强清订单
 */
export interface SettleOrder {
  /** 订单 ID */
  id: string;
  /** 所属账户 */
  owner: string;
  /** 清算数量 */
  balance: AmountType;
  /** 清算时间 */
  settlement_date: string;
}

// ============================================================
// 提案相关类型
// ============================================================

/**
 * 提案对象
 */
export interface Proposal {
  /** 提案 ID */
  id: string;
  /** 提案过期时间 */
  expiration_time: string;
  /** 审核期结束时间（可选） */
  review_period_time?: string;
  /** 提案操作列表 */
  proposed_transaction: ProposedTransaction;
  /** 所需活跃权限 */
  required_active_approvals: string[];
  /** 可用活跃权限 */
  available_active_approvals: string[];
  /** 所需所有者权限 */
  required_owner_approvals: string[];
  /** 可用所有者权限 */
  available_owner_approvals: string[];
  /** 可用公钥签名 */
  available_key_approvals: string[];
  /** 提案人账户 */
  proposer: string;
}

/**
 * 提案中的交易
 */
export interface ProposedTransaction {
  /** 参考区块号 */
  ref_block_num: number;
  /** 参考区块前缀 */
  ref_block_prefix: number;
  /** 过期时间 */
  expiration: string;
  /** 操作列表 */
  operations: Array<[number, any]>;
  /** 扩展字段 */
  extensions: any[];
}

// ============================================================
// 归属期余额类型
// ============================================================

/**
 * 归属期余额
 */
export interface VestingBalance {
  /** 余额 ID */
  id: string;
  /** 所属账户 */
  owner: string;
  /** 余额数量 */
  balance: AmountType;
  /** 归属政策 */
  policy: VestingPolicy;
}

/**
 * 归属政策
 */
export type VestingPolicy =
  | [0, LinearVestingPolicy]
  | [1, CddVestingPolicy];

/**
 * 线性归属政策
 */
export interface LinearVestingPolicy {
  /** 开始归属时间 */
  begin_timestamp: string;
  /** 归属悬崖期秒数 */
  vesting_cliff_seconds: number;
  /** 归属持续秒数 */
  vesting_duration_seconds: number;
  /** 开始时余额 */
  begin_balance: string;
}

/**
 * CDD 归属政策
 */
export interface CddVestingPolicy {
  /** 归属秒数 */
  vesting_seconds: number;
  /** 开始索取时间 */
  start_claim: string;
  /** 硬币天数已赚取 */
  coin_seconds_earned: string;
  /** 硬币天数已赚取的最后更新时间 */
  coin_seconds_earned_last_update: string;
}

// ============================================================
// 全局属性类型
// ============================================================

/**
 * 全局属性
 */
export interface GlobalProperties {
  /** 对象 ID */
  id: string;
  /** 链参数 */
  parameters: ChainParameters;
  /** 活跃见证人列表 */
  active_witnesses: string[];
  /** 活跃理事会成员列表 */
  active_committee_members: string[];
}

/**
 * 链参数
 */
export interface ChainParameters {
  /** 当前手续费 */
  current_fees: FeeSchedule;
  /** 区块间隔（秒） */
  block_interval: number;
  /** 维护间隔（秒） */
  maintenance_interval: number;
  /** 维护跳过间隔数 */
  maintenance_skip_slots: number;
  /** 理事会提案审核期（秒） */
  committee_proposal_review_period: number;
  /** 最大交易大小 */
  maximum_transaction_size: number;
  /** 最大区块大小 */
  maximum_block_size: number;
  /** 最大历史操作追踪时间（秒） */
  maximum_time_until_expiration: number;
  /** 最大提案生命周期（秒） */
  maximum_proposal_lifetime: number;
  /** 最大资产白名单数量 */
  maximum_asset_whitelist_authorities: number;
  /** 最大资产喂价数量 */
  maximum_asset_feed_publishers: number;
  /** 最大见证人数量 */
  maximum_witness_count: number;
  /** 最大理事会成员数量 */
  maximum_committee_count: number;
  /** 最大权限深度 */
  maximum_authority_membership: number;
  /** 网络百分比精度 */
  network_percent_of_fee: number;
  /** 终身引荐人百分比 */
  lifetime_referrer_percent_of_fee: number;
  /** 出块奖励 */
  cashback_vesting_period_seconds: number;
  /** 出块奖励归属期 */
  cashback_vesting_threshold: string;
  /** 见证人每块奖励 */
  witness_pay_per_block: string;
  /** 见证人每天预算 */
  witness_pay_vesting_seconds: number;
  /** 工人每天预算 */
  worker_budget_per_day: string;
  /** 最大已验证签名 */
  max_predicate_opcode: number;
  /** 手续费清算阈值 */
  fee_liquidation_threshold: string;
  /** 账户每日手续费 */
  accounts_per_fee_scale: number;
  /** 账户手续费参考区间 */
  account_fee_scale_bitshifts: number;
  /** 最大可授权账户数 */
  max_authority_depth: number;
  /** 扩展字段 */
  extensions: any;
}

/**
 * 手续费表
 */
export interface FeeSchedule {
  /** 手续费参数列表 */
  parameters: Array<[number, any]>;
  /** 缩放比例 */
  scale: number;
}

/**
 * 动态全局属性
 */
export interface DynamicGlobalProperties {
  /** 对象 ID */
  id: string;
  /** 当前区块高度 */
  head_block_number: number;
  /** 当前区块 ID */
  head_block_id: string;
  /** 当前区块时间 */
  time: string;
  /** 当前见证人 */
  current_witness: string;
  /** 下次维护时间 */
  next_maintenance_time: string;
  /** 最近预算时间 */
  last_budget_time: string;
  /** 见证人预算 */
  witness_budget: number;
  /** 已确认账户注册数 */
  accounts_registered_this_interval: number;
  /** 最近不可逆区块号 */
  last_irreversible_block_num: number;
  /** 当前 aslot */
  current_aslot: number;
  /** 最近区块 aslot */
  recent_slots_filled: string;
  /** 动态标志位 */
  dynamic_flags: number;
  /** 最近丢失的见证人数量 */
  last_good_random_sequence: string;
}

/**
 * 链属性
 */
export interface ChainProperties {
  /** 对象 ID */
  id: string;
  /** 链 ID */
  chain_id: string;
  /** 不可变参数 */
  immutable_parameters: ImmutableChainParameters;
}

/**
 * 不可变链参数
 */
export interface ImmutableChainParameters {
  /** 最小理事会成员数量 */
  min_committee_member_count: number;
  /** 最小见证人数量 */
  min_witness_count: number;
  /** 每个账户公钥数量限制 */
  num_special_accounts: number;
  /** 每个账户资产数量限制 */
  num_special_assets: number;
}

// ============================================================
// 见证人/理事会类型
// ============================================================

/**
 * 见证人对象
 */
export interface WitnessObject {
  /** 见证人 ID */
  id: string;
  /** 见证人账户 */
  witness_account: string;
  /** 最近 aslot */
  last_aslot: number;
  /** 签名公钥 */
  signing_key: string;
  /** 见证人每块奖励 */
  pay_vb?: string;
  /** 投票 ID */
  vote_id: string;
  /** 总投票数 */
  total_votes: string;
  /** URL */
  url: string;
  /** 总丢块数 */
  total_missed: number;
  /** 最近确认区块号 */
  last_confirmed_block_num: number;
}

/**
 * 理事会成员对象
 */
export interface CommitteeMemberObject {
  /** 理事会成员 ID */
  id: string;
  /** 理事会成员账户 */
  committee_member_account: string;
  /** 投票 ID */
  vote_id: string;
  /** 总投票数 */
  total_votes: string;
  /** URL */
  url: string;
}

// ============================================================
// 流动性池类型
// ============================================================

/**
 * 流动性池对象
 */
export interface LiquidityPoolObject {
  /** 池 ID */
  id: string;
  /** 资产 A */
  asset_a: string;
  /** 资产 B */
  asset_b: string;
  /** 资产 A 余额 */
  balance_a: string;
  /** 资产 B 余额 */
  balance_b: string;
  /** 份额资产 */
  share_asset: string;
  /** 手提比率 */
  taker_fee_percent: number;
  /** 提现费率 */
  withdrawal_fee_percent: number;
  /** 虚拟数值 */
  virtual_value?: string;
}

// ============================================================
// HTLC 类型
// ============================================================

/**
 * HTLC 对象
 */
export interface HtlcObject {
  /** HTLC ID */
  id: string;
  /** 发送方 */
  transfer_from: string;
  /** 接收方 */
  transfer_to: string;
  /** 金额 */
  amount: AmountType;
  /** 条件 */
  conditions: HtlcConditions;
}

/**
 * HTLC 条件
 */
export interface HtlcConditions {
  /** 哈希锁 */
  hash_lock: {
    /** 原像哈希 */
    preimage_hash: [number, string];
    /** 原像长度 */
    preimage_size: number;
  };
  /** 时间锁 */
  time_lock: {
    /** 过期时间 */
    expiration: string;
  };
}

// ============================================================
// 治理票据类型
// ============================================================

/**
 * 治理票据对象
 */
export interface TicketObject {
  /** 票据 ID */
  id: string;
  /** 所属账户 */
  account: string;
  /** 票据类型 */
  target_type: number;
  /** 金额 */
  amount: AmountType;
  /** 当前类型 */
  current_type: number;
  /** 状态 */
  status: number;
  /** 下一步自动更新时间 */
  next_auto_update_time: string;
  /** 下次类型降级时间 */
  next_type_downgrade_time: string;
  /** 投票数值 */
  value: string;
}

// ============================================================
// 交易对和订单簿类型
// ============================================================

/**
 * 交易对信息
 * 包含基础资产和报价资产的完整信息
 */
export interface TradingPair {
  /** 基础资产 ID，如 "1.3.0" */
  baseId: string;
  /** 基础资产符号，如 "HBW" */
  baseSymbol: string;
  /** 基础资产精度 */
  basePrecision: number;
  /** 基础资产精度幂值 10^precision */
  basePrecisionPow: number;

  /** 报价资产 ID，如 "1.3.1" */
  quoteId: string;
  /** 报价资产符号，如 "USDT" */
  quoteSymbol: string;
  /** 报价资产精度 */
  quotePrecision: number;
  /** 报价资产精度幂值 10^precision */
  quotePrecisionPow: number;
}

/**
 * 订单簿单项（买单或卖单）
 * 
 * 注意：字段命名可能与直觉相反，请参考实际含义：
 * - base: 交易标的数量（如 HBW）
 * - quote: 计价货币金额（如 USDT）
 */
export interface OrderBookItem {
  /** 订单 ID */
  oid: string;
  /** 单价（quote/base，如 1 HBW = X USDT） */
  price: number;
  /** 计价货币金额（如 USDT），买单表示花费金额，卖单表示收到金额 */
  quote: number;
  /** 交易标的数量（如 HBW），买单表示买入数量，卖单表示卖出数量 */
  base: number;
  /** 累计交易标的数量 */
  sum: number;
}

/**
 * 订单簿数据
 */
export interface OrderBookData {
  /** 买单列表（价格从高到低） */
  bids: OrderBookItem[];
  /** 卖单列表（价格从低到高） */
  asks: OrderBookItem[];
}

/**
 * 上次交易对存储数据
 */
export interface LastTradingPairData {
  /** 基础资产符号 */
  baseSymbol: string;
  /** 报价资产符号 */
  quoteSymbol: string;
  /** 保存时间戳 */
  savedAt: number;
}

// ============================================================
// 操作历史类型
// ============================================================

/**
 * 账户历史记录
 */
export interface AccountHistoryRecord {
  /** 历史记录 ID */
  id: string;
  /** 操作 */
  op: [number, any];
  /** 操作结果 */
  result: [number, any];
  /** 区块号 */
  block_num: number;
  /** 交易在区块中的索引 */
  trx_in_block: number;
  /** 操作在交易中的索引 */
  op_in_trx: number;
  /** 虚拟操作序号 */
  virtual_op: number;
}

/**
 * 成交记录
 */
export interface FillOrderRecord {
  /** 记录 ID */
  id: string;
  /** 订单 ID */
  order_id: string;
  /** 账户 ID */
  account_id: string;
  /** 支付金额 */
  pays: AmountType;
  /** 收到金额 */
  receives: AmountType;
  /** 手续费 */
  fee: AmountType;
  /** 成交价格 */
  fill_price: PriceType;
  /** 是否为 maker */
  is_maker: boolean;
}

// ============================================================
// 区块相关类型
// ============================================================

/**
 * 区块数据
 */
export interface BlockData {
  /** 上一个区块 ID */
  previous: string;
  /** 时间戳 */
  timestamp: string;
  /** 见证人 */
  witness: string;
  /** 交易默克尔根 */
  transaction_merkle_root: string;
  /** 见证人签名 */
  witness_signature: string;
  /** 交易列表 */
  transactions: TransactionData[];
  /** 扩展字段 */
  extensions: any[];
}

/**
 * 区块头数据
 */
export interface BlockHeaderData {
  /** 上一个区块 ID */
  previous: string;
  /** 时间戳 */
  timestamp: string;
  /** 见证人 */
  witness: string;
  /** 交易默克尔根 */
  transaction_merkle_root: string;
  /** 见证人签名（可选） */
  witness_signature?: string;
  /** 扩展字段 */
  extensions: any[];
}

/**
 * 交易数据
 */
export interface TransactionData {
  /** 参考区块号 */
  ref_block_num: number;
  /** 参考区块前缀 */
  ref_block_prefix: number;
  /** 过期时间 */
  expiration: string;
  /** 操作列表 [操作类型, 操作数据] */
  operations: Array<[number, any]>;
  /** 扩展字段 */
  extensions: any[];
  /** 签名列表 */
  signatures: string[];
  /** 操作结果列表 */
  operation_results?: Array<[number, any]>;
}

// ============================================================
// 链上动态配置类型
// ============================================================

/**
 * 网关配置
 */
export interface IGroupGatewayConfig {
  /** 网关资产前缀 */
  prefix: string;
  /** 网关资产涉及到的所有发行人账号 */
  issuers: string[];
}

/**
 * 分组头信息
 */
export interface IGroupHeader {
  /** 分组显示优先级，越低越靠前 */
  pid: number;
  /** 动态多语言 KEY */
  name: string;
  /** 分组介绍的 URL 链接 */
  url?: string;
  /** 网关配置（仅网关分组有） */
  gateway?: IGroupGatewayConfig;
}

/**
 * 区块链网络配置
 */
export interface IBlockchainNetwork {
  /** 链标识 */
  chain: string;
  /** 链描述 */
  desc: string;
}

/**
 * 水龙头配置
 */
export interface IFaucetConfig {
  /** 是否使用旧版 API */
  legacy: boolean;
  /** 水龙头 URL */
  url: string;
}

/**
 * 动态参数配置
 */
export interface IAppParameters {
  /** 打开 APP 默认展示页面（home 或 markets） */
  default_launch_index: string;
  /** 动态多语言默认优先级 */
  dynamic_lang_priority: string[];
  /** 自定义交易对默认所在分组 */
  custom_pair_default_groupkey: string;
  /** P2P 抵押贷可接受的抵押物价格精度 */
  credit_offer_collateral_precision: number;
  /** P2P 抵押贷借款时还款期限低于该时间会触发警告（秒） */
  credit_offer_borrow_warning_repay_period: number;
  /** 水龙头配置 */
  faucet: IFaucetConfig;
  /** 网格订单创建网格时的价格精度 */
  grid_bots_price_precision: number;
  /** 买单最大止盈价格倍率（范围: 10001..75535） */
  max_tpprice_rate_buy: number;
  /** 卖单最小止盈价格倍率的倒数（范围: 10001..75535） */
  min_tpprice_rate_sell: number;
  /** 网格订单每个价格差异最大倍率（范围: 10001..75535） */
  grid_bots_tpprice_rate: number;
}

/**
 * URL 配置
 */
export interface IAppUrls {
  /** 常见问题 */
  faq: string;
  /** 首页链接 */
  app_home: string;
  /** RWA 品牌数据 URL（支持 {symbol} 占位符） */
  rwa_data: string;
  /** RWA 品牌故事 URL（支持 {symbol} 占位符） */
  rwa_story: string;
  /** 隐私协议 */
  privacy_policy: string;
  /** 区块浏览器首页（支持 {lang} 占位符） */
  blockchain_explorer_home: string;
  /** 区块交易查询地址（支持 {txid} 占位符） */
  blockchain_explorer_txid: string;
}

/**
 * 流动性池市场配置
 */
export interface IPoolMarket {
  /** 动态多语言 KEY */
  name: string;
}

/**
 * 市场基础配置
 */
export interface IMarketBase {
  /** 动态多语言 KEY 或直接立即值 */
  name: string;
}

/**
 * 市场配置
 */
export interface IMarket {
  /** 市场基础配置 */
  base: IMarketBase;
  /** 交易对列表 [quote, base] */
  list: Array<[string, string]>;
}

/**
 * 锁仓周期配置
 */
export interface ILockPeriod {
  /** 锁仓时长（秒） */
  seconds: number;
  /** 是否为默认选项 */
  default?: boolean;
}

/**
 * 每日签到配置
 */
export interface IDailyCheckinConfig {
  /** 活动 ID */
  activity_id: string;
  /** 是否启用 */
  enable: boolean;
  /** 签到开始时间戳（秒） */
  start_time: number;
  /** 签到周期间隔秒数 */
  period_seconds: number;
  /** 签到周期次数 */
  period_count: number;
  /** 奖励资产符号 */
  reward_asset: string;
  /** 奖励最小金额 */
  reward_amount_min: number;
  /** 奖励最大金额 */
  reward_amount_max: number;
  /** 签到 OP 目标转账账号 */
  target_account: string;
  /** 费用资产符号 */
  fee_asset: string;
  /** 签到费用（字符串格式，如 "33.33"，使用时需解析为 float） */
  checkin_fee: string;
  /** 提现费用（字符串格式，如 "33.33"，使用时需解析为 float） */
  withdraw_fee: string;
}

/**
 * 用户签到数据（链上存储格式）
 */
export interface IUserCheckinData {
  /** 签到状态: 0=未签到, 1=已签到 */
  s: number;
  /** 签到时间戳（秒） */
  st: number;
  /** 签到区块号 */
  sb: number;
  /** 领奖状态: 0=未领奖, 1=已领奖 */
  r: number;
  /** 领奖时间戳（秒） */
  rt: number;
  /** 领奖区块号 */
  rb: number;
  /** 本期奖励金额 */
  ra: number;
  /** 累积奖励金额（从第0期到当前期的累积总额） */
  ca: number;
}

/**
 * 锁仓资产配置
 */
export interface IAssetLockData {
  /** 锁仓周期列表 */
  period: ILockPeriod[];
}

/**
 * HdexMMB 配置
 */
export interface IHdexMmbConfig {
  /** 是否启用 */
  enable: boolean;
}

/**
 * 扩展字段值类型
 */
export type ExtensionValue =
  | Record<string, string>
  | Record<string, number>
  | Record<string, string | number>;

/**
 * 链上动态配置信息（APP 设置）
 */
/**
 * WebSocket 节点配置（链动态配置）
 */

export interface IChainAppCommonSettingsV1 {
  /** 智能币列表 */
  asset_smart_mainlist: string[];

  /** 市场或池子等界面的分组信息配置 */
  // group_headers: Record<string, IGroupHeader>;

  /** 资产作为 quote 资产的优先级（默认值为 0，优先级高者作为 quote 资产/计价货币） */
  asset_quote_priority: Record<string, number>;

  /** 网关资产优先级列表（用于排序，把主要资产排在前面） */
  // gateway_asset_priority: Record<string, number>;

  /** 转账的区块链网络及描述信息（用于联系人及网关等） */
  blockchain_network: IBlockchainNetwork[];

  /** 各种特殊参数 */
  parameters: IAppParameters;

  /** 各种链接 */
  urls: IAppUrls;

  /** 流动性池动态配置 */
  // pool_markets: IPoolMarket[];

  /** 首页市场交易对信息 */
  markets: IMarket[];

  /** 支持的锁仓资产配置 */
  asset_lock_data: IAssetLockData;

  /** 每日签到配置 */
  daily_checkin?: IDailyCheckinConfig;

  /** HdexMMB 配置 */
  // hdexmmb: IHdexMmbConfig;

  /** 链动态 WebSocket 节点列表（可选） */
  ws_nodes?: WsNodeConfig[];

  /** 扩展字段 KEY: oid, VALUE: ext object */
  __ext: Record<string, ExtensionValue>;
}

export type IChainAppSettings = IChainAppCommonSettingsV1;
