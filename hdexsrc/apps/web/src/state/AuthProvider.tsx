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
  signingKeyTimeoutMinutes: number;
  setSigningKeyTimeoutMinutes: (minutes: number) => Promise<void>;
  removeBiometricVault: (accountId: string) => Promise<void>;
  biometricSupported: boolean;
  sessionHydrated: boolean;
  lastAccountName: string;
  logout: () => void;
  switchAccount: (accountId: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SIGNING_KEY_TIMEOUT_STORAGE_KEY = 'auth.signing-key-timeout-minutes.v1';
const DEFAULT_SIGNING_KEY_TIMEOUT_MINUTES = 15;
const MIN_SIGNING_KEY_TIMEOUT_MINUTES = 5;
const MAX_SIGNING_KEY_TIMEOUT_MINUTES = 600;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { authenticateAccount, storage } = useChain();
  const [session, setSession] = useState<WebWalletSession | null>(null);
  const [accounts, setAccounts] = useState<WebWalletSession[]>([]);
  const biometricSupported = isBiometricVaultSupported();
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [lastAccountName, setLastAccountName] = useState('');
  const [signingKeyTimeoutMinutes, setSigningKeyTimeoutMinutesState] = useState(DEFAULT_SIGNING_KEY_TIMEOUT_MINUTES);
  const [signingKeyUnlockedAt, setSigningKeyUnlockedAt] = useState<number | null>(null);

  useEffect(() => {
    void storage.get<number>(SIGNING_KEY_TIMEOUT_STORAGE_KEY).then(value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      setSigningKeyTimeoutMinutesState(Math.max(MIN_SIGNING_KEY_TIMEOUT_MINUTES, Math.min(MAX_SIGNING_KEY_TIMEOUT_MINUTES, Math.round(value))));
    }).catch(() => undefined);
  }, [storage]);

  useEffect(() => {
    if (!session?.privateKeyWif || signingKeyUnlockedAt == null) return;
    const remaining = signingKeyUnlockedAt + signingKeyTimeoutMinutes * 60_000 - Date.now();
    if (remaining <= 0) {
      setSession(current => current ? { ...current, privateKeyWif: '' } : current);
      setAccounts(current => current.map(item => item.account.id === session.account.id ? { ...item, privateKeyWif: '' } : item));
      setSigningKeyUnlockedAt(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setSession(current => current?.account.id === session.account.id ? { ...current, privateKeyWif: '' } : current);
      setAccounts(current => current.map(item => item.account.id === session.account.id ? { ...item, privateKeyWif: '' } : item));
      setSigningKeyUnlockedAt(null);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [session, signingKeyTimeoutMinutes, signingKeyUnlockedAt]);

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
    setSigningKeyUnlockedAt(null);
    return nextSession;
  }, [authenticateAccount]);

  const biometricLogin = useCallback(async (accountName: string) => {
    const nextSession = await unlockBiometricVault(accountName);
    await saveSessionIdentity(nextSession);
    setLastAccountName(nextSession.account.name);
    setAccounts(current => [...current.filter(item => item.account.id !== nextSession.account.id), nextSession]);
    setSession(nextSession);
    setSigningKeyUnlockedAt(Date.now());
    return nextSession;
  }, []);

  const setupBiometricVault = useCallback(async (walletSession = session) => {
    if (!walletSession) throw new Error('请先完成账户密码登录');
    if (!walletSession.privateKeyWif) throw new Error('当前会话没有可保存的私钥，请使用账户密码重新登录后启用设备验证');
    await registerBiometricVault(walletSession);
  }, [session]);

  const ensureSigningKey = useCallback(async () => {
    if (!session) throw new Error('请先登录账户');
    const now = Date.now();
    const validUntil = signingKeyUnlockedAt == null ? 0 : signingKeyUnlockedAt + signingKeyTimeoutMinutes * 60_000;
    if (session.privateKeyWif && signingKeyUnlockedAt != null && now < validUntil) return session;
    const unlocked = await unlockBiometricVault(session.account.name);
    await saveSessionIdentity(unlocked);
    setAccounts(current => [...current.filter(item => item.account.id !== unlocked.account.id), unlocked]);
    setSession(unlocked);
    setSigningKeyUnlockedAt(now);
    return unlocked;
  }, [session, signingKeyTimeoutMinutes, signingKeyUnlockedAt]);

  const setSigningKeyTimeoutMinutes = useCallback(async (minutes: number) => {
    const normalized = Math.max(MIN_SIGNING_KEY_TIMEOUT_MINUTES, Math.min(MAX_SIGNING_KEY_TIMEOUT_MINUTES, Math.round(minutes)));
    setSigningKeyTimeoutMinutesState(normalized);
    await storage.set(SIGNING_KEY_TIMEOUT_STORAGE_KEY, normalized);
  }, [storage]);

  const hasBiometricVault = useCallback((accountName: string) => hasStoredBiometricVault(accountName), []);
  const deleteBiometricVault = useCallback((accountId: string) => removeBiometricVault(accountId), []);

  const logout = useCallback(() => {
    // The password and derived WIF only live in this tab's memory. Logging
    // out drops the signing material; nothing is persisted in IndexedDB.
    setAccounts([]);
    setSession(null);
    setSigningKeyUnlockedAt(null);
    void clearSessionIdentity();
  }, []);
  const switchAccount = useCallback((accountId: string) => {
    const next = accounts.find(item => item.account.id === accountId);
    if (!next) return;
    setSession(next);
    setSigningKeyUnlockedAt(null);
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
    signingKeyTimeoutMinutes,
    setSigningKeyTimeoutMinutes,
    removeBiometricVault: deleteBiometricVault,
    biometricSupported,
    sessionHydrated,
    lastAccountName,
    logout,
    switchAccount,
  }), [accounts, biometricLogin, biometricSupported, deleteBiometricVault, ensureSigningKey, hasBiometricVault, lastAccountName, login, logout, session, sessionHydrated, setSigningKeyTimeoutMinutes, signingKeyTimeoutMinutes, setupBiometricVault, switchAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
