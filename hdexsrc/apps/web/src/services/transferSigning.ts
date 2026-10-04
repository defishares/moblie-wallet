import { Buffer } from 'buffer';
import { Aes, PrivateKey, TransactionBuilder, TransactionHelper } from 'bitsharesjs';
import * as BitsharesWs from 'bitsharesjs-ws';
import type { GrapheneRpcClient, TransferPreview } from '@defishares/core';

type ChainConfigApi = { setPrefix(prefix: string): void };
type BitsharesWsModule = { ChainConfig?: ChainConfigApi; default?: { ChainConfig?: ChainConfigApi } };
const wsModule = BitsharesWs as unknown as BitsharesWsModule;
const chainConfig = wsModule.ChainConfig ?? wsModule.default?.ChainConfig;

/** Build and sign a transfer using the same Graphene serializer as the RN app. */
export async function signTransferPreview(
  client: GrapheneRpcClient,
  preview: TransferPreview,
  privateKeyWif: string,
): Promise<Record<string, unknown>> {
  if (!chainConfig) throw new Error('bitsharesjs ChainConfig 不可用');
  chainConfig.setPrefix('DFS');
  const operation: Record<string, unknown> = {
    ...preview.operation,
    fee: { amount: preview.fee.atomic, asset_id: preview.fee.assetId },
    amount: { amount: preview.amount.atomic, asset_id: preview.amount.assetId },
    extensions: [],
  };
  if (preview.memo?.trim()) {
    if (!preview.toMemoKey) throw new Error('备注加密失败：缺少接收方公钥信息');
    try {
      const memoPrivateKey = PrivateKey.fromWif(privateKeyWif);
      const fromMemoKey = memoPrivateKey.toPublicKey().toPublicKeyString();
      const nonce = TransactionHelper.unique_nonce_uint64();
      const encryptedMessage = Aes.encrypt_with_checksum(memoPrivateKey, preview.toMemoKey, nonce, Buffer.from(preview.memo, 'utf-8'));
      operation.memo = { from: fromMemoKey, to: preview.toMemoKey, nonce, message: encryptedMessage };
    } catch (cause) {
      throw new Error(`备注加密失败：${cause instanceof Error ? cause.message : '请检查密钥是否正确'}`);
    }
  }
  return signOperation(client, 'transfer', operation, privateKeyWif);
}

export async function signOperation(
  client: GrapheneRpcClient,
  operationName: string,
  operation: Record<string, unknown>,
  privateKeyWif: string,
): Promise<Record<string, unknown>> {
  if (!chainConfig) throw new Error('bitsharesjs ChainConfig 不可用');
  chainConfig.setPrefix('DFS');
  const properties = await client.getDynamicGlobalProperties();
  const transaction = new TransactionBuilder();
  transaction.add_type_operation(operationName, operation);
  transaction.ref_block_num = properties.head_block_number & 0xffff;
  transaction.ref_block_prefix = Buffer.from(properties.head_block_id, 'hex').readUInt32LE(4);
  transaction.expiration = Math.ceil(new Date(`${properties.time}Z`).getTime() / 1_000) + 30;
  await transaction.finalize();
  const privateKey = PrivateKey.fromWif(privateKeyWif);
  transaction.add_signer(privateKey, privateKey.toPublicKey().toPublicKeyString());
  transaction.sign(await client.db<string>('get_chain_id'));
  return transaction.serialize() as Record<string, unknown>;
}
