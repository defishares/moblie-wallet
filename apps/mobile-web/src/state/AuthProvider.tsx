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
import {
  hasPinVault as hasStoredPinVault,
  isPinVaultSupported,
  registerPinVault,
  removePinVault,
  unlockPinVault,
} from '../auth/pinVault';

interface AuthContextValue {
  session: WebWalletSession | null;
  accounts: WebWalletSession[];
  isAuthenticated: boolean;
  login: (accountName: string, password: string) => Promise<WebWalletSession>;
  biometricLogin: (accountName: string) => Promise<WebWalletSession>;
  pinLogin: (accountName: string, pin: string) => Promise<WebWalletSession>;
  setupBiometricVault: (walletSession?: WebWalletSession) => Promise<void>;
  setupPinVault: (pin: string, walletSession?: WebWalletSession) => Promise<void>;
  hasBiometricVault: (accountName: string) => Promise<boolean>;
  hasPinVault: (accountName: string) => Promise<boolean>;
  ensureSigningKey: () => Promise<WebWalletSession>;
  lockSigningKey: () => void;
  signingKeyUnlocked: boolean;
  signingKeyTimeoutMinutes: number;
  setSigningKeyTimeoutMinutes: (minutes: number) => Promise<void>;
  removeBiometricVault: (accountId: string) => Promise<void>;
  biometricSupported: boolean;
  pinSupported: boolean;
  removePinVault: (accountId: string) => Promise<void>;
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
  const { authenticateAccount, prefetchAccountData, status, storage } = useChain();
  const [session, setSession] = useState<WebWalletSession | null>(null);
  const [accounts, setAccounts] = useState<WebWalletSession[]>([]);
  const biometricSupported = isBiometricVaultSupported();
  const pinSupported = isPinVaultSupported();
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
    if (!session || status !== 'connected') return;
    void prefetchAccountData(session.account.id);
  }, [prefetchAccountData, session, status]);

  useEffect(() => {
    if (!session?.privateKeyWif || signingKeyUnlockedAt == null) return;
    const remaining = signingKeyUnlockedAt + signingKeyTimeoutMinutes * 60_000 - Date.now();
    if (remaining <= 0) {
      setSession(current => current ? { ...current, privateKeyWif: '' } : current);
      setAccounts(current => current.map(item => ({ ...item, privateKeyWif: '' })));
      setSigningKeyUnlockedAt(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setSession(current => current?.account.id === session.account.id ? { ...current, privateKeyWif: '' } : current);
      setAccounts(current => current.map(item => ({ ...item, privateKeyWif: '' })));
      setSigningKeyUnlockedAt(null);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [session, signingKeyTimeoutMinutes, signingKeyUnlockedAt]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSessionIdentity(), loadLastAccountName()]).then(async ([identity, rememberedName]) => {
      if (cancelled) return;
      if (rememberedName) setLastAccountName(rememberedName);
      if (!identity) return;
      // On devices without Passkey, never restore a password session until a
      // PIN vault exists. This prevents a refresh from bypassing the required
      // local protection setup after the first password login.
      if (!biometricSupported && pinSupported && !(await hasStoredPinVault(identity.account.name))) {
        await clearSessionIdentity();
        return;
      }
      const restoredSession: WebWalletSession = { ...identity, privateKeyWif: '' };
      setAccounts([restoredSession]);
      setSession(restoredSession);
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setSessionHydrated(true);
    });
    return () => { cancelled = true; };
  }, [biometricSupported, pinSupported]);
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

  const pinLogin = useCallback(async (accountName: string, pin: string) => {
    const nextSession = await unlockPinVault(accountName, pin);
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

  const setupPinVault = useCallback(async (pin: string, walletSession = session) => {
    if (!walletSession) throw new Error('请先完成账户密码登录');
    if (!walletSession.privateKeyWif) throw new Error('当前会话没有可保存的私钥，请使用账户密码重新登录后设置 PIN');
    await registerPinVault(walletSession, pin);
  }, [session]);

  const ensureSigningKey = useCallback(async () => {
    if (!session) throw new Error('请先登录账户');
    const now = Date.now();
    const validUntil = signingKeyUnlockedAt == null ? 0 : signingKeyUnlockedAt + signingKeyTimeoutMinutes * 60_000;
    if (session.privateKeyWif && signingKeyUnlockedAt != null && now < validUntil) return session;
    let unlocked: WebWalletSession;
    if (biometricSupported && await hasStoredBiometricVault(session.account.name)) {
      unlocked = await unlockBiometricVault(session.account.name);
    } else if (pinSupported && await hasStoredPinVault(session.account.name)) {
      const pin = window.prompt('请输入本地 PIN 以解锁签名密钥（10 位，含大小写和特殊字符）');
      if (pin == null) throw new Error('已取消 PIN 验证');
      unlocked = await unlockPinVault(session.account.name, pin);
    } else {
      throw new Error('尚未设置设备验证或 PIN，请先完成安全设置');
    }
    await saveSessionIdentity(unlocked);
    setAccounts(current => [...current.filter(item => item.account.id !== unlocked.account.id), unlocked]);
    setSession(unlocked);
    setSigningKeyUnlockedAt(now);
    return unlocked;
  }, [biometricSupported, pinSupported, session, signingKeyTimeoutMinutes, signingKeyUnlockedAt]);

  const lockSigningKey = useCallback(() => {
    if (!session) return;
    // Keep the authenticated account identity in memory, but remove the WIF
    // from both session and account caches so no subsequent signing call can
    // reuse a key without a fresh local-device verification.
    const accountId = session.account.id;
    setSession(current => current?.account.id === accountId ? { ...current, privateKeyWif: '' } : current);
    setAccounts(current => current.map(item => ({ ...item, privateKeyWif: '' })));
    setSigningKeyUnlockedAt(null);
  }, [session]);

  const setSigningKeyTimeoutMinutes = useCallback(async (minutes: number) => {
    const normalized = Math.max(MIN_SIGNING_KEY_TIMEOUT_MINUTES, Math.min(MAX_SIGNING_KEY_TIMEOUT_MINUTES, Math.round(minutes)));
    setSigningKeyTimeoutMinutesState(normalized);
    await storage.set(SIGNING_KEY_TIMEOUT_STORAGE_KEY, normalized);
  }, [storage]);

  const hasBiometricVault = useCallback((accountName: string) => hasStoredBiometricVault(accountName), []);
  const hasPinVault = useCallback((accountName: string) => hasStoredPinVault(accountName), []);
  const deleteBiometricVault = useCallback((accountId: string) => removeBiometricVault(accountId), []);
  const deletePinVault = useCallback((accountId: string) => removePinVault(accountId), []);

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
    pinLogin,
    setupBiometricVault,
    setupPinVault,
    hasBiometricVault,
    hasPinVault,
    ensureSigningKey,
    lockSigningKey,
    signingKeyUnlocked: Boolean(session?.privateKeyWif && signingKeyUnlockedAt != null),
    signingKeyTimeoutMinutes,
    setSigningKeyTimeoutMinutes,
    removeBiometricVault: deleteBiometricVault,
    biometricSupported,
    pinSupported,
    removePinVault: deletePinVault,
    sessionHydrated,
    lastAccountName,
    logout,
    switchAccount,
  }), [accounts, biometricLogin, biometricSupported, deleteBiometricVault, deletePinVault, ensureSigningKey, hasBiometricVault, hasPinVault, lastAccountName, lockSigningKey, login, logout, pinLogin, pinSupported, session, sessionHydrated, setSigningKeyTimeoutMinutes, signingKeyTimeoutMinutes, signingKeyUnlockedAt, setupBiometricVault, setupPinVault, switchAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
