/**
 * ============================================================================
 * 安全存储服务 (Secure Storage Service)
 * ============================================================================
 * 
 * 使用 react-native-keychain 进行安全存储
 * - iOS: Keychain + Secure Enclave (安全芯片)
 * - Android: Keystore + TEE/StrongBox (可信执行环境)
 * 
 * ============================================================================
 * 存储架构概述
 * ============================================================================
 * 
 * PIN 和生物认证是【分开存储】的，互不干扰：
 * 
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                        安全芯片 (Keychain/Keystore)                       │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │                                                                         │
 * │  ┌─────────────────────────────────────────────────────────────────┐   │
 * │  │ SECURE_DATA (PIN 加密存储)                                       │   │
 * │  │ Key: com.hdex.wallet.secure.{accountId}                         │   │
 * │  │ ┌─────────────────────────────────────────────────────────────┐ │   │
 * │  │ │ {                                                           │ │   │
 * │  │ │   version: 2,                                               │ │   │
 * │  │ │   salt: "随机盐值",                                          │ │   │
 * │  │ │   pinHash: "hash(PIN + salt)",  // 用于验证 PIN              │ │   │
 * │  │ │   encryptedKeys: {              // KDF(PIN,salt) 加密        │ │   │
 * │  │ │     active: "加密后的active私钥",                             │ │   │
 * │  │ │     memo: "加密后的memo私钥",                                 │ │   │
 * │  │ │     owner: "加密后的owner私钥"                                │ │   │
 * │  │ │   }                                                         │ │   │
 * │  │ │ }                                                           │ │   │
 * │  │ └─────────────────────────────────────────────────────────────┘ │   │
 * │  └─────────────────────────────────────────────────────────────────┘   │
 * │                                                                         │
 * │  ┌─────────────────────────────────────────────────────────────────┐   │
 * │  │ BIOMETRIC_KEY (生物认证存储) - 需要生物认证才能读取               │   │
 * │  │ Key: com.hdex.wallet.biometric.{accountId}                      │   │
 * │  │ ┌─────────────────────────────────────────────────────────────┐ │   │
 * │  │ │ {                                                           │ │   │
 * │  │ │   active: "明文active私钥",  // 安全芯片保护，需生物认证读取   │ │   │
 * │  │ │   memo: "明文memo私钥",                                       │ │   │
 * │  │ │   owner: "明文owner私钥"                                      │ │   │
 * │  │ │ }                                                           │ │   │
 * │  │ └─────────────────────────────────────────────────────────────┘ │   │
 * │  └─────────────────────────────────────────────────────────────────┘   │
 * │                                                                         │
 * │  ┌─────────────────────────────────────────────────────────────────┐   │
 * │  │ SECURITY_CONFIG (安全配置)                                       │   │
 * │  │ Key: com.hdex.wallet.config.{accountId}                         │   │
 * │  │ ┌─────────────────────────────────────────────────────────────┐ │   │
 * │  │ │ { biometricsEnabled: true/false }                           │ │   │
 * │  │ └─────────────────────────────────────────────────────────────┘ │   │
 * │  └─────────────────────────────────────────────────────────────────┘   │
 * │                                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * ============================================================================
 * PIN 存储流程 (initializeAccount)
 * ============================================================================
 * 
 *   用户输入                        存储到安全芯片
 *   ─────────                       ─────────────
 *       │                                │
 *       ▼                                │
 *   ┌───────┐                            │
 *   │  PIN  │                            │
 *   └───┬───┘                            │
 *       │                                │
 *       ▼                                │
 *   ┌─────────────────┐                  │
 *   │ 生成随机 salt   │                  │
 *   └────────┬────────┘                  │
 *            │                           │
 *       ┌────┴────┐                      │
 *       ▼         ▼                      │
 *   ┌───────┐ ┌───────────┐              │
 *   │pinHash│ │encryptKey │              │
 *   │=hash( │ │=KDF(PIN,  │              │
 *   │PIN+   │ │salt)      │              │
 *   │salt)  │ │           │              │
 *   └───┬───┘ └─────┬─────┘              │
 *       │           │                    │
 *       │           ▼                    │
 *       │    ┌─────────────┐             │
 *       │    │ 加密私钥    │             │
 *       │    │ XOR(私钥,   │             │
 *       │    │ encryptKey) │             │
 *       │    └──────┬──────┘             │
 *       │           │                    │
 *       ▼           ▼                    ▼
 *   ┌─────────────────────────────────────────┐
 *   │ SECURE_DATA = {                         │
 *   │   salt, pinHash, encryptedKeys          │
 *   │ }                                       │
 *   └─────────────────────────────────────────┘
 * 
 * ============================================================================
 * PIN 读取流程 (retrievePrivateKeyWithPin)
 * ============================================================================
 * 
 *   用户输入 PIN              从安全芯片读取
 *   ────────────              ─────────────
 *        │                          │
 *        ▼                          ▼
 *   ┌─────────┐              ┌─────────────┐
 *   │输入 PIN │              │ SECURE_DATA │
 *   └────┬────┘              └──────┬──────┘
 *        │                          │
 *        │    ┌─────────────────────┤
 *        │    │                     │
 *        ▼    ▼                     │
 *   ┌─────────────────┐             │
 *   │ 计算 hash       │             │
 *   │ (输入PIN + salt)│             │
 *   └────────┬────────┘             │
 *            │                      │
 *            ▼                      │
 *   ┌─────────────────┐             │
 *   │ 比对 pinHash    │◄────────────┘
 *   │ 是否相等？      │
 *   └────────┬────────┘
 *            │
 *      ┌─────┴─────┐
 *      │           │
 *   不相等      相等
 *      │           │
 *      ▼           ▼
 *   ┌─────┐   ┌─────────────────┐
 *   │错误 │   │ 派生解密密钥    │
 *   │返回 │   │ KDF(PIN, salt)  │
 *   └─────┘   └────────┬────────┘
 *                      │
 *                      ▼
 *              ┌─────────────────┐
 *              │ 解密私钥        │
 *              │ XOR(加密私钥,   │
 *              │ decryptKey)     │
 *              └────────┬────────┘
 *                       │
 *                       ▼
 *              ┌─────────────────┐
 *              │ 返回明文私钥    │
 *              └─────────────────┘
 * 
 * ============================================================================
 * 生物认证存储流程 (enableBiometricStorage)
 * ============================================================================
 * 
 *   输入私钥（需先用 PIN 验证获取）
 *   ──────────────────────────────
 *            │
 *            ▼
 *   ┌─────────────────────────────────────────┐
 *   │ 直接存储明文私钥到 BIOMETRIC_KEY        │
 *   │ (由安全芯片 + 生物认证保护)             │
 *   │                                         │
 *   │ accessControl: BIOMETRY_CURRENT_SET     │
 *   │ (必须通过生物认证才能读取)              │
 *   └─────────────────────────────────────────┘
 * 
 *   注：生物认证存储不加密私钥，因为：
 *   1. 安全芯片本身已提供硬件级保护
 *   2. 必须通过生物认证才能读取
 *   3. 其他 App 无法访问
 * 
 * ============================================================================
 * 生物认证读取流程 (retrievePrivateKeyWithBiometric)
 * ============================================================================
 * 
 *   请求读取                 系统弹出生物认证
 *   ────────                 ────────────────
 *       │                          │
 *       ▼                          ▼
 *   ┌─────────┐              ┌─────────────┐
 *   │ 调用    │              │ Face ID /   │
 *   │ Keychain│─────────────▶│ Touch ID /  │
 *   │ 读取    │              │ 指纹验证    │
 *   └─────────┘              └──────┬──────┘
 *                                   │
 *                            ┌──────┴──────┐
 *                            │             │
 *                         验证失败      验证成功
 *                            │             │
 *                            ▼             ▼
 *                       ┌─────────┐   ┌─────────────┐
 *                       │ 返回    │   │ 安全芯片    │
 *                       │ 错误    │   │ 释放私钥    │
 *                       └─────────┘   └──────┬──────┘
 *                                            │
 *                                            ▼
 *                                    ┌─────────────┐
 *                                    │ 返回明文    │
 *                                    │ 私钥        │
 *                                    └─────────────┘
 * 
 * ============================================================================
 * 智能解锁流程 (smartUnlock / smartUnlockAllKeys)
 * ============================================================================
 * 
 *   ┌──────────────────┐
 *   │ 检查是否启用     │
 *   │ 生物认证         │
 *   └────────┬─────────┘
 *            │
 *      ┌─────┴─────┐
 *      │           │
 *   未启用       已启用
 *      │           │
 *      │           ▼
 *      │    ┌─────────────┐
 *      │    │ 尝试生物    │
 *      │    │ 认证解锁    │
 *      │    └──────┬──────┘
 *      │           │
 *      │     ┌─────┴─────┐
 *      │     │           │
 *      │   失败        成功
 *      │     │           │
 *      ▼     ▼           ▼
 *   ┌─────────────┐  ┌─────────┐
 *   │ 返回需要    │  │ 返回    │
 *   │ PIN 码      │  │ 私钥    │
 *   └─────────────┘  └─────────┘
 * 
 * ============================================================================
 * API 一览
 * ============================================================================
 * 
 * 存储方法：
 *   - initializeAccount(accountId, pin, keys)     初始化账号（PIN加密）
 *   - addPrivateKey(accountId, pin, keyType, key) 添加新私钥
 *   - enableBiometricStorage(accountId, keys)     启用生物认证
 *   - disableBiometricStorage(accountId)          禁用生物认证
 * 
 * PIN 读取：
 *   - retrievePrivateKeyWithPin(accountId, pin, keyType)  获取单个私钥
 *   - retrieveAllKeysWithPin(accountId, pin)              获取所有私钥
 *   - verifyPin(accountId, pin)                           仅验证PIN
 * 
 * 生物认证读取：
 *   - retrievePrivateKeyWithBiometric(accountId, keyType) 获取单个私钥
 *   - retrieveAllKeysWithBiometric(accountId)             获取所有私钥
 * 
 * 智能解锁（优先生物认证）：
 *   - smartUnlock(accountId, keyType, useBiometric)       获取单个私钥
 *   - smartUnlockAllKeys(accountId, useBiometric)         获取所有私钥
 *   - smartUnlockWithFallback(accountId, pin?, keyType)   带PIN后备
 * 
 * 辅助方法：
 *   - isAccountInitialized(accountId)     检查是否已初始化
 *   - isBiometricsEnabled(accountId)      检查是否启用生物认证
 *   - clearAccountSecureData(accountId)   清除账号数据
 *   - validatePin(pin)                    验证PIN格式
 * 
 * ============================================================================
 */

