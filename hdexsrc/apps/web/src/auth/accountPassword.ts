import { PrivateKey } from 'bitsharesjs';
import * as BitsharesWs from 'bitsharesjs-ws';
import type { GrapheneRpcClient } from '@defishares/core';

export type VerifiedRole = 'active' | 'owner';

type ChainConfigApi = { setPrefix(prefix: string): void };
type BitsharesWsModule = { ChainConfig?: ChainConfigApi; default?: { ChainConfig?: ChainConfigApi } };
const wsModule = BitsharesWs as unknown as BitsharesWsModule;
const chainConfig = wsModule.ChainConfig ?? wsModule.default?.ChainConfig;

function setDfsPrefix(): void {
  if (!chainConfig) throw new Error('bitsharesjs ChainConfig 不可用');
  chainConfig.setPrefix('DFS');
}

export interface WebWalletSession {
  account: { id: string; name: string };
  privateKeyWif: string;
  verifiedRole: VerifiedRole;
}

interface Authority {
  key_auths?: Array<[string, number]>;
}

interface ChainAccount {
  id: string;
  name: string;
  active?: Authority;
  owner?: Authority;
}

/**
 * Matches the mobile account-password login exactly:
 * PrivateKey.fromSeed(`${accountName}${role}${password}`), then compare the
 * derived public key with the account's on-chain active/owner authorities.
 */
export async function authenticateAccountPassword(
  client: GrapheneRpcClient,
  accountName: string,
  password: string,
): Promise<WebWalletSession> {
  const normalizedName = accountName.trim();
  if (!normalizedName) throw new Error('请输入账户名');
  if (!password) throw new Error('请输入密码');
  if (!client.isConnected) throw new Error('节点尚未连接，请稍后重试');

  // The DFS prefix is required before public-key stringification, just like
  // LoginScreen in the React Native app.
  setDfsPrefix();
  const privateKey = PrivateKey.fromSeed(`${normalizedName}active${password}`);
  const privateKeyWif = privateKey.toWif();
  const publicKey = privateKey.toPublicKey().toString();

  const rows = await client.getFullAccounts([normalizedName]);
  const account = rows[0]?.[1]?.account as ChainAccount | undefined;
  if (!account) throw new Error('账户不存在');

  const activeKeys = account.active?.key_auths?.map(([key]) => key) ?? [];
  const ownerKeys = account.owner?.key_auths?.map(([key]) => key) ?? [];
  if (activeKeys.includes(publicKey)) {
    return { account: { id: account.id, name: account.name }, privateKeyWif, verifiedRole: 'active' };
  }
  if (ownerKeys.includes(publicKey)) {
    return { account: { id: account.id, name: account.name }, privateKeyWif, verifiedRole: 'owner' };
  }

  throw new Error('密码错误');
}
