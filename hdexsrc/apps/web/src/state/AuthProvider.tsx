import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useChain } from './ChainProvider';
import type { WebWalletSession } from '../auth/accountPassword';
import {
  hasBiometricVault as hasStoredBiometricVault,
  isBiometricVaultSupported,
  clearSessionIdentity,
  loadLastAccountName,
  loadSessionIdentity,
  registerBiometricVault,
  removeBiometricVault,
  saveSessionIdentity,
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
  ensureSigningKey: () => Promise<WebWalletSession>;
  removeBiometricVault: (accountId: string) => Promise<void>;
  biometricSupported: boolean;
  sessionHydrated: boolean;
  lastAccountName: string;
  logout: () => void;
  switchAccount: (accountId: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { authenticateAccount } = useChain();
  const [session, setSession] = useState<WebWalletSession | null>(null);
  const [accounts, setAccounts] = useState<WebWalletSession[]>([]);
  const biometricSupported = isBiometricVaultSupported();
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [lastAccountName, setLastAccountName] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSessionIdentity(), loadLastAccountName()]).then(([identity, rememberedName]) => {
      if (cancelled) return;
      if (rememberedName) setLastAccountName(rememberedName);
      if (!identity) return;
      const restoredSession: WebWalletSession = { ...identity, privateKeyWif: '' };
      setAccounts([restoredSession]);
      setSession(restoredSession);
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setSessionHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);
  const login = useCallback(async (accountName: string, password: string) => {
    const nextSession = await authenticateAccount(accountName, password);
    await saveSessionIdentity(nextSession);
    setLastAccountName(nextSession.account.name);
    const identitySession: WebWalletSession = { ...nextSession, privateKeyWif: '' };
    setAccounts(current => [...current.filter(item => item.account.id !== nextSession.account.id), identitySession]);
    setSession(identitySession);
    return nextSession;
  }, [authenticateAccount]);

  const biometricLogin = useCallback(async (accountName: string) => {
    const nextSession = await unlockBiometricVault(accountName);
    await saveSessionIdentity(nextSession);
    setLastAccountName(nextSession.account.name);
    setAccounts(current => [...current.filter(item => item.account.id !== nextSession.account.id), nextSession]);
    setSession(nextSession);
    return nextSession;
  }, []);

  const setupBiometricVault = useCallback(async (walletSession = session) => {
    if (!walletSession) throw new Error('请先完成账户密码登录');
    if (!walletSession.privateKeyWif) throw new Error('当前会话没有可保存的私钥，请使用账户密码重新登录后启用设备验证');
    await registerBiometricVault(walletSession);
  }, [session]);

  const ensureSigningKey = useCallback(async () => {
    if (!session) throw new Error('请先登录账户');
    if (session.privateKeyWif) return session;
    const unlocked = await unlockBiometricVault(session.account.name);
    await saveSessionIdentity(unlocked);
    setAccounts(current => [...current.filter(item => item.account.id !== unlocked.account.id), unlocked]);
    setSession(unlocked);
    return unlocked;
  }, [session]);

  const hasBiometricVault = useCallback((accountName: string) => hasStoredBiometricVault(accountName), []);
  const deleteBiometricVault = useCallback((accountId: string) => removeBiometricVault(accountId), []);

  const logout = useCallback(() => {
    // The password and derived WIF only live in this tab's memory. Logging
    // out drops the signing material; nothing is persisted in IndexedDB.
    setAccounts([]);
    setSession(null);
    void clearSessionIdentity();
  }, []);
  const switchAccount = useCallback((accountId: string) => {
    const next = accounts.find(item => item.account.id === accountId);
    if (!next) return;
    setSession(next);
    void saveSessionIdentity(next);
  }, [accounts]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    accounts,
    isAuthenticated: session !== null,
    login,
    biometricLogin,
    setupBiometricVault,
    hasBiometricVault,
    ensureSigningKey,
    removeBiometricVault: deleteBiometricVault,
    biometricSupported,
    sessionHydrated,
    lastAccountName,
    logout,
    switchAccount,
  }), [accounts, biometricLogin, biometricSupported, deleteBiometricVault, ensureSigningKey, hasBiometricVault, lastAccountName, login, logout, session, sessionHydrated, setupBiometricVault, switchAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