import * as Keychain from 'react-native-keychain';
import { hash } from 'bitsharesjs';
import type { BiometricType, UnlockResult } from '../types';

// Keychain 服务名称前缀
const SERVICE_PREFIX = 'com.hdex.wallet';

// 数据版本（用于后续升级迁移）
const DATA_VERSION = 2;

// 存储 Key
const STORAGE_KEYS = {
  // 账号安全数据（包含 salt、pinHash、加密私钥）
  SECURE_DATA: (accountId: string) => `${SERVICE_PREFIX}.secure.${accountId}`,
  // 生物认证私钥存储 Key（启用生物认证时使用）
  BIOMETRIC_KEY: (accountId: string) => `${SERVICE_PREFIX}.biometric.${accountId}`,
  // 账号安全配置
  SECURITY_CONFIG: (accountId: string) => `${SERVICE_PREFIX}.config.${accountId}`,
};

// 私钥类型
export type KeyType = 'active' | 'memo' | 'owner' | string;

/**
 * 安全存储的账号数据结构
 */
interface SecureAccountData {
  version: number;              // 数据版本
  salt: string;                 // 随机盐值
  pinHash: string;              // PIN 验证摘要 = hash(PIN + salt)
  encryptedKeys: {              // 加密后的私钥映射
    [key in KeyType]?: string;
  };
}

