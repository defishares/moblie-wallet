/**
 * 账号状态管理 Store
 * 管理当前账号和多账号切换
 */

import { create } from 'zustand';
import type { AccountInfo, StoredAccountsData } from '../types';
import { localCacheManager } from '../services/local_cache_mgr';

// 生成随机头像颜色
const generateAvatarColor = (): string => {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
    '#BB8FCE', '#85C1E9', '#F8B500', '#00D094',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

// 账号 Store 状态接口
interface AccountState {
  // ========== 状态 ==========
  isLoaded: boolean;                    // 是否已从本地加载
  currentAccount: AccountInfo | null;   // 当前登录的账号
  accounts: AccountInfo[];              // 所有账号列表

  // ========== Actions ==========
  /**
   * 从本地存储加载账号数据
   */
  loadAccounts: () => Promise<void>;

  /**
   * 添加新账号（登录成功后调用）
   * @param id 账号 ID
   * @param name 账号名称
   * @param setAsCurrent 是否设为当前账号
   */
  addAccount: (id: string, name: string, setAsCurrent?: boolean) => Promise<AccountInfo>;

  /**
   * 切换当前账号
   * @param accountId 要切换到的账号 ID
   */
  switchAccount: (accountId: string) => Promise<boolean>;

  /**
   * 移除账号
   * @param accountId 要移除的账号 ID
   */
  removeAccount: (accountId: string) => Promise<boolean>;

  /**
   * 更新账号最后登录时间
   * @param accountId 账号 ID
   */
  updateLastLogin: (accountId: string) => Promise<void>;

  /**
   * 登出当前账号（不删除账号信息）
   */
  logout: () => Promise<void>;

  /**
   * 清除所有账号数据
   */
  clearAllAccounts: () => Promise<void>;

  /**
   * 获取除当前账号外的其他账号
   */
  getOtherAccounts: () => AccountInfo[];

  /**
   * 检查账号是否已存在
   */
  hasAccount: (accountId: string) => boolean;
}

// 创建账号 Store
export const useAccountStore = create<AccountState>((set, get) => ({
  // ========== 初始状态 ==========
  isLoaded: false,
  currentAccount: null,
  accounts: [],

  // ========== Actions ==========

  // 从本地缓存加载账号数据（数据已在内存中，同步读取）
  loadAccounts: async () => {
    try {
      console.log('[AccountStore] 加载账号数据...');
      const data = localCacheManager.loadAccounts();

      if (data) {
        const currentAccount = data.currentAccountId
          ? data.accounts.find(acc => acc.id === data.currentAccountId) || null
          : null;

        set({
          accounts: data.accounts,
          currentAccount,
          isLoaded: true,
        });

        console.log(`[AccountStore] 加载了 ${data.accounts.length} 个账号，当前账号: ${currentAccount?.name || '无'}`);
      } else {
        set({ isLoaded: true });
        console.log('[AccountStore] 无已保存的账号数据');
      }
    } catch (error) {
      console.error('[AccountStore] 加载账号数据失败:', error);
      set({ isLoaded: true });
    }
  },

  // 添加新账号
  addAccount: async (id: string, name: string, setAsCurrent: boolean = true) => {
    const { accounts } = get();

    // 检查是否已存在
    const existingAccount = accounts.find(acc => acc.id === id);
    if (existingAccount) {
      console.log(`[AccountStore] 账号 ${name} 已存在，更新登录时间`);
      await get().updateLastLogin(id);

      if (setAsCurrent) {
        await get().switchAccount(id);
      }

      return existingAccount;
    }

    // 创建新账号信息
    const newAccount: AccountInfo = {
      id,
      name,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      avatarColor: generateAvatarColor(),
    };

    // 更新状态
    const updatedAccounts = [...accounts, newAccount];
    const newState: Partial<AccountState> = {
      accounts: updatedAccounts,
    };

    if (setAsCurrent) {
      newState.currentAccount = newAccount;
    }

    set(newState);

    // 持久化存储（同步写入内存和磁盘）
    const dataToSave: StoredAccountsData = {
      currentAccountId: setAsCurrent ? id : get().currentAccount?.id || null,
      accounts: updatedAccounts,
    };
    localCacheManager.saveAccounts(dataToSave);

    console.log(`[AccountStore] 添加账号成功: ${name} (${id})`);
    return newAccount;
  },

  // 切换当前账号
  switchAccount: async (accountId: string) => {
    const { accounts } = get();
    const targetAccount = accounts.find(acc => acc.id === accountId);

    if (!targetAccount) {
      console.error(`[AccountStore] 找不到账号: ${accountId}`);
      return false;
    }

    // 更新最后登录时间
    const updatedAccounts = accounts.map(acc =>
      acc.id === accountId
        ? { ...acc, lastLoginAt: Date.now() }
        : acc
    );

    set({
      currentAccount: { ...targetAccount, lastLoginAt: Date.now() },
      accounts: updatedAccounts,
    });

    // 持久化（同步写入内存和磁盘）
    const dataToSave: StoredAccountsData = {
      currentAccountId: accountId,
      accounts: updatedAccounts,
    };
    localCacheManager.saveAccounts(dataToSave);

    console.log(`[AccountStore] 切换到账号: ${targetAccount.name}`);
    return true;
  },

  // 移除账号
  removeAccount: async (accountId: string) => {
    const { accounts, currentAccount } = get();
    const updatedAccounts = accounts.filter(acc => acc.id !== accountId);

    // 如果删除的是当前账号，切换到其他账号或清空
    let newCurrentAccount = currentAccount;
    if (currentAccount?.id === accountId) {
      newCurrentAccount = updatedAccounts[0] || null;
    }

    set({
      accounts: updatedAccounts,
      currentAccount: newCurrentAccount,
    });

    // 持久化（同步写入内存和磁盘）
    const dataToSave: StoredAccountsData = {
      currentAccountId: newCurrentAccount?.id || null,
      accounts: updatedAccounts,
    };
    localCacheManager.saveAccounts(dataToSave);

    console.log(`[AccountStore] 移除账号: ${accountId}`);
    return true;
  },

  // 更新最后登录时间
  updateLastLogin: async (accountId: string) => {
    const { accounts } = get();
    const updatedAccounts = accounts.map(acc =>
      acc.id === accountId
        ? { ...acc, lastLoginAt: Date.now() }
        : acc
    );

    set({ accounts: updatedAccounts });

    // 更新当前账号状态
    const { currentAccount } = get();
    if (currentAccount?.id === accountId) {
      set({
        currentAccount: { ...currentAccount, lastLoginAt: Date.now() },
      });
    }

    // 持久化（同步写入内存和磁盘）
    const dataToSave: StoredAccountsData = {
      currentAccountId: get().currentAccount?.id || null,
      accounts: updatedAccounts,
    };
    localCacheManager.saveAccounts(dataToSave);
  },

  // 登出当前账号
  logout: async () => {
    const { accounts } = get();

    set({ currentAccount: null });

    // 持久化（保留账号列表，清除当前账号）
    const dataToSave: StoredAccountsData = {
      currentAccountId: null,
      accounts,
    };
    localCacheManager.saveAccounts(dataToSave);

    console.log('[AccountStore] 已登出');
  },

  // 清除所有账号数据
  clearAllAccounts: async () => {
    set({
      accounts: [],
      currentAccount: null,
    });

    localCacheManager.clearAccounts();
    console.log('[AccountStore] 已清除所有账号数据');
  },

  // 获取除当前账号外的其他账号
  getOtherAccounts: () => {
    const { accounts, currentAccount } = get();
    return accounts.filter(acc => acc.id !== currentAccount?.id);
  },

  // 检查账号是否已存在
  hasAccount: (accountId: string) => {
    const { accounts } = get();
    return accounts.some(acc => acc.id === accountId);
  },
}));

export default useAccountStore;

