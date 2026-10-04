import { IndexedDbStorage } from '../platform/IndexedDbStorage';
import type { WebWalletSession } from './accountPassword';

const VAULT_VERSION = 1;
const VAULT_NAMESPACE = 'secure-vault';
const VAULT_INDEX_KEY = 'pin-vault.index.v1';
const KEY_PREFIX = 'pin-vault.account.';
const PBKDF2_ITERATIONS = 250_000;
const storage = typeof indexedDB !== 'undefined' ? new IndexedDbStorage(VAULT_NAMESPACE) : null;

function getStorage(): IndexedDbStorage {
  if (!storage) throw new Error('当前环境不支持 IndexedDB');
  return storage;
}

type VaultIndex = Record<string, string>;

interface PinVaultRecord {
  version: number;
  accountId: string;
  accountName: string;
  verifiedRole: WebWalletSession['verifiedRole'];
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

const SPECIAL_CHARACTER = /[^A-Za-z0-9]/;
const UPPERCASE_CHARACTER = /[A-Z]/;
const LOWERCASE_CHARACTER = /[a-z]/;

export function validatePin(pin: string): string | null {
  if (pin.length !== 10) return 'PIN 必须为 10 位';
  if (!UPPERCASE_CHARACTER.test(pin)) return 'PIN 必须包含至少 1 个大写字母';
  if (!LOWERCASE_CHARACTER.test(pin)) return 'PIN 必须包含至少 1 个小写字母';
  if (!SPECIAL_CHARACTER.test(pin)) return 'PIN 必须包含至少 1 个特殊字符';
  return null;
}

export function isPinVaultSupported(): boolean {
  return typeof window !== 'undefined'
    && Boolean(window.crypto?.subtle)
    && typeof indexedDB !== 'undefined';
}

function normalizedAccountName(name: string): string {
  return name.trim().toLowerCase();
}

function recordKey(accountId: string): string {
  return `${KEY_PREFIX}${accountId}`;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(value: ArrayBuffer | ArrayLike<number>): string {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return new Uint8Array(value).buffer as ArrayBuffer;
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function readIndex(): Promise<VaultIndex> {
  return (await getStorage().get<VaultIndex>(VAULT_INDEX_KEY)) ?? {};
}

async function writeIndex(index: VaultIndex): Promise<void> {
  await getStorage().set(VAULT_INDEX_KEY, index);
}

export async function hasPinVault(accountName: string): Promise<boolean> {
  if (!isPinVaultSupported()) return false;
  const index = await readIndex();
  const accountId = index[normalizedAccountName(accountName)];
  const record = accountId ? await getStorage().get<PinVaultRecord>(recordKey(accountId)) : null;
  return Boolean(record && record.version === VAULT_VERSION);
}

export async function registerPinVault(session: WebWalletSession, pin: string): Promise<void> {
  if (!isPinVaultSupported()) throw new Error('当前浏览器不支持本地 PIN 保险箱');
  const validationError = validatePin(pin);
  if (validationError) throw new Error(validationError);
  if (!session.privateKeyWif) throw new Error('当前会话没有可保存的私钥，请重新登录');

  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = await deriveKey(pin, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(session.privateKeyWif)),
  );
  const now = new Date().toISOString();
  const previous = await getStorage().get<PinVaultRecord>(recordKey(session.account.id));
  await getStorage().set<PinVaultRecord>(recordKey(session.account.id), {
    version: VAULT_VERSION,
    accountId: session.account.id,
    accountName: session.account.name,
    verifiedRole: session.verifiedRole,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  });
  const index = await readIndex();
  index[normalizedAccountName(session.account.name)] = session.account.id;
  await writeIndex(index);
}

export async function unlockPinVault(accountName: string, pin: string): Promise<WebWalletSession> {
  if (!isPinVaultSupported()) throw new Error('当前浏览器不支持本地 PIN 保险箱');
  const validationError = validatePin(pin);
  if (validationError) throw new Error(validationError);
  const index = await readIndex();
  const accountId = index[normalizedAccountName(accountName)];
  if (!accountId) throw new Error('此账户尚未设置 PIN');
  const record = await getStorage().get<PinVaultRecord>(recordKey(accountId));
  if (!record || record.version !== VAULT_VERSION) throw new Error('本地 PIN 保险箱不存在或版本不兼容');
  try {
    const key = await deriveKey(pin, fromBase64Url(record.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(fromBase64Url(record.iv)) },
      key,
      toArrayBuffer(fromBase64Url(record.ciphertext)),
    );
    return {
      account: { id: record.accountId, name: record.accountName },
      privateKeyWif: new TextDecoder().decode(plaintext),
      verifiedRole: record.verifiedRole,
    };
  } catch {
    throw new Error('PIN 错误或本地密钥无法解密');
  }
}

export async function removePinVault(accountId: string): Promise<void> {
  await getStorage().remove(recordKey(accountId));
  const index = await readIndex();
  const next = Object.fromEntries(Object.entries(index).filter(([, id]) => id !== accountId));
  await writeIndex(next);
}
