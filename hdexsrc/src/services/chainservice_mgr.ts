/**
 * 区块链服务管理器
 * 单例模式，负责管理与 BitShares 区块链的连接和 API 调用
 * 
 * 特性：
 * - 自动重连：WebSocket 断开时自动尝试重连
 * - 心跳检测：每 10 秒发送一次心跳，检测连接状态
 */

import { Buffer } from 'buffer';
import { Apis, ChainConfig } from 'bitsharesjs-ws';
import {
  ChainStore,
  PrivateKey,
  TransactionBuilder,
  Aes,
  TransactionHelper,
} from 'bitsharesjs';
import { CURRENT_NETWORK } from '../config';
import { localCacheManager } from './local_cache_mgr';
import {
  buildChainMarketTickers,
  normalizeMarketTicker,
} from '../utils/marketTicker';
import { readStorageFromNode, isStorageApiUnavailable } from './storage_rpc';
import {
  serializeAccountStorageMap,
  confirmStorageWrite,
  StorageConfirmationPendingError,
  type AccountStorageUpdate,
} from '../utils/accountStorage';
import type {
  TickerData,
  AssetObject,
  AccountObject,
  FullAccountData,
  LimitOrder,
  GlobalProperties,
  TradingPair,
  OrderBookData,
  OrderBookItem,
  NodeTestResult,
} from '../types';

// 心跳间隔（毫秒）
const HEARTBEAT_INTERVAL = 10000;

// 重连间隔（毫秒）
const RECONNECT_INTERVAL = 3000;

// 最大重连次数（0 表示无限重连）
const MAX_RECONNECT_ATTEMPTS = 0;

// 心跳超时时间（毫秒）
const HEARTBEAT_TIMEOUT = 5000;

// DeFiShares uses the DFS public-key prefix. bitsharesjs defaults to CBA,
// which makes memo encryption reject the DFS memo keys returned by the chain.
const DEFI_SHARES_ADDRESS_PREFIX = 'DFS';

class ChainServiceManager {
  private static instance: ChainServiceManager;
  private isConnected: boolean = false;
  private isInitializing: boolean = false;
  private currentNodeUrl: string | null = null;  // 当前连接的节点 URL

  // 心跳和重连相关
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private isReconnecting: boolean = false;
  private autoReconnectEnabled: boolean = true;
  // bitsharesjs-ws 6.0.x does not expose custom_operations_api. Keep a
  // lazily initialized adapter for versions that only expose ws_rpc.
  private customOperationsApi: {
    exec: (method: string, params?: any[]) => Promise<any>;
  } | null = null;
  private storageApiUnavailable = false;

  private constructor() { }

  /**
   * 获取当前连接的节点 URL
   */
  public getCurrentNodeUrl(): string | null {
    return this.currentNodeUrl;
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): ChainServiceManager {
    if (!ChainServiceManager.instance) {
      ChainServiceManager.instance = new ChainServiceManager();
    }
    return ChainServiceManager.instance;
  }

  /**
   * 检查是否已连接
   */
  public getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * 设置是否启用自动重连
   */
  public setAutoReconnect(enabled: boolean): void {
    this.autoReconnectEnabled = enabled;
    if (!enabled) {
      this.stopReconnect();
    }
  }

  /**
   * 初始化区块链连接
   * @param nodeUrl 可选的节点 URL，不传则使用默认节点
   * @returns Promise<boolean> 初始化是否成功
   */
  public async initChain(nodeUrl?: string): Promise<boolean> {
    // Keep the prefix correct even when the app resumes with a persisted login
    // and never visits the login/register screens in this process.
    ChainConfig.setPrefix(DEFI_SHARES_ADDRESS_PREFIX);
    const targetUrl = nodeUrl || CURRENT_NETWORK.defaultWsNode;

    // 如果已经连接到相同的节点，直接返回成功
    if (this.isConnected && this.currentNodeUrl === targetUrl) {
      console.log('[ChainService] 已经连接到区块链');
      return true;
    }

    // 如果正在初始化，等待完成
    if (this.isInitializing) {
      console.log('[ChainService] 正在初始化中...');
      return false;
    }

    this.isInitializing = true;

    try {
      // 如果已连接到其他节点，先关闭
      if (this.isConnected) {
        console.log('[ChainService] 切换节点，关闭当前连接...');
        this.stopHeartbeat();
        try {
          await Apis.close();
        } catch (e) {
          // 忽略关闭错误
        }
        this.isConnected = false;
      }

      console.log('[ChainService] 开始连接到区块链节点:', targetUrl);

      // 初始化 WebSocket 连接
      const res = await Apis.instance(targetUrl, true, 4000, {
        enableCustomOperations: true,
      }).init_promise;
      // Connecting can refresh ChainConfig from the node. Re-assert the
      // application prefix before ChainStore and any transaction operations.
      ChainConfig.setPrefix(DEFI_SHARES_ADDRESS_PREFIX);
      console.log('[ChainService] 已连接到网络:', res[0]?.network);

      // 初始化 ChainStore
      await ChainStore.init(false);
      console.log('[ChainService] ChainStore 初始化完成');

      this.isConnected = true;
      this.customOperationsApi = null;
      this.storageApiUnavailable = false;
      this.isInitializing = false;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.currentNodeUrl = targetUrl;

      // 启动心跳检测
      this.startHeartbeat();

      return true;
    } catch (error) {
      console.error('[ChainService] 初始化失败:', error);
      this.isConnected = false;
      this.isInitializing = false;
      this.currentNodeUrl = null;

      // 关闭可能存在的连接
      try {
        await Apis.close();
      } catch (closeError) {
        // 忽略关闭错误
      }

      // 自动安排重连（无论是首次连接还是重连失败）
      if (this.autoReconnectEnabled && !this.reconnectTimer) {
        this.isReconnecting = true;
        this.scheduleReconnect();
      }

      return false;
    }
  }

  /**
   * 带备用节点列表的初始化（自动选择模式）
   * 依次尝试连接节点列表中的节点，直到成功
   * @param nodeUrls 节点 URL 列表
   * @returns Promise<{ success: boolean; connectedUrl?: string }> 初始化结果
   */
  public async initChainWithFallback(
    nodeUrls: string[],
  ): Promise<{ success: boolean; connectedUrl?: string }> {
    if (nodeUrls.length === 0) {
      return { success: false };
    }

    // 禁用自动重连，由我们手动控制
    this.autoReconnectEnabled = false;

    for (let i = 0; i < nodeUrls.length; i++) {
      const url = nodeUrls[i];
      console.log(
        `[ChainService] 尝试连接节点 ${i + 1}/${nodeUrls.length}: ${url}`,
      );

      try {
        const success = await this.initChain(url);
        if (success) {
          console.log('[ChainService] 成功连接到节点:', url);
          this.autoReconnectEnabled = true;
          return { success: true, connectedUrl: url };
        }
      } catch (error) {
        console.log(`[ChainService] 节点 ${url} 连接失败:`, error);
      }
    }

    // 所有节点都失败
    console.error('[ChainService] 所有节点连接失败');
    this.autoReconnectEnabled = true;
    return { success: false };
  }

  /**
   * 测试节点连接（不影响当前连接）
   * @param url 要测试的节点 URL
   * @param timeout 超时时间（毫秒），默认 5000
   * @returns Promise<NodeTestResult> 测试结果
   */
  public async testNodeConnection(
    url: string,
    timeout: number = 5000,
  ): Promise<NodeTestResult> {
    const startTime = Date.now();

    try {
      // 创建一个新的 WebSocket 连接进行测试
      const testPromise = new Promise<void>(async (resolve, reject) => {
        try {
          // 使用原生 WebSocket 进行简单测试
          const ws = new WebSocket(url);

          const timeoutId = setTimeout(() => {
            ws.close();
            reject(new Error('连接超时'));
          }, timeout);

          ws.onopen = () => {
            clearTimeout(timeoutId);
            // 发送一个简单的 RPC 请求来验证节点
            ws.send(
              JSON.stringify({
              id: 1,
              method: 'call',
              params: [1, 'login', ['', '']],
              }),
            );
          };

          ws.onmessage = event => {
            clearTimeout(timeoutId);
            ws.close();
            resolve();
          };

          ws.onerror = error => {
            clearTimeout(timeoutId);
            ws.close();
            reject(new Error('连接错误'));
          };
        } catch (error) {
          reject(error);
        }
      });

      await testPromise;
      const latency = Date.now() - startTime;

      return {
        success: true,
        latency,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || '连接失败',
      };
    }
  }

  /**
   * 关闭区块链连接
   */
  public async close(): Promise<void> {
    // 停止心跳和重连
    this.stopHeartbeat();
    this.stopReconnect();
    this.autoReconnectEnabled = false;

    try {
      await Apis.close();
      this.isConnected = false;
      console.log('[ChainService] 连接已关闭');
    } catch (error) {
      console.error('[ChainService] 关闭连接失败:', error);
    }
  }

  // ============================================================
  // 心跳和重连机制
  // ============================================================

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.stopHeartbeat(); // 先停止之前的心跳

    console.log('[ChainService] 启动心跳检测，间隔:', HEARTBEAT_INTERVAL, 'ms');

