/**
 * App 内存中的解锁会话。
 *
 * 成功验证后暂存已解密的密钥，避免在有效期内重复弹出 PIN/生物认证。
 * 会话只存在于当前 App 进程，超时或退出账号后自动清除。
 */

export type CachedUnlockedKeys = { [key: string]: string | undefined };

export const UNLOCK_SESSION_TTL_MS = 60 * 60 * 1000;

interface UnlockSession {
  startedAt: number;
  expiresAt: number;
  keys: CachedUnlockedKeys;
  timer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, UnlockSession>();
const listeners = new Set<() => void>();

const notify = (): void => {
  listeners.forEach(listener => listener());
};

const getValidSession = (accountId: string): UnlockSession | null => {
  const session = sessions.get(accountId);
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt <= now || now < session.startedAt) {
    if (session.timer) clearTimeout(session.timer);
    sessions.delete(accountId);
    notify();
    return null;
  }

  return session;
};

export const unlockSession = {
  isActive(accountId: string): boolean {
    return getValidSession(accountId) !== null;
  },

  getKeys(accountId: string): CachedUnlockedKeys | null {
    const session = getValidSession(accountId);
    return session ? { ...session.keys } : null;
  },

  getKey(accountId: string, keyType: string): string | undefined {
    return getValidSession(accountId)?.keys[keyType];
  },

  markUnlocked(accountId: string, keys: CachedUnlockedKeys): void {
    const previous = sessions.get(accountId);
    if (previous?.timer) clearTimeout(previous.timer);

    const startedAt = Date.now();
    const expiresAt = startedAt + UNLOCK_SESSION_TTL_MS;
    const session: UnlockSession = {
      startedAt,
      expiresAt,
      keys: { ...keys },
    };

    session.timer = setTimeout(() => {
      const current = sessions.get(accountId);
      if (current === session) {
        sessions.delete(accountId);
        notify();
      }
    }, UNLOCK_SESSION_TTL_MS);

    sessions.set(accountId, session);
    notify();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  clear(accountId?: string): void {
    if (accountId) {
      const session = sessions.get(accountId);
      if (session?.timer) clearTimeout(session.timer);
      sessions.delete(accountId);
      notify();
      return;
    }

    sessions.forEach(session => {
      if (session.timer) clearTimeout(session.timer);
    });
    sessions.clear();
    notify();
  },
};
