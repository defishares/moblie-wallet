import { IndexedDbStorage } from '../platform/IndexedDbStorage';
import type { WebWalletSession } from './accountPassword';

const VAULT_VERSION = 1;
const VAULT_NAMESPACE = 'secure-vault';
const VAULT_INDEX_KEY = 'vault.index.v1';
const SESSION_KEY = 'auth.session.v1';
const LAST_ACCOUNT_KEY = 'auth.last-account.v1';
const KEY_PREFIX = 'vault.account.';
const HKDF_INFO = new TextEncoder().encode('defishares web passkey vault v1');

type VaultIndex = Record<string, string>;

interface VaultRecord {
  version: number;
  accountId: string;
  accountName: string;
  verifiedRole: WebWalletSession['verifiedRole'];
  credentialId: string;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedSessionIdentity {
  account: { id: string; name: string };
  verifiedRole: WebWalletSession['verifiedRole'];
}

interface PrfRegistrationResult {
  enabled?: boolean;
}

interface PrfAuthenticationResult {
  first?: ArrayBuffer;
}

interface WebAuthnClientExtensionResults {
  prf?: {
    enabled?: boolean;
    results?: PrfAuthenticationResult;
  };
}

interface WebAuthnCredentialLike {
  rawId: ArrayBuffer;
  getClientExtensionResults(): WebAuthnClientExtensionResults;
}

const storage = new IndexedDbStorage(VAULT_NAMESPACE);

export async function saveSessionIdentity(session: WebWalletSession): Promise<void> {
  await storage.set<PersistedSessionIdentity>(SESSION_KEY, {
    account: session.account,
    verifiedRole: session.verifiedRole,
  });
  await storage.set(LAST_ACCOUNT_KEY, session.account.name);
}

export async function loadSessionIdentity(): Promise<PersistedSessionIdentity | null> {
  return storage.get<PersistedSessionIdentity>(SESSION_KEY);
}

export async function clearSessionIdentity(): Promise<void> {
  await storage.remove(SESSION_KEY);
}

export async function loadLastAccountName(): Promise<string | null> {
  return storage.get<string>(LAST_ACCOUNT_KEY);
}

function assertEnvironment(): void {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    throw new Error('设备验证需要安全上下文，请使用 HTTPS 或 localhost/127.0.0.1 访问');
  }
  if (!window.crypto?.subtle || !navigator.credentials || !window.PublicKeyCredential) {
    throw new Error('当前浏览器不支持 Passkey 设备验证');
  }
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

function normalizedAccountName(name: string): string {
  return name.trim().toLowerCase();
}

function recordKey(accountId: string): string {
  return `${KEY_PREFIX}${accountId}`;
}

async function readIndex(): Promise<VaultIndex> {
  return (await storage.get<VaultIndex>(VAULT_INDEX_KEY)) ?? {};
}

async function writeIndex(index: VaultIndex): Promise<void> {
  await storage.set(VAULT_INDEX_KEY, index);
}

function getPrfOutput(result: WebAuthnCredentialLike): ArrayBuffer {
  const extension = result.getClientExtensionResults().prf;
  const output = extension?.results?.first;
  if (!output) throw new Error('此 Passkey 未返回加密派生结果，请换用支持 PRF 的设备验证');
  return output;
}

async function deriveEncryptionKey(prfOutput: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const input = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(salt), info: toArrayBuffer(HKDF_INFO) },
    input,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptPrivateKey(privateKeyWif: string, key: CryptoKey): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(privateKeyWif);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
  return { iv: toBase64Url(iv), ciphertext: toBase64Url(ciphertext) };
}

async function decryptPrivateKey(record: VaultRecord, key: CryptoKey): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(fromBase64Url(record.iv)) },
      key,
      toArrayBuffer(fromBase64Url(record.ciphertext)),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('设备验证通过，但本地密钥无法解密，可能是保险箱数据已损坏');
  }
}

function createChallenge(): Uint8Array {
  return randomBytes(32);
}

function credentialIdFrom(credential: WebAuthnCredentialLike): string {
  return toBase64Url(credential.rawId);
}

function userIdFor(accountId: string): Uint8Array {
  return new TextEncoder().encode(accountId).slice(0, 64);
}

