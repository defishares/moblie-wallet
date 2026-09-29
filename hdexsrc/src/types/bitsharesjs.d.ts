/**
 * BitShares JS 库类型声明
 * 参考：https://github.com/bitshares/bitsharesjs-ws/blob/develop/src/ApiInstances.js
 */

declare module 'bitsharesjs-ws' {
  /**
   * GrapheneApi 实例接口
   * 用于执行 RPC API 调用
   */
  export interface GrapheneApi {
    /**
     * 初始化 API
     */
    init(): Promise<void>;

    /**
     * 执行 API 调用
     * @param method API 方法名
     * @param params 参数数组
     */
    exec<T = any>(method: string, params?: any[]): Promise<T>;
  }

  /**
   * Apis 实例接口
   */
  export interface ApisInstance {
    /**
     * 初始化 Promise，连接完成后 resolve
     */
    init_promise: Promise<any[]>;

    /**
     * 当前链 ID
     */
    chain_id: string;

    /**
     * WebSocket 连接 URL
     */
    url: string;

    /**
     * 关闭连接
     */
    close(): Promise<void>;

    /**
     * 连接到节点
     * @param cs WebSocket URL
     * @param connectTimeout 连接超时时间
     * @param optionalApis 可选 API 配置
     * @param closeCb 关闭回调
     */
    connect(
      cs: string,
      connectTimeout?: number,
      optionalApis?: ApiOptions,
      closeCb?: () => void
    ): void;

    /**
     * 获取 Database API
     */
    db_api(): GrapheneApi;

    /**
     * 获取 Network Broadcast API
     */
    network_api(): GrapheneApi;

    /**
     * 获取 History API
     */
    history_api(): GrapheneApi;

    /**
     * 获取 Crypto API (需要 enableCrypto: true)
     */
    crypto_api(): GrapheneApi | undefined;

    /**
     * 获取 Orders API (需要 enableOrders: true)
     */
    orders_api(): GrapheneApi | undefined;

    /**
     * 获取 Custom Operations API (需要 enableCustomOperations: true)
     * 用于查询链上自定义存储数据等
     */
    custom_operations_api(): GrapheneApi | undefined;

    /**
     * 设置 RPC 连接状态回调
     */
    setRpcConnectionStatusCallback(callback: (status: string) => void): void;

    /**
     * 关闭回调
     */
    closeCb?: () => void;
  }

  /**
   * 可选 API 配置
   */
  export interface ApiOptions {
    /**
     * 启用 Crypto API
     */
    enableCrypto?: boolean;

    /**
     * 启用 Orders API
     */
    enableOrders?: boolean;

    /**
     * 启用 Custom Operations API
     */
    enableCustomOperations?: boolean;
  }

  /**
   * Apis 模块
   */
  export const Apis: {
    /**
     * 获取或创建 Apis 实例
     * @param ws WebSocket URL
     * @param connect 是否立即连接
     * @param connectTimeout 连接超时时间（毫秒）
     * @param optionalApis 可选 API 配置
     * @param closeCb 关闭回调
     */
    instance(
      ws?: string,
      connect?: boolean,
      connectTimeout?: number,
      optionalApis?: ApiOptions,
      closeCb?: () => void
    ): ApisInstance;

    /**
     * 重置连接
     * @param ws WebSocket URL
     * @param connect 是否立即连接
     * @param connectTimeout 连接超时时间（毫秒）
     * @param optionalApis 可选 API 配置
     * @param closeCb 关闭回调
     */
    reset(
      ws?: string,
      connect?: boolean,
      connectTimeout?: number,
      optionalApis?: ApiOptions,
      closeCb?: () => void
    ): Promise<ApisInstance>;

    /**
     * 关闭连接
     */
    close(): Promise<void>;

    /**
     * 获取当前链 ID
     */
    chainId(): string;

    /**
     * 设置 RPC 连接状态回调
     */
    setRpcConnectionStatusCallback(callback: (status: string) => void): void;

    /**
     * 设置是否自动重连
     */
    setAutoReconnect(auto: boolean): void;
  };

  /**
   * Database API 快捷访问代理
   */
  export const db: {
    [method: string]: (...args: any[]) => Promise<any>;
  };