/**
 * 加密工具类
 * 使用 salt + hash + KDF 的安全方案
 */
class CryptoUtils {
  /**
   * 生成随机盐值
   * @param length 盐值长度（字节）
   */
  static generateSalt(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let salt = '';
    for (let i = 0; i < length; i++) {
      salt += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // 添加时间戳增加随机性
    salt += Date.now().toString(36);
    return salt;
  }

  /**
   * 计算 SHA256 哈希
   * 使用 bitsharesjs 提供的加密库实现
   */
  static sha256(message: string): string {
    return hash.sha256(message).toString('hex');
  }

  /**
   * 计算 PIN 验证摘要
   * @param pin PIN 码
   * @param salt 盐值
   */
  static computePinHash(pin: string, salt: string): string {
    // 多轮哈希增强安全性
    let hash = pin + salt;
    for (let i = 0; i < 1000; i++) {
      hash = this.sha256(hash + salt + i.toString());
    }
    return hash;
  }

  /**
   * 派生加密密钥（KDF）
   * @param pin PIN 码
   * @param salt 盐值
   */
  static deriveKey(pin: string, salt: string): string {
    // 使用不同的混合方式派生密钥
    let key = salt + pin + salt;
    for (let i = 0; i < 1000; i++) {
      key = this.sha256(key + pin + (i * 7).toString());
    }
    return key;
  }

  /**
   * 使用派生密钥加密数据
   * @param plaintext 明文
   * @param key 派生密钥
   */
  static encrypt(plaintext: string, key: string): string {
    // 扩展密钥到与明文相同长度
    const expandedKey = this.expandKey(key, plaintext.length);

    // XOR 加密
    let encrypted = '';
    for (let i = 0; i < plaintext.length; i++) {
      const charCode = plaintext.charCodeAt(i) ^ expandedKey.charCodeAt(i);
      encrypted += charCode.toString(16).padStart(4, '0');
    }

    return encrypted;
  }

  /**
   * 使用派生密钥解密数据
   * @param ciphertext 密文
   * @param key 派生密钥
   */
  static decrypt(ciphertext: string, key: string): string {
    try {
      // 解析密文
      const chars: number[] = [];
      for (let i = 0; i < ciphertext.length; i += 4) {
        chars.push(parseInt(ciphertext.substring(i, i + 4), 16));
      }

      // 扩展密钥
      const expandedKey = this.expandKey(key, chars.length);

      // XOR 解密
      let decrypted = '';
      for (let i = 0; i < chars.length; i++) {
        decrypted += String.fromCharCode(chars[i] ^ expandedKey.charCodeAt(i));
      }

      return decrypted;
    } catch (error) {
      console.error('[CryptoUtils] 解密失败:', error);
      return '';
    }
  }

  /**
   * 扩展密钥到指定长度
   */
  private static expandKey(key: string, length: number): string {
    let result = '';
    let idx = 0;
    while (result.length < length) {
      const char = key.charCodeAt(idx % key.length);
      const modifier = (idx * 17 + char) % 256;
      result += String.fromCharCode((char + modifier) % 256);
      idx++;
    }
    return result.substring(0, length);
  }

  /**
   * 验证 PIN 码格式
   * 要求：10位以上，包含大写字母、小写字母、特殊符号
   */
  static validatePin(pin: string): { valid: boolean; message?: string } {
    if (pin.length < 10) {
      return { valid: false, message: 'PIN码长度至少10位' };
    }
    if (!/[A-Z]/.test(pin)) {
      return { valid: false, message: 'PIN码必须包含大写字母' };
    }
    if (!/[a-z]/.test(pin)) {
      return { valid: false, message: 'PIN码必须包含小写字母' };
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pin)) {
      return { valid: false, message: 'PIN码必须包含特殊符号' };
    }
    return { valid: true };
  }
}