function asCredential(value: Credential | null): WebAuthnCredentialLike {
  if (!value || !('rawId' in value) || !('getClientExtensionResults' in value)) {
    throw new Error('设备验证未返回有效的 Passkey 凭据');
  }
  return value as unknown as WebAuthnCredentialLike;
}

export function isBiometricVaultSupported(): boolean {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && Boolean(window.crypto?.subtle)
    && Boolean(navigator.credentials)
    && Boolean(window.PublicKeyCredential);
}

export async function hasBiometricVault(accountName: string): Promise<boolean> {
  if (!isBiometricVaultSupported()) return false;
  const index = await readIndex();
  const accountId = index[normalizedAccountName(accountName)];
  return Boolean(accountId && await storage.get<VaultRecord>(recordKey(accountId)));
}

/** Returns only account names, never private key material. */
export async function listBiometricVaultAccounts(): Promise<string[]> {
  if (!isBiometricVaultSupported()) return [];
  const index = await readIndex();
  const accounts = await Promise.all(Object.entries(index).map(async ([name, accountId]) => {
    const record = await storage.get<VaultRecord>(recordKey(accountId));
    return record && record.version === VAULT_VERSION ? record.accountName || name : null;
  }));
  return accounts.filter((name): name is string => Boolean(name));
}

export async function registerBiometricVault(session: WebWalletSession): Promise<void> {
  assertEnvironment();
  const salt = randomBytes(32);
  const credential = asCredential(await navigator.credentials.create({
    publicKey: {
      challenge: createChallenge(),
      rp: { name: 'DefiShares' },
      user: {
        id: userIdFor(session.account.id),
        name: session.account.name,
        displayName: session.account.name,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt } } },
    } as unknown as PublicKeyCredentialCreationOptions,
  }));
  const registration = credential.getClientExtensionResults().prf as PrfRegistrationResult | undefined;
  if (!registration?.enabled) {
    throw new Error('当前设备验证不支持 PRF，无法安全保存本地私钥；请使用账户密码登录');
  }
  const key = await deriveEncryptionKey(getPrfOutput(credential), salt);
  const encrypted = await encryptPrivateKey(session.privateKeyWif, key);
  const now = new Date().toISOString();
  const previous = await storage.get<VaultRecord>(recordKey(session.account.id));
  const record: VaultRecord = {
    version: VAULT_VERSION,
    accountId: session.account.id,
    accountName: session.account.name,
    verifiedRole: session.verifiedRole,
    credentialId: credentialIdFrom(credential),
    salt: toBase64Url(salt),
    ...encrypted,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  await storage.set(recordKey(session.account.id), record);
  const index = await readIndex();
  index[normalizedAccountName(session.account.name)] = session.account.id;
  await writeIndex(index);
}

export async function unlockBiometricVault(accountName: string): Promise<WebWalletSession> {
  assertEnvironment();
  const index = await readIndex();
  const accountId = index[normalizedAccountName(accountName)];
  if (!accountId) throw new Error('此账户尚未启用设备验证');
  const record = await storage.get<VaultRecord>(recordKey(accountId));
  if (!record || record.version !== VAULT_VERSION) throw new Error('本地密钥保险箱不存在或版本不兼容');
  const salt = fromBase64Url(record.salt);
  const credential = asCredential(await navigator.credentials.get({
    publicKey: {
      challenge: createChallenge(),
      allowCredentials: [{ id: fromBase64Url(record.credentialId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { evalByCredential: { [record.credentialId]: { first: salt } } } },
    } as unknown as PublicKeyCredentialRequestOptions,
  }));
  const key = await deriveEncryptionKey(getPrfOutput(credential), salt);
  const privateKeyWif = await decryptPrivateKey(record, key);
  return {
    account: { id: record.accountId, name: record.accountName },
    privateKeyWif,
    verifiedRole: record.verifiedRole,
  };
}

export async function removeBiometricVault(accountId: string): Promise<void> {
  await storage.remove(recordKey(accountId));
  const index = await readIndex();
  const next = Object.fromEntries(Object.entries(index).filter(([, id]) => id !== accountId));
  await writeIndex(next);
}
