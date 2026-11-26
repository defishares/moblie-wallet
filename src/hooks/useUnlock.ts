/**
 * 解锁钱包 Hook
 * 提供方便的解锁方法，支持生物认证和 PIN 码
 */

import { useCallback, useState } from 'react';
import { useAccountStore } from '../store/useAccountStore';
import { secureStorageService } from '../services/secure_storage_service';
import { unlockSession } from '../services/unlock_session';
import { unlockModalManager, type UnlockedKeys } from '../components';

interface UseUnlockOptions {
  /**
   * 解锁成功后的回调
   */
  onSuccess?: (keys: UnlockedKeys) => void;
  /**
   * 解锁取消的回调
   */
  onCancel?: () => void;
}

interface UseUnlockResult {
  /**
   * 是否正在解锁
   */
  isUnlocking: boolean;
  /**
   * 请求解锁（跳转到解锁页面）
   */
  requestUnlock: (options?: { forcePin?: boolean }) => void;
  /**
   * 快速解锁（直接尝试生物认证，不跳转页面）
   */
  quickUnlock: () => Promise<string | null>;
  /**
   * 检查是否需要解锁
   */
  checkNeedUnlock: () => boolean;
}

/**
 * 使用解锁功能的 Hook
 * 
 * @example
 * ```tsx
 * const { requestUnlock, quickUnlock } = useUnlock({
 *   onSuccess: (keys) => {
 *     // 使用 active 私钥进行交易签名等操作
 *     signTransaction(keys.active);
 *   },
 *   onCancel: () => {
 *     console.log('用户取消了解锁');
 *   },
 * });
 * 
 * // 方式1: 跳转到解锁页面
 * const handleTransfer = () => {
 *   requestUnlock();
 * };
 * 
 * // 方式2: 快速解锁（静默生物认证）
 * const handleQuickTransfer = async () => {
 *   const privateKey = await quickUnlock();
 *   if (privateKey) {
 *     // 直接使用私钥
 *   }
 * };
 * ```
 */
export const useUnlock = (options: UseUnlockOptions = {}): UseUnlockResult => {
  const { onSuccess, onCancel } = options;
  const { currentAccount } = useAccountStore();
  const [isUnlocking, setIsUnlocking] = useState(false);

  /**
   * 请求解锁 - 显示解锁弹窗
   */
  const requestUnlock = useCallback((requestOptions: { forcePin?: boolean } = {}) => {
    if (!currentAccount) {
      console.warn('[useUnlock] 没有当前账号');
      return;
    }

    const cachedKeys = unlockSession.getKeys(currentAccount.id);
    if (cachedKeys) {
      onSuccess?.(cachedKeys);
      return;
    }

    unlockModalManager.show({
      accountId: currentAccount.id,
      accountName: currentAccount.name,
      forcePin: requestOptions.forcePin,
      onSuccess: (keys: UnlockedKeys) => {
        onSuccess?.(keys);
      },
      onCancel,
    });
  }, [currentAccount, onSuccess, onCancel]);

  /**
   * 快速解锁 - 直接尝试生物认证
   * 如果生物认证不可用或失败，返回 null
   */
  const quickUnlock = useCallback(async (): Promise<string | null> => {
    if (!currentAccount) {
      console.warn('[useUnlock] 没有当前账号');
      return null;
    }

    setIsUnlocking(true);

    try {
      const cachedKey = unlockSession.getKey(currentAccount.id, 'active');
      if (cachedKey) {
        onSuccess?.({ active: cachedKey });
        return cachedKey;
      }

      // 检查是否启用了生物认证
      const biometricsEnabled = await secureStorageService.isBiometricsEnabled(currentAccount.id);

      if (!biometricsEnabled) {
        console.log('[useUnlock] 未启用生物认证，需要使用完整解锁流程');
        return null;
      }

      // 尝试生物认证
      const result = await secureStorageService.retrievePrivateKeyWithBiometric(currentAccount.id);

      if (result.success && result.privateKey) {
        if (onSuccess) {
          onSuccess({ active: result.privateKey });
        }
        return result.privateKey;
      }

      console.log('[useUnlock] 生物认证失败:', result.error);
      return null;
    } catch (error) {
      console.error('[useUnlock] 快速解锁失败:', error);
      return null;
    } finally {
      setIsUnlocking(false);
    }
  }, [currentAccount, onSuccess]);

  /**
   * 检查是否需要解锁（是否有当前账号）
   */
  const checkNeedUnlock = useCallback((): boolean => {
    return currentAccount !== null && !unlockSession.isActive(currentAccount.id);
  }, [currentAccount]);

  return {
    isUnlocking,
    requestUnlock,
    quickUnlock,
    checkNeedUnlock,
  };
};

export default useUnlock;