/**
 * 安全存储服务类
 */
class SecureStorageService {
  private static instance: SecureStorageService;

  private constructor() { }

  /**
   * 获取单例实例
   */
  public static getInstance(): SecureStorageService {
    if (!SecureStorageService.instance) {
      SecureStorageService.instance = new SecureStorageService();
    }
    return SecureStorageService.instance;
  }

  // ============================================
  // 生物认证相关
  // ============================================

  /**
   * 获取设备支持的生物认证类型
   */
  async getSupportedBiometricType(): Promise<BiometricType> {
    try {
      const biometryType = await Keychain.getSupportedBiometryType();

      if (!biometryType) {
        return 'None';
      }

      switch (biometryType) {
        case Keychain.BIOMETRY_TYPE.FACE_ID:
          return 'FaceID';
        case Keychain.BIOMETRY_TYPE.TOUCH_ID:
          return 'TouchID';
        case Keychain.BIOMETRY_TYPE.FINGERPRINT:
          return 'Fingerprint';
        case Keychain.BIOMETRY_TYPE.IRIS:
          return 'Iris';
        default:
          return 'None';
      }
    } catch (error) {
      console.error('[SecureStorage] 获取生物认证类型失败:', error);
      return 'None';
    }
  }

  /**
   * 检查是否支持生物认证
   */
  async isBiometricAvailable(): Promise<boolean> {
    const type = await this.getSupportedBiometricType();
    return type !== 'None';
  }

  /**
   * 获取生物认证的显示名称
   */
  getBiometricDisplayName(type: BiometricType): string {
    const names: Record<BiometricType, string> = {
      FaceID: '面容 ID',
      TouchID: '触控 ID',
      Fingerprint: '指纹识别',
      Iris: '虹膜识别',
      None: '无',
    };
    return names[type];
  }

  // ============================================
  // 核心存储方法（PIN + 多私钥）
  // ============================================