    // 使用 setTimeout 实现串行心跳，上一次完成后等待再发下一次
    this.scheduleNextHeartbeat();
  }

  /**
   * 安排下一次心跳
   */
  private scheduleNextHeartbeat(): void {
    if (!this.isConnected || this.isReconnecting) {
      return;
    }

    this.heartbeatTimer = setTimeout(async () => {
      await this.sendHeartbeat();
      // 心跳完成后，安排下一次（如果仍然连接中）
      if (this.isConnected && !this.isReconnecting) {
        this.scheduleNextHeartbeat();
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log('[ChainService] 心跳检测已停止');
    }
  }

  /**
   * 发送心跳
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.isConnected || this.isReconnecting) {
      return;
    }

    try {
      // 使用 Promise.race 实现心跳超时检测
      const heartbeatPromise = this.execDb('get_chain_id');
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('心跳超时')), HEARTBEAT_TIMEOUT);
      });

      await Promise.race([heartbeatPromise, timeoutPromise]);
      // console.log('[ChainService] 心跳正常');
    } catch (error) {
      console.log('[ChainService] 心跳失败:', error);
      this.handleDisconnect();
    }
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(): void {
    if (this.isReconnecting) {
      return; // 已经在重连中
    }

    console.log('[ChainService] 检测到连接断开');
    this.isConnected = false;
    this.stopHeartbeat();

    if (this.autoReconnectEnabled) {
      this.scheduleReconnect();
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // 已经有重连计划
    }

    // 检查重连次数限制
    if (
      MAX_RECONNECT_ATTEMPTS > 0 &&
      this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS
    ) {
      console.error(
        `[ChainService] 已达到最大重连次数 (${MAX_RECONNECT_ATTEMPTS})，停止重连`,
      );
      this.isReconnecting = false;
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    console.log(
      `[ChainService] ${RECONNECT_INTERVAL / 1000}秒后尝试第 ${
        this.reconnectAttempts
      } 次重连...`,
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.reconnect();
    }, RECONNECT_INTERVAL);
  }

  /**
   * 停止重连
   */
  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * 执行重连
   */
  private async reconnect(): Promise<void> {
    console.log(`[ChainService] 开始第 ${this.reconnectAttempts} 次重连...`);

    try {
      // 先关闭旧连接
      try {
        await Apis.close();
      } catch (e) {
        // 忽略关闭错误
      }

      // 重新初始化连接（使用之前连接的节点 URL）
      const success = await this.initChain(this.currentNodeUrl || undefined);

      if (success) {
        console.log('[ChainService] 重连成功');
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
      }
      // 如果失败，initChain 会自动安排下次重连
    } catch (error) {
      console.error('[ChainService] 重连失败:', error);
      // 安排下次重连
      if (this.autoReconnectEnabled) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * 手动触发重连
   * @param nodeUrl 可选的新节点 URL，不传则使用当前节点
   */
  public async manualReconnect(nodeUrl?: string): Promise<boolean> {
    console.log(
      '[ChainService] 手动触发重连',
      nodeUrl ? `到节点: ${nodeUrl}` : '',
    );
    this.stopReconnect();
    this.stopHeartbeat();
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.autoReconnectEnabled = true;

    try {
      await Apis.close();
    } catch (e) {
      // 忽略
    }

    return this.initChain(nodeUrl || this.currentNodeUrl || undefined);
  }

  /**
   * 切换到新节点并重新连接
   * @param nodeUrl 新节点 URL
   * @returns Promise<boolean> 是否成功
   */
  public async switchNode(nodeUrl: string): Promise<boolean> {
    console.log('[ChainService] 切换节点到:', nodeUrl);
    return this.manualReconnect(nodeUrl);
  }

  // ============================================================
  // Database API 接口封装
  // ============================================================

  /**
   * 确保连接已建立
   * 如果未连接直接抛出错误，自动重连由后台处理
   */
  private async ensureConnected(): Promise<void> {
    // 已连接，直接返回
    if (this.isConnected) {
      return;
    }

    // 如果正在初始化或重连中，等待最多 10 秒
    if (this.isReconnecting || this.isInitializing) {
      const maxWaitTime = 10000;
      const checkInterval = 100;
      let waited = 0;

      while (waited < maxWaitTime) {
        await new Promise<void>(resolve =>
          setTimeout(() => resolve(), checkInterval),
        );
        waited += checkInterval;

        if (this.isConnected) {
          return; // 连接成功
        }

        // 如果不再初始化/重连且仍未连接，则跳出等待
        if (!this.isReconnecting && !this.isInitializing) {
          break;
        }
      }

      // 等待后再次检查
      if (this.isConnected) {
        return;
      }
    }

    // 触发自动重连（如果尚未触发）
    if (
      this.autoReconnectEnabled &&
      !this.reconnectTimer &&
      !this.isReconnecting
    ) {
      this.handleDisconnect();
    }

    throw new Error('区块链连接未建立，请稍后重试');
  }

  /**
   * 执行 database_api 调用
   */
  private async execDb<T = any>(
    method: string,
    params: any[] = [],
  ): Promise<T> {
    await this.ensureConnected();
    const dbApi = Apis.instance().db_api();
    if (!dbApi) {
      throw new Error('database_api 不可用，连接可能已断开');
    }
    return dbApi.exec(method, params);
  }

  /**
   * 执行 history_api 调用
   */
  private async execHistory<T = any>(
    method: string,
    params: any[] = [],
  ): Promise<T> {
    await this.ensureConnected();
    const historyApi = Apis.instance().history_api();
    if (!historyApi) {
      throw new Error('history_api 不可用，连接可能已断开');
    }
    return historyApi.exec(method, params);
  }

  /**
   * 执行 custom_operations_api 调用（需要节点支持 enableCustomOperations: true）
   */
  private async execCustomOperations<T = any>(
    method: string,
    params: any[] = [],
  ): Promise<T> {
    await this.ensureConnected();
    const apis = Apis.instance() as any;
    let api =
      typeof apis.custom_operations_api === 'function'
      ? apis.custom_operations_api()
      : null;

    // bitsharesjs-ws@6.0.2 silently drops optional API settings and has no
    // custom_operations_api accessor. Initialize the API set directly over
    // its underlying websocket connection in that case.
    if (!api && apis.ws_rpc?.call) {
      if (!this.customOperationsApi) {
        const apiId = await apis.ws_rpc.call([1, 'custom_operations', []]);
        this.customOperationsApi = {
          exec: (apiMethod: string, apiParams: any[] = []) =>
            apis.ws_rpc.call([apiId, apiMethod, apiParams]),
        };
      }
      api = this.customOperationsApi;
    }

    if (!api) {
      throw new Error('custom_operations_api 不可用，请确保节点支持此 API');
    }
    return api.exec(method, params);
  }

  // ============================================================
  // 对象查询接口
  // ============================================================

  /**
   * 获取指定ID的对象
   * @param ids 对象ID数组
   * @param subscribe 是否订阅（可选）
   */
  public getObjects(ids: string[], subscribe?: boolean): Promise<any[]> {
    const params: any[] = [ids];
    if (subscribe !== undefined) {
      params.push(subscribe);
    }
    return this.execDb('get_objects', params);
  }

  // ============================================================
  // 全局属性和配置接口
  // ============================================================

  /**
   * 获取全局属性（包括活跃理事会、活跃见证人、手续费等信息）
   */
  public getGlobalProperties(): Promise<GlobalProperties> {
    return this.execDb('get_global_properties');
  }

  /**
   * 获取链属性（chain_id 等）
   */
  public getChainProperties(): Promise<any> {
    return this.execDb('get_chain_properties');
  }

  /**
   * 获取链配置（GRAPHENE_SYMBOL, GRAPHENE_ADDRESS_PREFIX 等）
   */
  public getConfig(): Promise<any> {
    return this.execDb('get_config');
  }

  /**
   * 获取链ID
   */
  public getChainId(): Promise<string> {
    return this.execDb('get_chain_id');
  }

  /**
   * 获取动态全局属性
   */
  public getDynamicGlobalProperties(): Promise<any> {
    return this.execDb('get_dynamic_global_properties');
  }

  // ============================================================
  // 区块和交易接口
  // ============================================================

  /**
   * 获取区块
   * @param blockNum 区块高度
   */
  public getBlock(blockNum: number): Promise<any> {
    return this.execDb('get_block', [blockNum]);
  }

  /**
   * 获取区块头
   * @param blockNum 区块高度
   * @param withWitnessSignature 是否包含见证人签名（可选）
   */
  public getBlockHeader(
    blockNum: number,
    withWitnessSignature?: boolean,
  ): Promise<any> {
    const params: any[] = [blockNum];
    if (withWitnessSignature !== undefined) {
      params.push(withWitnessSignature);
    }
    return this.execDb('get_block_header', params);
  }

  /**
   * 批量获取区块头
   * @param blockNums 区块高度数组
   * @param withWitnessSignatures 是否包含见证人签名（可选）
   */
  public getBlockHeaderBatch(
    blockNums: number[],
    withWitnessSignatures?: boolean,
  ): Promise<Map<number, any>> {
    const params: any[] = [blockNums];
    if (withWitnessSignatures !== undefined) {
      params.push(withWitnessSignatures);
    }
    return this.execDb('get_block_header_batch', params);
  }

  /**
   * 获取交易
   * @param blockNum 区块高度
   * @param trxInBlock 交易在区块中的索引
   */
  public getTransaction(blockNum: number, trxInBlock: number): Promise<any> {
    return this.execDb('get_transaction', [blockNum, trxInBlock]);
  }

  // ============================================================
  // 账户相关接口
  // ============================================================

  /**
   * 通过名称获取账户
   * @param accountName 账户名称
   */
  public getAccountByName(accountName: string): Promise<AccountObject | null> {
    return this.execDb('get_account_by_name', [accountName]);
  }

  /**
   * 获取账户信息
   * @param accountIds 账户ID或名称数组
   */
  public getAccounts(accountIds: string[]): Promise<AccountObject[]> {
    return this.execDb('get_accounts', [accountIds]);
  }

  /**
   * 获取完整账户信息
   * @param namesOrIds 账户名称或ID数组
   * @param subscribe 是否订阅（默认 false）
   */
  public getFullAccounts(
    namesOrIds: string[],
    subscribe: boolean = false,
  ): Promise<Array<[string, FullAccountData]>> {
    return this.execDb('get_full_accounts', [namesOrIds, subscribe]);
  }

  /**
   * 查找账户
   * @param lowerBound 起始字符
   * @param limit 查询数量限制
   */
  public lookupAccounts(
    lowerBound: string,
    limit: number,
  ): Promise<Array<[string, string]>> {
    return this.execDb('lookup_accounts', [lowerBound, limit]);
  }

  /**
   * 通过公钥查询关联的账户ID
   * @param keys 公钥数组
   */
  public getKeyReferences(keys: string[]): Promise<string[][]> {
    return this.execDb('get_key_references', [keys]);
  }

  /**
   * 获取账户数量
   */
  public getAccountCount(): Promise<number> {
    return this.execDb('get_account_count');
  }

  // ============================================================
  // 余额相关接口
  // ============================================================

  /**
   * 获取账户余额
   * @param accountId 账户ID
   * @param assetIds 资产ID数组（空数组表示获取所有资产余额）
   */
  public getAccountBalances(
    accountId: string,
    assetIds: string[] = [],
  ): Promise<any[]> {
    return this.execDb('get_account_balances', [accountId, assetIds]);
  }

  /**
   * 通过账户名获取余额
   * @param accountName 账户名称
   * @param assetSymbols 资产符号数组
   */
  public getNamedAccountBalances(
    accountName: string,
    assetSymbols: string[],
  ): Promise<any[]> {
    return this.execDb('get_named_account_balances', [
      accountName,
      assetSymbols,
    ]);
  }

  // ============================================================
  // 资产相关接口
  // ============================================================

  /**
   * 获取资产信息
   * @param assetIds 资产ID数组
   */
  public getAssets(assetIds: string[]): Promise<AssetObject[]> {
    return this.execDb('get_assets', [assetIds]);
  }

  /**
   * 列出资产
   * @param lowerBound 起始符号
   * @param limit 查询数量限制
   */
  public listAssets(lowerBound: string, limit: number): Promise<AssetObject[]> {
    return this.execDb('list_assets', [lowerBound, limit]);
  }

  /**
   * 查找资产符号
   * @param symbolsOrIds 资产符号或ID数组
   */
  public lookupAssetSymbols(symbolsOrIds: string[]): Promise<AssetObject[]> {
    return this.execDb('lookup_asset_symbols', [symbolsOrIds]);
  }

  /**
   * 根据发行者查询资产
   * @param issuerNameOrId 发行者账户名或ID
   * @param start 起始资产ID
   * @param limit 查询数量限制
   */
  public getAssetsByIssuer(
    issuerNameOrId: string,
    start: string,
    limit: number,
  ): Promise<AssetObject[]> {
    return this.execDb('get_assets_by_issuer', [issuerNameOrId, start, limit]);
  }

  /**
   * 获取资产数量
   */
  public getAssetCount(): Promise<number> {
    return this.execDb('get_asset_count');
  }

  // ============================================================
  // 市场/交易相关接口
  // ============================================================

  /**
   * 获取行情 Ticker 数据
   * @param baseSymbol 基础资产符号
   * @param quoteSymbol 报价资产符号
   */
  public getTicker(
    baseSymbol: string,
    quoteSymbol: string,
  ): Promise<TickerData> {
    return this.execDb('get_ticker', [baseSymbol, quoteSymbol]);
  }

  /** Discover markets recorded by the chain, including markets with no volume today. */
  public async queryChainMarkets(): Promise<Map<string, TickerData>> {
    // The current node allows at most 100 markets per request.
    const rows = await this.execDb('get_top_markets', [100]);
    if (!Array.isArray(rows)) throw new Error('链上市场列表格式错误');
    return buildChainMarketTickers(rows);
  }

  /**
   * 获取24小时交易量
   * @param baseSymbol 基础资产符号
   * @param quoteSymbol 报价资产符号
   */
  public get24Volume(baseSymbol: string, quoteSymbol: string): Promise<any> {
    return this.execDb('get_24_volume', [baseSymbol, quoteSymbol]);
  }

  /**
   * 获取订单簿
   * @param baseSymbol 基础资产符号
   * @param quoteSymbol 报价资产符号
   * @param limit 深度限制
   */
  public getOrderBook(
    baseSymbol: string,
    quoteSymbol: string,
    limit: number = 50,
  ): Promise<any> {
    return this.execDb('get_order_book', [baseSymbol, quoteSymbol, limit]);
  }

  /**
   * 获取限价单
   * @param baseId 基础资产ID
   * @param quoteId 报价资产ID
   * @param limit 查询数量限制
   */
  public getLimitOrders(
    baseId: string,
    quoteId: string,
    limit: number,
  ): Promise<LimitOrder[]> {
    return this.execDb('get_limit_orders', [baseId, quoteId, limit]);
  }

  /**
   * 根据账户获取限价单
   * @param accountNameOrId 账户名或ID
   * @param limit 查询数量限制
   * @param startId 起始订单ID（用于分页）
   */
  public getLimitOrdersByAccount(
    accountNameOrId: string,
    limit: number,
    startId?: string,
  ): Promise<LimitOrder[]> {
    const params: any[] = [accountNameOrId, limit];
    if (startId) {
      params.push(startId);
    }
    return this.execDb('get_limit_orders_by_account', params);
  }

  /**
   * 获取爆仓单（Call Orders）
   * @param assetId 智能资产ID
   * @param limit 查询数量限制
   */
  public getCallOrders(assetId: string, limit: number): Promise<any[]> {
    return this.execDb('get_call_orders', [assetId, limit]);
  }

  /**
   * 根据账户获取爆仓单
   * @param accountNameOrId 账户名或ID
   * @param start 起始订单ID
   * @param limit 查询数量限制
   */
  public getCallOrdersByAccount(
    accountNameOrId: string,
    start: string,
    limit: number,
  ): Promise<any[]> {
    return this.execDb('get_call_orders_by_account', [
      accountNameOrId,
      start,
      limit,
    ]);
  }

  /**
   * 获取强清单（Settle Orders）
   * @param assetSymbolOrId 资产符号或ID
   * @param limit 查询数量限制
   */
  public getSettleOrders(
    assetSymbolOrId: string,
    limit: number,
  ): Promise<any[]> {
    return this.execDb('get_settle_orders', [assetSymbolOrId, limit]);
  }

  /**
   * 根据账户获取强清单
   * @param accountNameOrId 账户名或ID
   * @param start 起始订单ID
   * @param limit 查询数量限制
   */
  public getSettleOrdersByAccount(
    accountNameOrId: string,
    start: string,
    limit: number,
  ): Promise<any[]> {
    return this.execDb('get_settle_orders_by_account', [
      accountNameOrId,
      start,
      limit,
    ]);
  }

  /**
   * 获取交易历史
   * @param baseSymbol 基础资产符号
   * @param quoteSymbol 报价资产符号
   * @param start 开始时间（ISO格式）
   * @param stop 结束时间（ISO格式）
   * @param limit 查询数量限制
   */
  public getTradeHistory(
    baseSymbol: string,
    quoteSymbol: string,
    start: string,
    stop: string,
    limit: number,
  ): Promise<any[]> {
    return this.execDb('get_trade_history', [
      baseSymbol,
      quoteSymbol,
      start,
      stop,
      limit,
    ]);
  }

  /**
   * 订阅市场
   * @param callback 回调函数
   * @param baseId 基础资产ID
   * @param quoteId 报价资产ID
   */
  public subscribeToMarket(
    callback: (data: any) => void,
    baseId: string,
    quoteId: string,
  ): Promise<any> {
    return this.execDb('subscribe_to_market', [callback, baseId, quoteId]);
  }

  /**
   * 取消订阅市场
   * @param baseId 基础资产ID
   * @param quoteId 报价资产ID
   */
  public unsubscribeFromMarket(baseId: string, quoteId: string): Promise<any> {
    return this.execDb('unsubscribe_from_market', [baseId, quoteId]);
  }

  // ============================================================
  // 见证人/理事会相关接口
  // ============================================================

  /**
   * 获取见证人信息
   * @param witnessIds 见证人ID数组
   */
  public getWitnesses(witnessIds: string[]): Promise<any[]> {
    return this.execDb('get_witnesses', [witnessIds]);
  }

  /**
   * 根据账户获取见证人
   * @param accountNameOrId 账户名或ID
   */
  public getWitnessByAccount(accountNameOrId: string): Promise<any> {
    return this.execDb('get_witness_by_account', [accountNameOrId]);
  }

  /**
   * 查找见证人账户
   * @param lowerBound 起始字符
   * @param limit 查询数量限制
   */
  public lookupWitnessAccounts(
    lowerBound: string,
    limit: number,
  ): Promise<Array<[string, string]>> {
    return this.execDb('lookup_witness_accounts', [lowerBound, limit]);
  }

  /**
   * 获取见证人数量
   */
  public getWitnessCount(): Promise<number> {
    return this.execDb('get_witness_count');
  }

  /**
   * 获取理事会成员信息
   * @param memberIds 理事会成员ID数组
   */
  public getCommitteeMembers(memberIds: string[]): Promise<any[]> {
    return this.execDb('get_committee_members', [memberIds]);
  }

  /**
   * 根据账户获取理事会成员
   * @param accountNameOrId 账户名或ID
   */
  public getCommitteeMemberByAccount(accountNameOrId: string): Promise<any> {
    return this.execDb('get_committee_member_by_account', [accountNameOrId]);
  }

  /**
   * 查找理事会成员账户
   * @param lowerBound 起始字符
   * @param limit 查询数量限制
   */
  public lookupCommitteeMemberAccounts(
    lowerBound: string,
    limit: number,
  ): Promise<Array<[string, string]>> {
    return this.execDb('lookup_committee_member_accounts', [lowerBound, limit]);
  }

  /**
   * 获取理事会成员数量
   */
  public getCommitteeCount(): Promise<number> {
    return this.execDb('get_committee_count');
  }

  // ============================================================
  // 投票相关接口
  // ============================================================

  /**
   * 查询投票ID信息
   * @param voteIds 投票ID数组
   */
  public lookupVoteIds(voteIds: string[]): Promise<any[]> {
    return this.execDb('lookup_vote_ids', [voteIds]);
  }

  // ============================================================
  // 流动性池相关接口
  // ============================================================

  /**
   * 获取流动性池信息
   * @param poolIds 流动性池ID数组
   * @param subscribe 是否订阅（可选）
   * @param withStatistics 是否包含统计数据（可选）
   */
  public getLiquidityPools(
    poolIds: string[],
    subscribe?: boolean,
    withStatistics?: boolean,
  ): Promise<any[]> {
    const params: any[] = [poolIds];
    if (subscribe !== undefined || withStatistics !== undefined)
      params.push(subscribe === undefined ? null : subscribe);
    if (withStatistics !== undefined) params.push(withStatistics);
    return this.execDb('get_liquidity_pools', params);
  }

  /**
   * 列出流动性池
   * @param limit 查询数量限制
   * @param startId 起始池ID
   * @param withStatistics 是否包含统计数据
   */
  public listLiquidityPools(
    limit?: number,
    startId?: string,
    withStatistics?: boolean,
  ): Promise<any[]> {
    const params: any[] = [];
    if (limit !== undefined) params.push(limit);
    // Graphene 的第三个参数是 with_stats；需要跳过 start_id 时保留 null 占位。
    if (startId !== undefined || withStatistics !== undefined)
      params.push(startId === undefined ? null : startId);
    if (withStatistics !== undefined) params.push(withStatistics);
    return this.execDb('list_liquidity_pools', params);
  }

  /**
   * 根据资产A获取流动性池
   * @param assetA 资产A的符号或ID
   * @param limit 查询数量限制
   * @param startId 起始池ID
   * @param withStatistics 是否包含统计数据
   */
  public getLiquidityPoolsByAssetA(
    assetA: string,
    limit?: number,
    startId?: string,
    withStatistics?: boolean,
  ): Promise<any[]> {
    const params: any[] = [assetA];
    if (limit !== undefined) params.push(limit);
    if (startId !== undefined || withStatistics !== undefined)
      params.push(startId === undefined ? null : startId);
    if (withStatistics !== undefined) params.push(withStatistics);
    return this.execDb('get_liquidity_pools_by_asset_a', params);
  }

  /**
   * 根据资产B获取流动性池
   * @param assetB 资产B的符号或ID
   * @param limit 查询数量限制
   * @param startId 起始池ID
   * @param withStatistics 是否包含统计数据
   */
  public getLiquidityPoolsByAssetB(
    assetB: string,
    limit?: number,
    startId?: string,
    withStatistics?: boolean,
  ): Promise<any[]> {
    const params: any[] = [assetB];
    if (limit !== undefined) params.push(limit);
    if (startId !== undefined || withStatistics !== undefined)
      params.push(startId === undefined ? null : startId);
    if (withStatistics !== undefined) params.push(withStatistics);
    return this.execDb('get_liquidity_pools_by_asset_b', params);
  }

  /** 查询池子的链上操作历史。参数顺序遵循 defishares-core history_api。 */
  public getLiquidityPoolHistory(
    poolId: string,
    start?: number | string,
    stop?: number | string,
    limit?: number,
    operationType?: number,
  ): Promise<any[]> {
    const params: any[] = [poolId];
    if (
      start !== undefined ||
      stop !== undefined ||
      limit !== undefined ||
      operationType !== undefined
    )
      params.push(start === undefined ? null : start);
    if (
      stop !== undefined ||
      limit !== undefined ||
      operationType !== undefined
    )
      params.push(stop === undefined ? null : stop);
    if (limit !== undefined || operationType !== undefined)
      params.push(limit === undefined ? null : limit);
    if (operationType !== undefined) params.push(operationType);
    return this.execHistory('get_liquidity_pool_history', params);
  }

  // ============================================================
  // Ticket 治理票据相关接口
  // ============================================================

  /**
   * 列出治理票据
   * @param limit 查询数量限制
   * @param startId 起始票据ID
   */
  public listTickets(limit?: number, startId?: string): Promise<any[]> {
    const params: any[] = [];
    if (limit !== undefined) params.push(limit);
    if (startId !== undefined) params.push(startId);
    return this.execDb('list_tickets', params);
  }

  /**
   * 根据账户获取治理票据
   * @param accountNameOrId 账户名或ID
   * @param limit 查询数量限制
   * @param startId 起始票据ID
   */
  public getTicketsByAccount(
    accountNameOrId: string,
    limit?: number,
    startId?: string,
  ): Promise<any[]> {
    const params: any[] = [accountNameOrId];
    if (limit !== undefined) params.push(limit);
    if (startId !== undefined) params.push(startId);
    return this.execDb('get_tickets_by_account', params);
  }

  // ============================================================
  // HTLC 相关接口
  // ============================================================

  /**
   * 获取 HTLC 对象
   * @param htlcId HTLC ID
   * @param subscribe 是否订阅
   */
  public getHtlc(htlcId: string, subscribe?: boolean): Promise<any> {
    const params: any[] = [htlcId];
    if (subscribe !== undefined) params.push(subscribe);
    return this.execDb('get_htlc', params);
  }

  /**
   * 根据发送者获取 HTLC
   * @param accountNameOrId 账户名或ID
   * @param start 起始 HTLC ID
   * @param limit 查询数量限制
   */
  public getHtlcByFrom(
    accountNameOrId: string,
    start: string,
    limit: number,
  ): Promise<any[]> {
    return this.execDb('get_htlc_by_from', [accountNameOrId, start, limit]);
  }

  /**
   * 根据接收者获取 HTLC
   * @param accountNameOrId 账户名或ID
   * @param start 起始 HTLC ID
   * @param limit 查询数量限制
   */
  public getHtlcByTo(
    accountNameOrId: string,
    start: string,
    limit: number,
  ): Promise<any[]> {
    return this.execDb('get_htlc_by_to', [accountNameOrId, start, limit]);
  }

  // ============================================================
  // 手续费/交易验证相关接口
  // ============================================================

  /**
   * 获取所需手续费
   * @param ops 操作数组
   * @param assetId 支付手续费的资产ID
   */
  public getRequiredFees(ops: any[], assetId: string): Promise<any[]> {
    return this.execDb('get_required_fees', [ops, assetId]);
  }

  /**
   * 获取交易的十六进制表示
   * @param transaction 交易对象
   */
  public getTransactionHex(transaction: any): Promise<string> {
    return this.execDb('get_transaction_hex', [transaction]);
  }

  /**
   * 验证权限
   * @param transaction 交易对象
   */
  public verifyAuthority(transaction: any): Promise<boolean> {
    return this.execDb('verify_authority', [transaction]);
  }

  /**
   * 验证账户权限
   * @param accountNameOrId 账户名或ID
   * @param signers 签名者公钥数组
   */
  public verifyAccountAuthority(
    accountNameOrId: string,
    signers: string[],
  ): Promise<boolean> {
    return this.execDb('verify_account_authority', [accountNameOrId, signers]);
  }

  // ============================================================
  // History API 接口封装
  // ============================================================

  /**
   * 获取账户历史（按操作类型筛选）
   * @param accountNameOrId 账户名或ID
   * @param operationTypes 操作类型数组（空数组表示所有类型）
   * @param start 起始序号
   * @param limit 查询数量限制
   */
  public getAccountHistoryByOperations(
    accountNameOrId: string,
    operationTypes: number[],
    start: number,
    limit: number,
  ): Promise<any> {
    return this.execHistory('get_account_history_by_operations', [
      accountNameOrId,
      operationTypes,
      start,
      limit,
    ]);
  }

  /**
   * 获取成交历史
   * @param baseId 基础资产ID
   * @param quoteId 报价资产ID
   * @param limit 查询数量限制
   */
  public getFillOrderHistory(
    baseId: string,
    quoteId: string,
    limit: number,
  ): Promise<any[]> {
    return this.execHistory('get_fill_order_history', [baseId, quoteId, limit]);
  }

  /**
   * 查询并解析成交历史记录
   * 
   * 术语说明：
   * - base 资产：交易资产（如 TLM），是被交易的商品
   * - quote 资产：报价资产（如 USDC），是用来计价的货币
   * - 价格 = quote / base，即用多少 quote 换取一个 base
   * 
   * @param tradingPair 交易对信息
   * @param limit 查询数量
   * @returns 解析后的成交记录数组
   */
  public async queryFillOrderHistory(
    tradingPair: {
      baseId: string;
      quoteId: string;
      basePrecision: number;
      quotePrecision: number;
    },
    limit: number,
  ): Promise<
    Array<{
      time: string;
      isSell: boolean;
      isCall: boolean;
      price: number;
      amount: number;
    }>
  > {
    const { baseId, quoteId, basePrecision, quotePrecision } = tradingPair;
    const basePrecisionPow = Math.pow(10, basePrecision);
    const quotePrecisionPow = Math.pow(10, quotePrecision);

    // 查询原始数据，乘以2是因为每笔交易有买卖双方
    const dataArray = await this.getFillOrderHistory(
      baseId,
      quoteId,
      limit * 2,
    );

    const fillOrders: Array<{
      time: string;
      isSell: boolean;
      isCall: boolean;
      price: number;
      amount: number;
    }> = [];

    for (const fillOrder of dataArray) {
      const op = fillOrder.op;

      // 筛选 taker（吃单），maker 跳过
      if (op.is_maker) {
        continue;
      }

      const time = fillOrder.time;
      const pays = op.pays;
      const receives = op.receives;
      const orderId = op.order_id;

      // 是否是爆仓单（call_order 类型为 8）
      const orderTypeId = parseInt(orderId.split('.')[1], 10);
      const isCall = orderTypeId === 8;

      let isSell: boolean;
      let price: number;
      let amount: number;

      // 获取价格对象（部分老节点可能不存在）
      const fillPrice = op.fill_price;

      // 判断交易方向：
      // - 支付 base 资产 = 卖出（卖出 base 换取 quote）
      // - 支付 quote 资产 = 买入（支付 quote 买入 base）
      if (pays.asset_id === baseId) {
        // 卖出：支付 base 资产，获得 quote 资产
        isSell = true;

        // 卖出的 base 数量
        const sellAmount = parseInt(pays.amount, 10);

        // 过滤数量为 0 的数据
        if (sellAmount === 0) {
          continue;
        }

        amount = sellAmount / basePrecisionPow;

        if (fillPrice) {
          // 使用 fill_price 计算价格
          price = this.calcPriceFromPriceObject(
            fillPrice,
            baseId,
            basePrecision,
            quotePrecision,
          );
        } else {
          // 通过收益计算价格：price = 获得的 quote / 卖出的 base
          const gainAmount = parseInt(receives.amount, 10);
          const gainReal = gainAmount / quotePrecisionPow;
          price = gainReal / amount;
        }
      } else {
        // 买入：支付 quote 资产，获得 base 资产
        isSell = false;

        // 买入的 base 数量
        const buyAmount = parseInt(receives.amount, 10);

        // 过滤数量为 0 的数据
        if (buyAmount === 0) {
          continue;
        }

        amount = buyAmount / basePrecisionPow;

        if (fillPrice) {
          // 使用 fill_price 计算价格
          price = this.calcPriceFromPriceObject(
            fillPrice,
            baseId,
            basePrecision,
            quotePrecision,
          );
        } else {
          // 通过成本计算价格：price = 支付的 quote / 买入的 base
          const costAmount = parseInt(pays.amount, 10);
          const costReal = costAmount / quotePrecisionPow;
          price = costReal / amount;
        }
      }

      fillOrders.push({
        time,
        isSell,
        isCall,
        price,
        amount,
      });

      // 达到限制数量则停止
      if (fillOrders.length >= limit) {
        break;
      }
    }

    return fillOrders;
  }

  /**
   * 从价格对象计算价格
   * 
   * 价格定义：price = quote_amount / base_amount
   * 即用多少 quote 资产换取一个 base 资产
   * 
   * @param priceObject 价格对象（包含 base 和 quote）
   * @param baseId 交易资产 ID
   * @param basePrecision 交易资产精度
   * @param quotePrecision 报价资产精度
   * @returns 价格
   */
  private calcPriceFromPriceObject(
    priceObject: {
      base: { amount: string; asset_id: string };
      quote: { amount: string; asset_id: string };
    },
    baseId: string,
    basePrecision: number,
    quotePrecision: number,
  ): number {
    const priceBase = priceObject.base;
    const priceQuote = priceObject.quote;

    const priceBaseAmount = parseInt(priceBase.amount, 10);
    const priceQuoteAmount = parseInt(priceQuote.amount, 10);

    // 判断 priceObject.base 对应的是哪个资产
    if (priceBase.asset_id === baseId) {
      // priceObject.base 是交易资产（base），priceObject.quote 是报价资产（quote）
      // price = quote / base
      const baseReal = priceBaseAmount / Math.pow(10, basePrecision);
      const quoteReal = priceQuoteAmount / Math.pow(10, quotePrecision);
      return quoteReal / baseReal;
    } else {
      // priceObject.base 是报价资产（quote），priceObject.quote 是交易资产（base）
      // price = base(实际是quote) / quote(实际是base)
      const quoteReal = priceBaseAmount / Math.pow(10, quotePrecision);
      const baseReal = priceQuoteAmount / Math.pow(10, basePrecision);
      return quoteReal / baseReal;
    }
  }

  /**
   * 获取市场历史（K线数据）
   * @param baseId 基础资产ID
   * @param quoteId 报价资产ID
   * @param bucketSeconds 时间间隔（秒）
   * @param start 开始时间（ISO格式）
   * @param end 结束时间（ISO格式）
   */
  public getMarketHistory(
    baseId: string,
    quoteId: string,
    bucketSeconds: number,
    start: string,
    end: string,
  ): Promise<any[]> {
    return this.execHistory('get_market_history', [
      baseId,
      quoteId,
      bucketSeconds,
      start,
      end,
    ]);
  }

  /**
   * 获取市场历史时间桶（支持的K线周期）
   */
  public getMarketHistoryBuckets(): Promise<number[]> {
    return this.execHistory('get_market_history_buckets');
  }

  // ============================================================
  // Custom Operations API 接口封装（需要节点支持）
  // ============================================================

  /**
   * 获取账户链上存储信息
   * @param accountNameOrId 账户名或ID（null 或空字符串查询所有账户）
   * @param catalog 存储目录
   */
  public async getStorageInfo(
    accountNameOrId: string | null,
    catalog: string,
  ): Promise<any[]> {
    await this.ensureConnected();
    const params: any[] = [accountNameOrId || null, catalog];
    if (!this.storageApiUnavailable) {
      try {
        return await this.execCustomOperations('get_storage_info', params);
      } catch (error) {
        if (!isStorageApiUnavailable(error)) throw error;
        this.storageApiUnavailable = true;
      }
    }
    // api.defishares.org has no public custom_operations API. Use a separate
    // public read connection and verify its chain ID before requesting storage.
    const expectedChainId = Apis.instance().chain_id;
    try {
      const rows = await readStorageFromNode(
        'wss://api-01.defishares.org/ws/',
        expectedChainId,
        accountNameOrId || null,
        catalog,
      );
      if (Apis.instance().chain_id !== expectedChainId)
        throw new Error('网络已切换，请重新读取公告');
      return rows;
    } catch (error) {
      throw new Error(
        `无法读取公告存储：${
          error instanceof Error ? error.message : '请稍后重试'
        }`,
      );
    }
  }

  /**
   * 账户链上存储操作（添加/删除）
   * 
   * @param params 存储操作参数
   * @param params.accountId 账户 ID
   * @param params.remove 是否删除操作
   * @param params.catalog 存储目录
   * @param params.keyValues 键值对数组 [[key, value], ...]，删除时 value 为空字符串
   * @param params.feeAssetId 手续费资产 ID（默认核心资产）
   * @param privateKeyWif 私钥 WIF 格式
   * @returns 交易结果
   */
  public async accountStorageMap(
    params: AccountStorageUpdate,
    privateKeyWif: string,
  ): Promise<any> {
    await this.ensureConnected();

    const {
      accountId,
      remove,
      catalog,
      keyValues,
      feeAssetId = '1.3.0',
    } = params;

    const tr = new TransactionBuilder();

    tr.add_type_operation('custom', {
      fee: {
        amount: 0,
        asset_id: feeAssetId,
      },
      payer: accountId,
      required_auths: [accountId],
      id: 0,  // custom_operations plugin 使用 id=0
      data: serializeAccountStorageMap(remove, catalog, keyValues),
    });

    // 设置手续费
    await tr.set_required_fees();

    // 签名
    const pKey = PrivateKey.fromWif(privateKeyWif);
    tr.add_signer(pKey, pKey.toPublicKey().toPublicKeyString());

    // 广播
    const result = await tr.broadcast();
    if (!(await this.confirmAccountStorageMap(params)))
      throw new StorageConfirmationPendingError();
    console.log('[ChainService] accountStorageMap 操作成功:', result);
    return result;
  }

  /**
   * 序列化 account_storage_map 操作数据
   * 格式参考 BitShares custom_operations plugin
   */
  public confirmAccountStorageMap(
    params: AccountStorageUpdate,
  ): Promise<boolean> {
    return confirmStorageWrite(
      () => this.getStorageInfo(params.accountId, params.catalog),
      params.keyValues,
      params.remove,
    );
  }

  // ============================================================
  // 便捷方法 - 组合查询
  // ============================================================

  /**
   * 查询单个完整账户信息
   * @param accountNameOrId 账户名或ID
   */
  public async queryFullAccountInfo(
    accountNameOrId: string,
  ): Promise<FullAccountData | null> {
    try {
      const result = await this.getFullAccounts([accountNameOrId], false);
      if (result && result.length > 0 && result[0][1]) {
        return result[0][1];
      }
      return null;
    } catch (error) {
      console.log('[ChainService] 查询完整账户信息失败:', error);
      return null;
    }
  }

  /**
   * 检查账户是否存在
   * @param accountName 账户名称
   */
  public async isAccountExist(accountName: string): Promise<boolean> {
    try {
      const account = await this.getAccountByName(accountName);
      return account !== null && account.id !== undefined;
    } catch (error) {
      return false;
    }
  }

  /**
   * 根据资产符号获取资产信息
   * @param symbols 资产符号数组
   * @param useCache 是否使用缓存（默认 true）
   */
  public async queryAssetsBySymbols(
    symbols: string[],
    useCache: boolean = true,
  ): Promise<Map<string, AssetObject>> {
    const result = new Map<string, AssetObject>();

    if (symbols.length === 0) {
      return result;
    }

    try {
      let symbolsToQuery = symbols;

      // 1. 如果使用缓存，先从缓存获取
      if (useCache) {
        // 获取缓存中已有且未过期的资产
        const cachedAssets = localCacheManager.getAssetsBySymbols(symbols);
        cachedAssets.forEach(asset => {
          result.set(asset.symbol, asset);
        });

        // 计算缺失的 symbols
        symbolsToQuery = localCacheManager.getMissingSymbols(symbols);

        if (symbolsToQuery.length === 0) {
          console.log(`[ChainService] 全部 ${symbols.length} 个资产从缓存获取`);
          return result;
        }

        console.log(
          `[ChainService] 缓存命中 ${cachedAssets.length} 个，需查询 ${symbolsToQuery.length} 个`,
        );
      }

      // 2. 查询链上数据
      const assets = await this.lookupAssetSymbols(symbolsToQuery);
      const queriedAssets: AssetObject[] = [];

      for (const asset of assets) {
        if (asset) {
          result.set(asset.symbol, asset);
          queriedAssets.push(asset);
        }
      }

      // 3. 存入缓存
      if (useCache && queriedAssets.length > 0) {
        localCacheManager.saveAssets(queriedAssets);
      }
    } catch (error) {
      console.error('[ChainService] 查询资产信息失败:', error);
    }

    return result;
  }

  /**
   * 批量获取行情 Ticker 数据
   * @param pairs 交易对数组，每项包含 {base: string, quote: string}
   */
  public async queryTickers(
    pairs: Array<{ base: string; quote: string }>,
  ): Promise<Map<string, TickerData>> {
    const result = new Map<string, TickerData>();

    // 一笔交易对的查询失败不应阻断其他交易对的实时行情更新。
    const tickers = await Promise.allSettled(
      pairs.map(pair => this.getTicker(pair.base, pair.quote)),
    );

    tickers.forEach((ticker, index) => {
      if (ticker.status !== 'fulfilled') {
        console.log(
          `[ChainService] 查询行情失败: ${pairs[index].base}/${pairs[index].quote}`,
          ticker.reason,
        );
        return;
      }

      const pair = pairs[index];
      result.set(
        `${pair.base}_${pair.quote}`,
        normalizeMarketTicker(ticker.value),
      );
    });

    return result;
  }

  /**
   * 查询活跃见证人列表
   */
  public async queryActiveWitnesses(): Promise<any[]> {
    try {
      const globalProps = await this.getGlobalProperties();
      const witnessIds = globalProps.active_witnesses;
      return await this.getWitnesses(witnessIds);
    } catch (error) {
      console.error('[ChainService] 查询活跃见证人失败:', error);
      return [];
    }
  }

  /**
   * 查询活跃理事会成员列表
   */
  public async queryActiveCommitteeMembers(): Promise<any[]> {
    try {
      const globalProps = await this.getGlobalProperties();
      const memberIds = globalProps.active_committee_members;
      return await this.getCommitteeMembers(memberIds);
    } catch (error) {
      console.error('[ChainService] 查询活跃理事会成员失败:', error);
      return [];
    }
  }

  // ============================================================
  // 交易对和订单簿相关方法
  // ============================================================

  /**
   * 构建交易对信息
   * @param baseAsset 基础资产对象
   * @param quoteAsset 报价资产对象
   * @returns 交易对信息
   */
  public buildTradingPair(
    baseAsset: AssetObject,
    quoteAsset: AssetObject,
  ): TradingPair {
    return {
      baseId: baseAsset.id,
      baseSymbol: baseAsset.symbol,
      basePrecision: baseAsset.precision,
      basePrecisionPow: Math.pow(10, baseAsset.precision),
      quoteId: quoteAsset.id,
      quoteSymbol: quoteAsset.symbol,
      quotePrecision: quoteAsset.precision,
      quotePrecisionPow: Math.pow(10, quoteAsset.precision),
    };
  }

  /**
   * 根据资产符号构建交易对信息
   * @param baseSymbol 基础资产符号
   * @param quoteSymbol 报价资产符号
   * @returns 交易对信息，如果资产不存在则返回 null
   */
  public async buildTradingPairBySymbols(
    baseSymbol: string,
    quoteSymbol: string,
  ): Promise<TradingPair | null> {
    try {
      const assets = await this.lookupAssetSymbols([baseSymbol, quoteSymbol]);
      if (!assets || assets.length < 2 || !assets[0] || !assets[1]) {
        console.error(
          `[ChainService] 资产不存在: ${baseSymbol} 或 ${quoteSymbol}`,
        );
        return null;
      }
      return this.buildTradingPair(assets[0], assets[1]);
    } catch (error) {
      console.log('[ChainService] 构建交易对失败:', error);
      return null;
    }
  }

  /**
   * 查询限价单并解析为订单簿数据
   * 参考 Kotlin 的 queryLimitOrders 方法实现
   * 
   * 注意：在 BitShares 中，交易对 HBW/USDT 的显示习惯是：
   * - baseAsset = HBW（交易标的）
   * - quoteAsset = USDT（计价货币）
   * - 价格表示 1 HBW = X USDT
   * 
   * 但在 Kotlin 原始代码中 _baseId 指的是计价货币，所以这里需要交换使用
   * 
   * @param tradingPair 交易对信息
   * @param limit 查询数量限制
   * @returns 订单簿数据（买单和卖单列表）
   */
  public async queryLimitOrders(
    tradingPair: TradingPair,
    limit: number = 100,
  ): Promise<OrderBookData> {
    try {
      // 调用底层 API 获取限价单
      // 注意：API 参数顺序是 (base, quote)，这里 base 是计价货币，quote 是交易标的
      // 所以需要交换 quoteId 和 baseId 的位置
      const limitOrders = await this.getLimitOrders(
        tradingPair.quoteId,
        tradingPair.baseId,
        limit,
      );

      const bids: OrderBookItem[] = [];
      const asks: OrderBookItem[] = [];

      let bidAmountSum = 0;
      let askAmountSum = 0;

      for (const limitOrder of limitOrders) {
        const oid = limitOrder.id;
        const sellPrice = limitOrder.sell_price;
        const base = sellPrice.base;
        const quote = sellPrice.quote;

        // 判断订单方向：
        // 如果订单的 sell_price.base 等于计价货币（quoteId，如 USDT），则为买单
        // 例如：HBW/USDT 市场，卖出 USDT 即买入 HBW
        if (base.asset_id === tradingPair.quoteId) {
          // 买单 (Bid): 单价 price = 总花费（计价货币）/ 总数量（交易标的）
          const valueQuote =
            Number(base.amount) / tradingPair.quotePrecisionPow; // 计价货币金额
          const valueBase = Number(quote.amount) / tradingPair.basePrecisionPow;   // 交易标的数量
          const price = valueQuote / valueBase;  // 价格 = USDT / HBW

          // for_sale 是卖出的计价货币数量（如 USDT）
          const quoteAmount =
            Number(limitOrder.for_sale) / tradingPair.quotePrecisionPow;
          // 买入的交易标的数量 = 花费 / 单价
          const baseAmount = quoteAmount / price;

          // 累积
          bidAmountSum += baseAmount;

          bids.push({
            oid,
            price,
            quote: quoteAmount,   // 花费的计价货币（USDT）
            base: baseAmount,     // 买入的交易标的（HBW）
            sum: bidAmountSum,
          });
        } else {
          // 卖单 (Ask): 订单的 sell_price.base 等于交易标的（baseId，如 HBW）
          // 例如：HBW/USDT 市场，卖出 HBW
          const valueBase = Number(base.amount) / tradingPair.basePrecisionPow;    // 交易标的数量
          const valueQuote =
            Number(quote.amount) / tradingPair.quotePrecisionPow; // 计价货币金额
          const price = valueQuote / valueBase;  // 价格 = USDT / HBW

          // for_sale 是卖出的交易标的数量（如 HBW）
          const baseAmount =
            Number(limitOrder.for_sale) / tradingPair.basePrecisionPow;
          // 收到的计价货币数量 = 数量 * 单价
          const quoteAmount = baseAmount * price;

          // 累积
          askAmountSum += baseAmount;

          asks.push({
            oid,
            price,
            quote: quoteAmount,   // 收到的计价货币（USDT）
            base: baseAmount,     // 卖出的交易标的（HBW）
            sum: askAmountSum,
          });
        }
      }

      return { bids, asks };
    } catch (error) {
      console.error('[ChainService] 查询限价单失败:', error);
      return { bids: [], asks: [] };
    }
  }

  /**
   * 根据资产符号查询订单簿
   * 便捷方法，会自动构建交易对信息
   * 
   * @param baseSymbol 基础资产符号
   * @param quoteSymbol 报价资产符号
   * @param limit 查询数量限制
   * @returns 订单簿数据，如果资产不存在则返回空的订单簿
   */
  public async queryOrderBookBySymbols(
    baseSymbol: string,
    quoteSymbol: string,
    limit: number = 100,
  ): Promise<{
    orderBook: OrderBookData;
    tradingPair: TradingPair | null;
  }> {
    const tradingPair = await this.buildTradingPairBySymbols(
      baseSymbol,
      quoteSymbol,
    );
    if (!tradingPair) {
      return {
        orderBook: { bids: [], asks: [] },
        tradingPair: null,
      };
    }
    const orderBook = await this.queryLimitOrders(tradingPair, limit);
    return { orderBook, tradingPair };
  }

  // ============================================================
  // 交易构造和广播接口
  // ============================================================

  /**
   * 创建流动性池。金额使用链上资产 ID，避免在 UI 层耦合精度和序列化细节。
   */
  public async createLiquidityPool(
    params: {
      accountId: string;
      assetAId: string;
      assetBId: string;
      shareAssetId: string;
      takerFeePercent?: number;
      withdrawalFeePercent?: number;
      feeAssetId?: string;
    },
    privateKeyWif: string,
  ): Promise<any> {
    await this.ensureConnected();
    const tr = new TransactionBuilder();
    tr.add_type_operation('liquidity_pool_create', {
      fee: { amount: 0, asset_id: params.feeAssetId || '1.3.0' },
      account: params.accountId,
      asset_a: params.assetAId,
      asset_b: params.assetBId,
      share_asset: params.shareAssetId,
      taker_fee_percent: params.takerFeePercent || 0,
      withdrawal_fee_percent: params.withdrawalFeePercent || 0,
      extensions: [],
    });
    await tr.set_required_fees();
    const pKey = PrivateKey.fromWif(privateKeyWif);
    tr.add_signer(pKey, pKey.toPublicKey().toPublicKeyString());
    return tr.broadcast();
  }

  /** 向池子注入两种储备资产，amount 已按资产精度放大。 */
  public async depositLiquidity(
    params: {
      accountId: string;
      poolId: string;
      amountA: number | string;
      assetAId: string;
      amountB: number | string;
      assetBId: string;
      feeAssetId?: string;
    },
    privateKeyWif: string,
  ): Promise<any> {
    await this.ensureConnected();
    const tr = new TransactionBuilder();
    tr.add_type_operation('liquidity_pool_deposit', {
      fee: { amount: 0, asset_id: params.feeAssetId || '1.3.0' },
      account: params.accountId,
      pool: params.poolId,
      amount_a: { amount: String(params.amountA), asset_id: params.assetAId },
      amount_b: { amount: String(params.amountB), asset_id: params.assetBId },
      extensions: [],
    });
    await tr.set_required_fees();
    const pKey = PrivateKey.fromWif(privateKeyWif);
    tr.add_signer(pKey, pKey.toPublicKey().toPublicKeyString());
    return tr.broadcast();
  }

  /** 从池子提取 LP 份额，shareAmount 已按 LP 资产精度放大。 */
  public async withdrawLiquidity(
    params: {
      accountId: string;
      poolId: string;
      shareAmount: number | string;
      shareAssetId: string;
      feeAssetId?: string;
    },
    privateKeyWif: string,
  ): Promise<any> {
    await this.ensureConnected();
    const tr = new TransactionBuilder();
    tr.add_type_operation('liquidity_pool_withdraw', {
      fee: { amount: 0, asset_id: params.feeAssetId || '1.3.0' },
      account: params.accountId,
      pool: params.poolId,
      share_amount: {
        amount: String(params.shareAmount),
        asset_id: params.shareAssetId,
      },
      extensions: [],
    });
    await tr.set_required_fees();
    const pKey = PrivateKey.fromWif(privateKeyWif);
    tr.add_signer(pKey, pKey.toPublicKey().toPublicKeyString());
    return tr.broadcast();
  }

  /** 与池子兑换，amountToSell/minToReceive 均已按资产精度放大。 */
  public async exchangeLiquidity(
    params: {
      accountId: string;
      poolId: string;
      amountToSell: number | string;
      sellAssetId: string;
      minToReceive: number | string;
      receiveAssetId: string;
      feeAssetId?: string;
    },
    privateKeyWif: string,
  ): Promise<any> {
    await this.ensureConnected();
    const tr = new TransactionBuilder();
    tr.add_type_operation('liquidity_pool_exchange', {
      fee: { amount: 0, asset_id: params.feeAssetId || '1.3.0' },
      account: params.accountId,
      pool: params.poolId,
      amount_to_sell: {
        amount: String(params.amountToSell),
        asset_id: params.sellAssetId,
      },
      min_to_receive: {
        amount: String(params.minToReceive),
        asset_id: params.receiveAssetId,
      },
      extensions: [],
    });
    await tr.set_required_fees();
    const pKey = PrivateKey.fromWif(privateKeyWif);
    tr.add_signer(pKey, pKey.toPublicKey().toPublicKeyString());
    return tr.broadcast();
  }

  /**
   * 创建/调整抵押借贷仓位。
   *
   * DefiShares 借贷沿用 Graphene 的 call_order_update 操作：
   * - delta_collateral 为正数表示增加抵押，负数表示取回抵押；
   * - delta_debt 为正数表示借款，负数表示还款；
   * - 本应用层固定只允许 DFS 作为抵押资产，借款资产由调用方选择。
   */
  public async updateCallOrder(
    params: {
    accountId: string;
    collateralAssetId: string;
    collateralDelta: number | string;
    debtAssetId: string;
    debtDelta: number | string;
    feeAssetId?: string;
    },
    privateKeyWif: string,
  ): Promise<any> {
    await this.ensureConnected();

    const {
      accountId,
      collateralAssetId,
      collateralDelta,
      debtAssetId,
      debtDelta,
      feeAssetId = '1.3.0',
    } = params;

    if (String(collateralDelta) === '0' && String(debtDelta) === '0') {
      throw new Error('抵押或借款数量不能同时为 0');
    }

    // 在服务层再次校验抵押资产，避免绕过移动端 UI 传入其他资产。
    const collateralAsset = (await this.getAssets([collateralAssetId]))[0];
    if (!collateralAsset || collateralAsset.symbol !== 'DFS') {
      throw new Error('抵押资产必须为 DFS');
    }
    if (debtAssetId === collateralAssetId) {
      throw new Error('借款资产不能与抵押资产相同');
    }

    const tr = new TransactionBuilder();
    tr.add_type_operation('call_order_update', {
      fee: {
        amount: 0,
        asset_id: feeAssetId,
      },
      funding_account: accountId,
      delta_collateral: {
        amount: String(collateralDelta),
        asset_id: collateralAssetId,
      },
      delta_debt: {
        amount: String(debtDelta),
        asset_id: debtAssetId,
      },
      extensions: [],
    });

    await tr.set_required_fees();

    const pKey = PrivateKey.fromWif(privateKeyWif);
    tr.add_signer(pKey, pKey.toPublicKey().toPublicKeyString());

    const result = await tr.broadcast();
    console.log('[ChainService] 抵押借贷仓位更新成功:', result);
    return result;
  }

  /**
   * 创建限价单
   * 
   * @param params 限价单参数
   * @param params.accountId 下单账户 ID
   * @param params.sellAssetId 卖出资产 ID
   * @param params.sellAmount 卖出数量（已乘精度的整数）
   * @param params.buyAssetId 买入资产 ID
   * @param params.buyAmount 买入数量（已乘精度的整数）
   * @param params.expiration 过期时间（UTC 时间字符串，如 "2025-12-31T23:59:59"）
   * @param params.fillOrKill 是否 FOK 订单（市价单使用）
   * @param params.feeAssetId 手续费资产 ID（默认核心资产）
   * @param privateKeyWif 私钥 WIF 格式
   * @returns 交易结果
   */
  public async createLimitOrder(
    params: {
    accountId: string;
    sellAssetId: string;
    sellAmount: number | string;
    buyAssetId: string;
    buyAmount: number | string;
    expiration?: string;
    fillOrKill?: boolean;
    feeAssetId?: string;
    },
    privateKeyWif: string,
  ): Promise<any> {
    await this.ensureConnected();

    const {
      accountId,
      sellAssetId,
      sellAmount,
      buyAssetId,
      buyAmount,
      expiration,
      fillOrKill = false,
      feeAssetId = '1.3.0',
    } = params;

    // 默认过期时间为 1 年后
    const defaultExpiration = new Date();
    defaultExpiration.setFullYear(defaultExpiration.getFullYear() + 1);
    const expirationStr =
      expiration || defaultExpiration.toISOString().slice(0, 19);

    const tr = new TransactionBuilder();

    tr.add_type_operation('limit_order_create', {
      fee: {
        amount: 0,
        asset_id: feeAssetId,
      },
      seller: accountId,
      amount_to_sell: {
        amount: String(sellAmount),
        asset_id: sellAssetId,
      },
      min_to_receive: {
        amount: String(buyAmount),
        asset_id: buyAssetId,
      },
      expiration: expirationStr,
      fill_or_kill: fillOrKill,
    });

    // 设置手续费
    await tr.set_required_fees();

    // 签名
    const pKey = PrivateKey.fromWif(privateKeyWif);
    tr.add_signer(pKey, pKey.toPublicKey().toPublicKeyString());

    // 广播
    const result = await tr.broadcast();
    console.log('[ChainService] 限价单创建成功:', result);
    return result;
  }

  /**
   * 取消限价单（支持批量撤单）
   * 
   * @param params 取消订单参数
   * @param params.accountId 账户 ID
   * @param params.orderIds 订单 ID 数组（如 ["1.7.xxx", "1.7.yyy"]）
   * @param params.feeAssetId 手续费资产 ID（默认核心资产）
   * @param privateKeyWif 私钥 WIF 格式
   * @returns 交易结果
   */
  public async cancelLimitOrder(
    params: {
    accountId: string;
    orderIds: string | string[];
    feeAssetId?: string;
    },
    privateKeyWif: string,
  ): Promise<any> {
    await this.ensureConnected();

    const { accountId, orderIds, feeAssetId = '1.3.0' } = params;

    // 支持单个订单 ID 或数组
    const orderIdArray = Array.isArray(orderIds) ? orderIds : [orderIds];

    if (orderIdArray.length === 0) {
      throw new Error('订单 ID 列表不能为空');
    }

    const tr = new TransactionBuilder();

    // 添加多个撤单操作
    for (const orderId of orderIdArray) {
      tr.add_type_operation('limit_order_cancel', {
        fee: {
          amount: 0,
          asset_id: feeAssetId,
        },
        fee_paying_account: accountId,
        order: orderId,
      });
    }

    // 设置手续费
    await tr.set_required_fees();

    // 签名
    const pKey = PrivateKey.fromWif(privateKeyWif);
    tr.add_signer(pKey, pKey.toPublicKey().toPublicKeyString());

    // 广播
    const result = await tr.broadcast();
    console.log(
      `[ChainService] 批量取消 ${orderIdArray.length} 个限价单成功:`,
      result,
    );
    return result;
  }

  /**
   * 链上转账（支持加密备注）
   * 
   * @param params 转账参数
   * @param params.fromAccountId 发送账户 ID
   * @param params.toAccountId 接收账户 ID
   * @param params.assetId 资产 ID
   * @param params.amount 转账数量（已乘精度的整数）
   * @param params.memo 备注（可选，如果提供则必须加密）
   * @param params.toMemoKey 接收方 memo 公钥（有备注时必填）
   * @param params.feeAssetId 手续费资产 ID（默认核心资产）
   * @param activePrivateKey active 私钥 WIF 格式（用于签名）
   * @param memoPrivateKey memo 私钥 WIF 格式（用于 memo 加密，可选，默认使用 activePrivateKey）
   * @returns 交易结果
   */
  public async transfer(
    params: {
    fromAccountId: string;
    toAccountId: string;
    assetId: string;
    amount: number | string;
    memo?: string;
    toMemoKey?: string;
    feeAssetId?: string;
    },
    activePrivateKey: string,
    memoPrivateKey?: string,
  ): Promise<any> {
    await this.ensureConnected();
    // Transfer can be called after a cold start, where LoginScreen has not
    // set the prefix. Memo public keys on DFS always use the DFS prefix.
    ChainConfig.setPrefix(DEFI_SHARES_ADDRESS_PREFIX);

    const {
      fromAccountId,
      toAccountId,
      assetId,
      amount,
      memo,
      toMemoKey,
      feeAssetId = '1.3.0',
    } = params;

    const tr = new TransactionBuilder();

    const operation: any = {
      fee: {
        amount: 0,
        asset_id: feeAssetId,
      },
      from: fromAccountId,
      to: toAccountId,
      amount: {
        amount: String(amount),
        asset_id: assetId,
      },
    };

    // 处理备注（备注必须加密，不支持明文备注）
    if (memo && memo.trim()) {
      if (!toMemoKey) {
        throw new Error('备注加密失败：缺少接收方公钥信息');
      }

      try {
        // 使用 memoPrivateKey 进行 memo 加密（如果未提供则使用 activePrivateKey）
        const memoKeyWif = memoPrivateKey || activePrivateKey;
        const memoPrivKey = PrivateKey.fromWif(memoKeyWif);

        // 从 memoPrivateKey 计算 fromMemoKey（公钥）
        const fromMemoKey = memoPrivKey.toPublicKey().toPublicKeyString();

        // 生成唯一 nonce
        const nonce = TransactionHelper.unique_nonce_uint64();

        // 将 memo 转换为 Buffer（UTF-8 编码），确保中文等多字节字符正确处理
        const memoBuffer = Buffer.from(memo, 'utf-8');

        // 加密备注
        const encryptedMessage = Aes.encrypt_with_checksum(
          memoPrivKey,
          toMemoKey,
          nonce,
          memoBuffer,
        );

        operation.memo = {
          from: fromMemoKey,
          to: toMemoKey,
          nonce,
          message: encryptedMessage,
        };

        console.log('[ChainService] 备注已加密, fromMemoKey:', fromMemoKey);
      } catch (error: any) {
        console.error('[ChainService] 备注加密失败:', error);
        throw new Error(
          `备注加密失败：${error.message || '请检查密钥是否正确'}`,
        );
      }
    }

    tr.add_type_operation('transfer', operation);

    // 设置手续费
    await tr.set_required_fees();

    // 签名（使用 activePrivateKey）
    const pKey = PrivateKey.fromWif(activePrivateKey);
    tr.add_signer(pKey, pKey.toPublicKey().toPublicKeyString());

    // 广播
    const result = await tr.broadcast();
    console.log('[ChainService] 转账成功:', result);
    return result;
  }

  /**
   * 便捷方法：创建买单
   * 买入 base 资产，卖出 quote 资产
   * 
   * @param params 买单参数
   * @param params.accountId 账户 ID
   * @param params.tradingPair 交易对信息
   * @param params.price 价格（quote/base，如 1 ETH = 3000 USDT，则 price = 3000）
   * @param params.amount 买入数量（base 资产的实际数量，如 0.1 ETH）
   * @param params.isMarketOrder 是否市价单（会设置 FOK）
   * @param params.feeAssetId 手续费资产 ID
   * @param privateKeyWif 私钥 WIF 格式
   */
  public async createBuyOrder(
    params: {
    accountId: string;
    tradingPair: TradingPair;
    price: number;
    amount: number;
    isMarketOrder?: boolean;
    feeAssetId?: string;
    },
    privateKeyWif: string,
  ): Promise<any> {
    const {
      accountId,
      tradingPair,
      price,
      amount,
      isMarketOrder = false,
      feeAssetId,
    } = params;

    // 买入：卖出 quote 资产，买入 base 资产
    // sellAmount = amount * price（需要花费的 quote 数量）
    // buyAmount = amount（要买入的 base 数量）
    const sellAmount = Math.round(
      amount * price * tradingPair.quotePrecisionPow,
    );
    const buyAmount = Math.round(amount * tradingPair.basePrecisionPow);

    return this.createLimitOrder(
      {
      accountId,
      sellAssetId: tradingPair.quoteId,
      sellAmount,
      buyAssetId: tradingPair.baseId,
      buyAmount,
      fillOrKill: isMarketOrder,
      feeAssetId,
      },
      privateKeyWif,
    );
  }

  /**
   * 便捷方法：创建卖单
   * 卖出 base 资产，买入 quote 资产
   * 
   * @param params 卖单参数
   * @param params.accountId 账户 ID
   * @param params.tradingPair 交易对信息
   * @param params.price 价格（quote/base，如 1 ETH = 3000 USDT，则 price = 3000）
   * @param params.amount 卖出数量（base 资产的实际数量，如 0.1 ETH）
   * @param params.isMarketOrder 是否市价单（会设置 FOK）
   * @param params.feeAssetId 手续费资产 ID
   * @param privateKeyWif 私钥 WIF 格式
   */
  public async createSellOrder(
    params: {
    accountId: string;
    tradingPair: TradingPair;
    price: number;
    amount: number;
    isMarketOrder?: boolean;
    feeAssetId?: string;
    },
    privateKeyWif: string,
  ): Promise<any> {
    const {
      accountId,
      tradingPair,
      price,
      amount,
      isMarketOrder = false,
      feeAssetId,
    } = params;

    // 卖出：卖出 base 资产，买入 quote 资产
    // sellAmount = amount（要卖出的 base 数量）
    // buyAmount = amount * price（期望收到的 quote 数量）
    const sellAmount = Math.round(amount * tradingPair.basePrecisionPow);
    const buyAmount = Math.round(
      amount * price * tradingPair.quotePrecisionPow,
    );

    return this.createLimitOrder(
      {
      accountId,
      sellAssetId: tradingPair.baseId,
      sellAmount,
      buyAssetId: tradingPair.quoteId,
      buyAmount,
      fillOrKill: isMarketOrder,
      feeAssetId,
      },
      privateKeyWif,
    );
  }
}

// ============================================================
// 区块链错误信息格式化
// ============================================================

/**
 * 石墨烯区块链错误消息映射表
 */
const GRAPHENE_ERROR_MESSAGES: Record<string, string> = {
  // 账户相关
  'no such account': '账号不存在。',

  // 余额相关
  'insufficient balance': '手续费不足。',

  // HTLC 相关
  'preimage size': '原像不正确。',
  'provided preimage': '原像不正确。',

  // API/节点相关
  'no method with': '当前API节点版本太低。',
  hardfork: '该功能尚未激活，请等待硬分叉升级完毕后再尝试。',

  // 交易相关
  'now <= trx.expiration': '交易已过期。',
  'duplicate transaction': '该交易已存在，不用重复广播。',

  // 签名/权限相关
  'missing required active authority': '签名无效。',
  'missing required owner authority': '签名无效。',
  'missing required other authority': '签名无效。',

  // 资产供应量相关
  'borrowing this quantity would exceed max_supply':
    '超过资产最大供应量，交易失败。',

  // 手续费池相关
  'fee pool balance': '手续费资产对应的手续费池余额不足。',

  // 流动性池相关
  'unable to exchange at expected price':
    '兑换数量过小或流动性池价格已变化，请提高兑换金额或降低最小获得数量后重试。',
  'aborting due to zero outcome':
    '流动性代币达到最大供应量或者预计获得数量为零。',

  // 对象相关
  'unable to find object': '操作失败，目标已经被删除了。',

  // 资产相关
  'non-empty pool': '流动性池非空，无法删除。',
  'is backed by this asset, can not update precision':
    '该资产已经被其他资产用作抵押资产，不可修改资产精度。',

  // 抵押相关
  'initial collateral ratio (icr)': '抵押率不能低于初始抵押率。',

  // 隐私交易相关
  'fc::ecc::verify_sum': '隐私输入和输出金额不相等。',
};

/**
 * 格式化区块链错误信息
 * 将原始的区块链错误转换为用户友好的中文提示
 * 
 * @param error 原始错误对象
 * @returns 格式化后的错误消息
 */
export function formatGrapheneError(error: any): string {
  // 默认错误消息
  const defaultMessage = '网络请求失败，请稍后重试';

  if (!error) {
    return defaultMessage;
  }

  // 如果是字符串，直接处理
  if (typeof error === 'string') {
    return matchErrorMessage(error) || error || defaultMessage;
  }

  try {
    // 尝试解析错误对象
    let errorData: any = error;

    // 如果错误有 message 属性且是 JSON 字符串，尝试解析
    if (error.message) {
      try {
        errorData = JSON.parse(error.message);
      } catch {
        // 如果解析失败，直接使用 message
        return (
          matchErrorMessage(error.message) || error.message || defaultMessage
        );
      }
    }

    // 提取原始消息
    let rawMessage = '';
    if (typeof errorData === 'object') {
      rawMessage = errorData.message || '';

      // 尝试从 data.stack 中获取更详细的错误信息
      const stack = errorData.data?.stack;
      if (Array.isArray(stack) && stack.length > 0) {
        const format = stack[0]?.format;
        if (format) {
          rawMessage = rawMessage ? `${rawMessage} : ${format}` : format;
        }

        // 特殊处理隐私收据错误
        if (rawMessage.toLowerCase().includes('itr != cidx.end()')) {
          const file = stack[0]?.context?.file;
          if (file && file.includes('confidential')) {
            return '隐私收据不存在。';
          }
        }
      }
    } else if (typeof errorData === 'string') {
      rawMessage = errorData;
    }

    // 匹配特定错误消息
    const matchedMessage = matchErrorMessage(rawMessage);
    if (matchedMessage) {
      return matchedMessage;
    }

    // 如果有原始消息，返回原始消息
    if (rawMessage) {
      return rawMessage;
    }
  } catch (e) {
    console.warn('[ChainService] 解析错误信息失败:', e);
  }

  return defaultMessage;
}

/**
 * 匹配错误消息
 * @param message 原始错误消息
 * @returns 匹配到的友好消息，如果没有匹配返回 null
 */
function matchErrorMessage(message: string): string | null {
  if (!message) {
    return null;
  }

  const lowerMessage = message.toLowerCase();

  // 遍历错误消息映射表
  for (const [pattern, friendlyMessage] of Object.entries(
    GRAPHENE_ERROR_MESSAGES,
  )) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      return friendlyMessage;
    }
  }

  return null;
}

// 导出单例实例
export const chainServiceMgr = ChainServiceManager.getInstance();
export default chainServiceMgr;