  /**
   * Network API 快捷访问代理
   */
  export const network: {
    [method: string]: (...args: any[]) => Promise<any>;
  };

  /**
   * History API 快捷访问代理
   */
  export const history: {
    [method: string]: (...args: any[]) => Promise<any>;
  };

  /**
   * Crypto API 快捷访问代理
   */
  export const crypto: {
    [method: string]: (...args: any[]) => Promise<any>;
  };

  /**
   * Orders API 快捷访问代理
   */
  export const orders: {
    [method: string]: (...args: any[]) => Promise<any>;
  };

  /**
   * ChainConfig 模块
   */
  export const ChainConfig: {
    setChainId(chainId: string): void;
    setPrefix(prefix: string): string;
    reset(): void;
    address_prefix: string;
    expire_in_secs: number;
    expire_in_secs_proposal: number;
  };
}

declare module 'bitsharesjs' {
  export const Serializer: any;
  export const types: any;
  /**
   * 哈希工具模块
   */
  export const hash: {
    /**
     * SHA256 哈希
     * @param data 输入数据（字符串或 Buffer）
     * @returns Buffer 格式的哈希值
     */
    sha256(data: string | Buffer): Buffer;

    /**
     * SHA512 哈希
     * @param data 输入数据（字符串或 Buffer）
     * @returns Buffer 格式的哈希值
     */
    sha512(data: string | Buffer): Buffer;

    /**
     * SHA1 哈希
     * @param data 输入数据（字符串或 Buffer）
     * @returns Buffer 格式的哈希值
     */
    sha1(data: string | Buffer): Buffer;

    /**
     * RIPEMD160 哈希
     * @param data 输入数据（字符串或 Buffer）
     * @returns Buffer 格式的哈希值
     */
    ripemd160(data: string | Buffer): Buffer;

    /**
     * HMAC-SHA256
     * @param data 输入数据
     * @param key 密钥
     * @returns Buffer 格式的 HMAC 值
     */
    HmacSHA256(data: string | Buffer, key: string | Buffer): Buffer;
  };

  export const ChainStore: {
    init(subscribe_to_new: boolean = true): Promise<void>;
    subscribe(callback: (object: any) => void): void;
    unsubscribe(callback: (object: any) => void): void;
    getObject(id: string): any;
    getAsset(idOrSymbol: string): any;
    getAccount(nameOrId: string): any;
  };

  export const PrivateKey: {
    fromSeed(seed: string): any;
    fromWif(wif: string): any;
  };

  export const PublicKey: {
    fromString(publicKey: string): any;
  };

  export const key: {
    normalize_brainKey(brainKey: string): string;
  };

  export const TransactionBuilder: new () => any;

  /**
   * AES 加密工具类
   * 用于 memo 加密
   */
  export const Aes: {
    /**
     * 使用 checksum 加密消息
     * @param privateKey 发送方私钥
     * @param publicKey 接收方公钥
     * @param nonce 随机数
     * @param message 要加密的消息（字符串或 Buffer，推荐使用 Buffer.from(text, 'utf-8') 处理多字节字符）
     * @returns 加密后的 Buffer
     */
    encrypt_with_checksum(
      privateKey: any,
      publicKey: any,
      nonce: string,
      message: string | Buffer
    ): Buffer;

    /**
     * 使用 checksum 解密消息
     * @param privateKey 接收方私钥
     * @param publicKey 发送方公钥
     * @param nonce 随机数
     * @param message 加密的消息
     * @returns 解密后的字符串
     */
    decrypt_with_checksum(
      privateKey: any,
      publicKey: any,
      nonce: string,
      message: Buffer
    ): string;
  };

  /**
   * 交易辅助工具类
   */
  export const TransactionHelper: {
    /**
     * 生成唯一的 64 位随机数（用于 memo nonce）
     * @returns 随机数字符串
     */
    unique_nonce_uint64(): string;
  };
}

declare module 'bitsharesjs/lib/ecc/src/signature' {
  const Signature: {
    sign(message: string | Buffer, privateKey: any): { toHex(): string };
  };
  export default Signature;
}