  /**
   * 初始化账号安全存储
   * 首次设置 PIN 时调用
   * @param accountId 账号 ID
   * @param pin PIN 码
   * @param keys 私钥映射 { active: '...', memo: '...' }
   */
  async initializeAccount(
    accountId: string,
    pin: string,
    keys: { [key in KeyType]?: string }
  ): Promise<boolean> {
    try {
      // 验证 PIN 码格式
      const validation = CryptoUtils.validatePin(pin);
      if (!validation.valid) {
        console.error('[SecureStorage] PIN码格式不合法:', validation.message);
        return false;
      }

      // 生成随机盐值
      const salt = CryptoUtils.generateSalt();

      // 计算 PIN 验证摘要
      const pinHash = CryptoUtils.computePinHash(pin, salt);

      // 派生加密密钥
      const encryptionKey = CryptoUtils.deriveKey(pin, salt);

      // 加密所有私钥
      const encryptedKeys: { [key in KeyType]?: string } = {};
      for (const [keyType, privateKey] of Object.entries(keys)) {
        if (privateKey) {
          encryptedKeys[keyType as KeyType] = CryptoUtils.encrypt(privateKey, encryptionKey);
        }
      }

      // 构建安全数据
      const secureData: SecureAccountData = {
        version: DATA_VERSION,
        salt,
        pinHash,
        encryptedKeys,
      };

      // 存储到 Keychain（安全芯片）
      const result = await Keychain.setGenericPassword(
        accountId,
        JSON.stringify(secureData),
        {
          service: STORAGE_KEYS.SECURE_DATA(accountId),
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }
      );

      console.log(`[SecureStorage] 账号安全数据已初始化 (账号: ${accountId}, 私钥数: ${Object.keys(encryptedKeys).length})`);
      return result !== false;
    } catch (error) {
      console.error('[SecureStorage] 初始化账号失败:', error);
      return false;
    }
  }

  /**
   * 使用 PIN 码验证并获取私钥
   * @param accountId 账号 ID
   * @param pin PIN 码
   * @param keyType 私钥类型（默认 active）
   */
  async retrievePrivateKeyWithPin(
    accountId: string,
    pin: string,
    keyType: KeyType = 'active'
  ): Promise<UnlockResult> {
    try {
      // 从 Keychain 读取安全数据
      const credentials = await Keychain.getGenericPassword({
        service: STORAGE_KEYS.SECURE_DATA(accountId),
      });

      if (!credentials) {
        return { success: false, error: '未找到账号安全数据' };
      }

      // 解析安全数据
      const secureData: SecureAccountData = JSON.parse(credentials.password);

      // 验证 PIN 是否正确
      const computedHash = CryptoUtils.computePinHash(pin, secureData.salt);
      if (computedHash !== secureData.pinHash) {
        return { success: false, error: 'PIN码错误' };
      }

      // PIN 正确，派生解密密钥
      const decryptionKey = CryptoUtils.deriveKey(pin, secureData.salt);

      // 获取指定类型的加密私钥
      const encryptedKey = secureData.encryptedKeys[keyType];
      if (!encryptedKey) {
        return { success: false, error: `未找到 ${keyType} 私钥` };
      }

      // 解密私钥
      const privateKey = CryptoUtils.decrypt(encryptedKey, decryptionKey);

      if (!privateKey) {
        return { success: false, error: '解密私钥失败' };
      }

      return { success: true, privateKey };
    } catch (error) {
      console.error('[SecureStorage] 读取私钥失败:', error);
      return { success: false, error: '读取密钥失败' };
    }
  }

  /**
   * 使用 PIN 码获取所有私钥
   * @param accountId 账号 ID
   * @param pin PIN 码
   */
  async retrieveAllKeysWithPin(
    accountId: string,
    pin: string
  ): Promise<{ success: boolean; keys?: { [key in KeyType]?: string }; error?: string }> {
    try {
      // 从 Keychain 读取安全数据
      const credentials = await Keychain.getGenericPassword({
        service: STORAGE_KEYS.SECURE_DATA(accountId),
      });

      if (!credentials) {
        return { success: false, error: '未找到账号安全数据' };
      }

      // 解析安全数据
      const secureData: SecureAccountData = JSON.parse(credentials.password);

      // 验证 PIN 是否正确
      const computedHash = CryptoUtils.computePinHash(pin, secureData.salt);
      if (computedHash !== secureData.pinHash) {
        return { success: false, error: 'PIN码错误' };
      }

      // PIN 正确，派生解密密钥
      const decryptionKey = CryptoUtils.deriveKey(pin, secureData.salt);

      // 解密所有私钥
      const keys: { [key in KeyType]?: string } = {};
      for (const [keyType, encryptedKey] of Object.entries(secureData.encryptedKeys)) {
        if (encryptedKey) {
          keys[keyType as KeyType] = CryptoUtils.decrypt(encryptedKey, decryptionKey);
        }
      }

      return { success: true, keys };
    } catch (error) {
      console.error('[SecureStorage] 读取所有私钥失败:', error);
      return { success: false, error: '读取密钥失败' };
    }
  }

