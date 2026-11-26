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
    // Always start with a zero fee. The preview is only an estimate and can
    // have been calculated before memo encryption (or several seconds before
    // signing). The chain must calculate the fee from this final operation.
    fee: { amount: 0, asset_id: preview.fee.assetId },
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
      // The raw database RPC is JSON encoded. A Buffer would be serialized as
      // { type: 'Buffer', data: [...] }, which Graphene cannot cast to its
      // bytes/object_type field. Hex is accepted by both get_required_fees and
      // bitsharesjs' final transaction serializer.
      operation.memo = { from: fromMemoKey, to: preview.toMemoKey, nonce, message: (encryptedMessage as Buffer).toString('hex') };
    } catch (cause) {
      throw new Error(`备注加密失败：${cause instanceof Error ? cause.message : '请检查密钥是否正确'}`);
    }
  }

  // RN adds/encrypts the memo before calling set_required_fees(). Do the same
  // here so a memo-bearing transfer cannot be signed with an under-estimated
  // fee and rejected as "Insufficient Fee Paid" during broadcast.
  const feeRows = await client.db<Array<{ amount: string | number; asset_id: string }>>(
    'get_required_fees',
    [[[0, operation]], preview.fee.assetId],
  );
  const fee = feeRows[0];
  if (!fee || fee.amount == null || fee.asset_id !== preview.fee.assetId) {
    throw new Error('节点未返回有效手续费，请刷新后重试');
  }
  operation.fee = { amount: String(fee.amount), asset_id: fee.asset_id };

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
