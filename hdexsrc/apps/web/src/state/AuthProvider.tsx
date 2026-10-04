import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useChain } from './ChainProvider';
import type { WebWalletSession } from '../auth/accountPassword';
import {
  hasBiometricVault as hasStoredBiometricVault,
  isBiometricVaultSupported,
  registerBiometricVault,
  removeBiometricVault,
  unlockBiometricVault,
} from '../auth/biometricVault';

interface AuthContextValue {
  session: WebWalletSession | null;
  accounts: WebWalletSession[];
  isAuthenticated: boolean;
  login: (accountName: string, password: string) => Promise<WebWalletSession>;
  biometricLogin: (accountName: string) => Promise<WebWalletSession>;
  setupBiometricVault: (walletSession?: WebWalletSession) => Promise<void>;
  hasBiometricVault: (accountName: string) => Promise<boolean>;
  removeBiometricVault: (accountId: string) => Promise<void>;
  biometricSupported: boolean;
  logout: () => void;
  switchAccount: (accountId: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { authenticateAccount } = useChain();
  const [session, setSession] = useState<WebWalletSession | null>(null);
  const [accounts, setAccounts] = useState<WebWalletSession[]>([]);
  const biometricSupported = isBiometricVaultSupported();
  useEffect(() => {
    if (!session) return;
    const ttl = 60 * 60 * 1000;
    const expire = window.setTimeout(() => { setAccounts([]); setSession(null); }, ttl);
    let hiddenAt = 0;
    const onVisibility = () => { if (document.visibilityState === 'hidden') hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt >= ttl) { setAccounts([]); setSession(null); } };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearTimeout(expire); document.removeEventListener('visibilitychange', onVisibility); };
  }, [session]);

  const login = useCallback(async (accountName: string, password: string) => {
    const nextSession = await authenticateAccount(accountName, password);
    setAccounts(current => [...current.filter(item => item.account.id !== nextSession.account.id), nextSession]);
    setSession(nextSession);
    return nextSession;
  }, [authenticateAccount]);

  const biometricLogin = useCallback(async (accountName: string) => {
    const nextSession = await unlockBiometricVault(accountName);
    setAccounts(current => [...current.filter(item => item.account.id !== nextSession.account.id), nextSession]);
    setSession(nextSession);
    return nextSession;
  }, []);

  const setupBiometricVault = useCallback(async (walletSession = session) => {
    if (!walletSession) throw new Error('请先完成账户密码登录');
    await registerBiometricVault(walletSession);
  }, [session]);

  const hasBiometricVault = useCallback((accountName: string) => hasStoredBiometricVault(accountName), []);
  const deleteBiometricVault = useCallback((accountId: string) => removeBiometricVault(accountId), []);

  const logout = useCallback(() => {
    // The password and derived WIF only live in this tab's memory. Logging
    // out drops the signing material; nothing is persisted in IndexedDB.
    setAccounts([]);
    setSession(null);
  }, []);
  const switchAccount = useCallback((accountId: string) => { setSession(current => accounts.find(item => item.account.id === accountId) ?? current); }, [accounts]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    accounts,
    isAuthenticated: session !== null,
    login,
    biometricLogin,
    setupBiometricVault,
    hasBiometricVault,
    removeBiometricVault: deleteBiometricVault,
    biometricSupported,
    logout,
    switchAccount,
  }), [accounts, biometricLogin, biometricSupported, deleteBiometricVault, hasBiometricVault, login, logout, session, setupBiometricVault, switchAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