  /**
   * 添加新的私钥到账号
   * @param accountId 账号 ID
   * @param pin PIN 码
   * @param keyType 私钥类型
   * @param privateKey 私钥
   */
  async addPrivateKey(
    accountId: string,
    pin: string,
    keyType: KeyType,
    privateKey: string
  ): Promise<boolean> {
    try {
      // 从 Keychain 读取安全数据
      const credentials = await Keychain.getGenericPassword({
        service: STORAGE_KEYS.SECURE_DATA(accountId),
      });

      if (!credentials) {
        console.error('[SecureStorage] 未找到账号安全数据');
        return false;
      }

      // 解析安全数据
      const secureData: SecureAccountData = JSON.parse(credentials.password);

      // 验证 PIN 是否正确
      const computedHash = CryptoUtils.computePinHash(pin, secureData.salt);
      if (computedHash !== secureData.pinHash) {
        console.error('[SecureStorage] PIN码错误');
        return false;
      }

      // 派生加密密钥
      const encryptionKey = CryptoUtils.deriveKey(pin, secureData.salt);

      // 加密新私钥
      secureData.encryptedKeys[keyType] = CryptoUtils.encrypt(privateKey, encryptionKey);

      // 保存更新后的安全数据
      const result = await Keychain.setGenericPassword(
        accountId,
        JSON.stringify(secureData),
        {
          service: STORAGE_KEYS.SECURE_DATA(accountId),
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }
      );

      console.log(`[SecureStorage] 已添加 ${keyType} 私钥 (账号: ${accountId})`);
      return result !== false;
    } catch (error) {
      console.error('[SecureStorage] 添加私钥失败:', error);
      return false;
    }
  }

  /**
   * 验证 PIN 码是否正确（不返回私钥）
   * @param accountId 账号 ID
   * @param pin PIN 码
   */
  async verifyPin(accountId: string, pin: string): Promise<boolean> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: STORAGE_KEYS.SECURE_DATA(accountId),
      });

      if (!credentials) {
        return false;
      }

      const secureData: SecureAccountData = JSON.parse(credentials.password);
      const computedHash = CryptoUtils.computePinHash(pin, secureData.salt);

      return computedHash === secureData.pinHash;
    } catch (error) {
      console.error('[SecureStorage] 验证 PIN 失败:', error);
      return false;
    }
  }

  // ============================================
  // 生物认证存储（支持多私钥）
  // ============================================

  /**
   * 启用生物认证存储私钥（支持多私钥）
   * 需要先使用 PIN 验证，然后额外存储一份生物认证版本
   * @param accountId 账号 ID
   * @param keys 私钥映射 { active: '...', memo: '...' }，兼容单私钥字符串
   */
  async enableBiometricStorage(
    accountId: string,
    keys: { [key in KeyType]?: string } | string
  ): Promise<boolean> {
    try {
      const biometricType = await this.getSupportedBiometricType();
      if (biometricType === 'None') {
        console.warn('[SecureStorage] 设备不支持生物认证');
        return false;
      }

      // 兼容旧的单私钥参数
      const keysToStore: { [key in KeyType]?: string } =
        typeof keys === 'string' ? { active: keys } : keys;

      // 使用生物认证保护存储私钥（JSON 格式）
      const result = await Keychain.setGenericPassword(
        accountId,
        JSON.stringify(keysToStore),
        {
          service: STORAGE_KEYS.BIOMETRIC_KEY(accountId),
          accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }
      );

      if (result !== false) {
        // 保存配置：已启用生物认证
        await this.saveSecurityConfig(accountId, { biometricsEnabled: true });
        console.log(`[SecureStorage] 已启用生物认证 (账号: ${accountId}, 私钥数: ${Object.keys(keysToStore).length})`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[SecureStorage] 启用生物认证失败:', error);
      return false;
    }
  }

  /**
   * 使用生物认证读取私钥
   * @param accountId 账号 ID
   * @param keyType 私钥类型（默认 active）
   */
  async retrievePrivateKeyWithBiometric(
    accountId: string,
    keyType: KeyType = 'active'
  ): Promise<UnlockResult> {
    try {
      const result = await this.retrieveAllKeysWithBiometric(accountId);

      if (!result.success || !result.keys) {
        return { success: false, error: result.error };
      }

      const privateKey = result.keys[keyType];
      if (!privateKey) {
        return { success: false, error: `未找到 ${keyType} 私钥` };
      }

      return { success: true, privateKey };
    } catch (error: any) {
      console.error('[SecureStorage] 生物认证读取失败:', error);
      return { success: false, error: '生物认证失败' };
    }
  }

  /**
   * 使用生物认证读取所有私钥
   * @param accountId 账号 ID
   */
  async retrieveAllKeysWithBiometric(
    accountId: string
  ): Promise<{ success: boolean; keys?: { [key in KeyType]?: string }; error?: string }> {
    try {
      const biometricType = await this.getSupportedBiometricType();
      const biometricName = this.getBiometricDisplayName(biometricType);

      // 使用生物认证读取
      const credentials = await Keychain.getGenericPassword({
        service: STORAGE_KEYS.BIOMETRIC_KEY(accountId),
        authenticationPrompt: {
          title: '验证身份',
          subtitle: `使用${biometricName}解锁钱包`,
          description: '请验证您的身份以访问钱包',
          cancel: '取消',
        },
      });

      if (!credentials) {
        return { success: false, error: '生物认证失败或已取消' };
      }

      // 解析私钥数据
      try {
        const keys = JSON.parse(credentials.password);
        return { success: true, keys };
      } catch {
        // 兼容旧格式（单个私钥字符串）
        return { success: true, keys: { active: credentials.password } };
      }
    } catch (error: any) {
      console.error('[SecureStorage] 生物认证读取失败:', error);

      // 判断错误类型
      if (error.message?.includes('cancel') || error.message?.includes('Cancel')) {
        return { success: false, error: '用户取消认证' };
      }
      if (error.message?.includes('not enrolled') || error.message?.includes('Not enrolled')) {
        return { success: false, error: '未设置生物认证' };
      }
      if (error.message?.includes('lockout') || error.message?.includes('Lockout')) {
        return { success: false, error: '认证次数过多，请稍后再试' };
      }

      return { success: false, error: '生物认证失败' };
    }
  }

  /**
   * 禁用生物认证
   * @param accountId 账号 ID
   */
  async disableBiometricStorage(accountId: string): Promise<boolean> {
    try {
      await Keychain.resetGenericPassword({
        service: STORAGE_KEYS.BIOMETRIC_KEY(accountId),
      });
      await this.saveSecurityConfig(accountId, { biometricsEnabled: false });
      console.log(`[SecureStorage] 已禁用生物认证 (账号: ${accountId})`);
      return true;
    } catch (error) {
      console.error('[SecureStorage] 禁用生物认证失败:', error);
      return false;
    }
  }

  // ============================================
  // 安全配置管理
  // ============================================

  /**
   * 保存安全配置
   */
  async saveSecurityConfig(
    accountId: string,
    config: { biometricsEnabled: boolean }
  ): Promise<boolean> {
    try {
      await Keychain.setGenericPassword(
        accountId,
        JSON.stringify(config),
        {
          service: STORAGE_KEYS.SECURITY_CONFIG(accountId),
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }
      );
      return true;
    } catch (error) {
      console.error('[SecureStorage] 保存安全配置失败:', error);
      return false;
    }
  }

  /**
   * 读取安全配置
   */
  async getSecurityConfig(accountId: string): Promise<{ biometricsEnabled: boolean } | null> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: STORAGE_KEYS.SECURITY_CONFIG(accountId),
      });

      if (!credentials) {
        return null;
      }

      return JSON.parse(credentials.password);
    } catch (error) {
      console.error('[SecureStorage] 读取安全配置失败:', error);
      return null;
    }
  }

  /**
   * 检查账号是否启用了生物认证
   */
  async isBiometricsEnabled(accountId: string): Promise<boolean> {
    const config = await this.getSecurityConfig(accountId);
    return config?.biometricsEnabled || false;
  }

  // ============================================
  // 智能解锁（自动选择最佳方式）
  // ============================================

  /**
   * 智能解锁 - 获取单个私钥
   * 优先使用生物认证，失败则需要 PIN
   * @param accountId 账号 ID
   * @param keyType 私钥类型（默认 active）
   * @param useBiometric 是否尝试使用生物认证
   */
  async smartUnlock(
    accountId: string,
    keyType: KeyType = 'active',
    useBiometric: boolean = true
  ): Promise<UnlockResult & { usedMethod: 'biometric' | 'pin' | 'none' }> {
    // 检查是否启用了生物认证
    const biometricsEnabled = await this.isBiometricsEnabled(accountId);

    if (useBiometric && biometricsEnabled) {
      console.log('[SecureStorage] 尝试使用生物认证解锁...');
      const result = await this.retrievePrivateKeyWithBiometric(accountId, keyType);

      if (result.success) {
        return { ...result, usedMethod: 'biometric' };
      }

      // 生物认证失败，需要用户输入 PIN
      console.log('[SecureStorage] 生物认证失败，需要 PIN 码');
      return { success: false, error: result.error, usedMethod: 'none' };
    }

    // 未启用生物认证，需要 PIN 码
    return { success: false, error: '需要输入PIN码', usedMethod: 'none' };
  }

  /**
   * 智能解锁 - 获取所有私钥
   * 优先使用生物认证，失败则需要 PIN
   * @param accountId 账号 ID
   * @param useBiometric 是否尝试使用生物认证
   */
  async smartUnlockAllKeys(
    accountId: string,
    useBiometric: boolean = true
  ): Promise<{ success: boolean; keys?: { [key in KeyType]?: string }; error?: string; usedMethod: 'biometric' | 'pin' | 'none' }> {
    // 检查是否启用了生物认证
    const biometricsEnabled = await this.isBiometricsEnabled(accountId);

    if (useBiometric && biometricsEnabled) {
      console.log('[SecureStorage] 尝试使用生物认证获取所有私钥...');
      const result = await this.retrieveAllKeysWithBiometric(accountId);

      if (result.success) {
        return { ...result, usedMethod: 'biometric' };
      }

      // 生物认证失败，需要用户输入 PIN
      console.log('[SecureStorage] 生物认证失败，需要 PIN 码');
      return { success: false, error: result.error, usedMethod: 'none' };
    }

    // 未启用生物认证，需要 PIN 码
    return { success: false, error: '需要输入PIN码', usedMethod: 'none' };
  }

  /**
   * 智能解锁（完整版）- 使用 PIN 作为后备
   * @param accountId 账号 ID
   * @param pin PIN 码（可选，用于生物认证失败时的后备）
   * @param keyType 私钥类型
   */
  async smartUnlockWithFallback(
    accountId: string,
    pin?: string,
    keyType: KeyType = 'active'
  ): Promise<UnlockResult & { usedMethod: 'biometric' | 'pin' | 'none' }> {
    // 先尝试生物认证
    const biometricsEnabled = await this.isBiometricsEnabled(accountId);

    if (biometricsEnabled) {
      console.log('[SecureStorage] 尝试使用生物认证解锁...');
      const bioResult = await this.retrievePrivateKeyWithBiometric(accountId, keyType);

      if (bioResult.success) {
        return { ...bioResult, usedMethod: 'biometric' };
      }

      console.log('[SecureStorage] 生物认证失败，尝试 PIN 后备...');
    }

    // 生物认证失败或未启用，尝试 PIN
    if (pin) {
      const pinResult = await this.retrievePrivateKeyWithPin(accountId, pin, keyType);
      if (pinResult.success) {
        return { ...pinResult, usedMethod: 'pin' };
      }
      return { ...pinResult, usedMethod: 'none' };
    }

    return { success: false, error: '需要输入PIN码', usedMethod: 'none' };
  }

  // ============================================
  // 清理操作
  // ============================================

  /**
   * 清除账号的所有安全数据
   * @param accountId 账号 ID
   */
  async clearAccountSecureData(accountId: string): Promise<boolean> {
    try {
      await Promise.all([
        Keychain.resetGenericPassword({ service: STORAGE_KEYS.SECURE_DATA(accountId) }),
        Keychain.resetGenericPassword({ service: STORAGE_KEYS.BIOMETRIC_KEY(accountId) }),
        Keychain.resetGenericPassword({ service: STORAGE_KEYS.SECURITY_CONFIG(accountId) }),
      ]);
      console.log(`[SecureStorage] 已清除账号安全数据: ${accountId}`);
      return true;
    } catch (error) {
      console.error('[SecureStorage] 清除安全数据失败:', error);
      return false;
    }
  }

  /**
   * 检查账号是否已初始化安全存储
   * @param accountId 账号 ID
   */
  async isAccountInitialized(accountId: string): Promise<boolean> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: STORAGE_KEYS.SECURE_DATA(accountId),
      });
      return credentials !== false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 验证 PIN 码格式
   */
  validatePin(pin: string): { valid: boolean; message?: string } {
    return CryptoUtils.validatePin(pin);
  }
}

// 导出单例实例
export const secureStorageService = SecureStorageService.getInstance();
export default secureStorageService;
