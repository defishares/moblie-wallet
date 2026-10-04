import assert from 'node:assert/strict';
import test from 'node:test';
import { PrivateKey } from 'bitsharesjs';
import * as BitsharesWs from 'bitsharesjs-ws';
import { authenticateAccountPassword } from '../src/auth/accountPassword';
import { signTransferPreview } from '../src/services/transferSigning';
import { formatGrapheneError } from '../src/services/grapheneError';
import { validatePin } from '../src/auth/pinVault';

const makeClient = (account: unknown) => ({
  isConnected: true,
  getFullAccounts: async () => account ? [['alice', { account }]] : [],
}) as any;

test('matches the RN active-key derivation and chain authority check', async () => {
  (BitsharesWs as any).default.ChainConfig.setPrefix('DFS');
  const password = 'correct horse battery staple';
  const key = PrivateKey.fromSeed(`aliceactive${password}`);
  const result = await authenticateAccountPassword(
    makeClient({ id: '1.2.100', name: 'alice', active: { key_auths: [[key.toPublicKey().toString(), 1]] } }),
    'alice',
    password,
  );
  assert.equal(result.account.id, '1.2.100');
  assert.equal(result.account.name, 'alice');
  assert.equal(result.verifiedRole, 'active');
  assert.equal(result.privateKeyWif, key.toWif());
});

test('rejects a password whose derived public key is not authorized', async () => {
  const key = PrivateKey.fromSeed('aliceactiveanother-password');
  await assert.rejects(
    () => authenticateAccountPassword(
      makeClient({ id: '1.2.100', name: 'alice', active: { key_auths: [[key.toPublicKey().toString(), 1]] } }),
      'alice',
      'wrong-password',
    ),
    /密码错误/,
  );
});

test('serializes a locally signed transfer without broadcasting', async () => {
  const key = PrivateKey.fromSeed('web-signing-test');
  const client = {
    getDynamicGlobalProperties: async () => ({
      head_block_number: 123,
      head_block_id: '0000000001000000000000000000000000000000000000000000000000000000',
      time: '2026-10-02T04:00:00',
    }),
    db: async () => '7089639ad55d91ef53946f3fc4dc86ea5b8a4917edcfce6d3c39bc259657acb',
  } as any;
  const transaction = await signTransferPreview(client, {
    from: { id: '1.2.1', name: 'from' },
    to: { id: '1.2.2', name: 'to' },
    amount: { atomic: '100000', value: 1, symbol: 'DFS', assetId: '1.3.0', precision: 5 },
    fee: { atomic: '100', value: 0.001, symbol: 'DFS', assetId: '1.3.0', precision: 5 },
    operation: { fee: { amount: 0, asset_id: '1.3.0' }, from: '1.2.1', to: '1.2.2', amount: { amount: '100000', asset_id: '1.3.0' }, extensions: [] },
  }, key.toWif());
  assert.equal(Array.isArray(transaction.signatures), true);
  assert.equal((transaction as any).operations?.[0]?.[0], 0);
});

test('encrypts a UTF-8 memo using the RN transfer format', async () => {
  (BitsharesWs as any).default.ChainConfig.setPrefix('DFS');
  const key = PrivateKey.fromSeed('web-memo-test');
  const client = {
    getDynamicGlobalProperties: async () => ({ head_block_number: 123, head_block_id: '0000000001000000000000000000000000000000000000000000000000000000', time: '2026-10-02T04:00:00' }),
    db: async () => '7089639ad55d91ef53946f3fc4dc86ea5b8a4917edcfce6d3c39bc259657acb',
  } as any;
  const transaction = await signTransferPreview(client, {
    from: { id: '1.2.1', name: 'from' }, to: { id: '1.2.2', name: 'to' },
    amount: { atomic: '100000', value: 1, symbol: 'DFS', assetId: '1.3.0', precision: 5 },
    fee: { atomic: '100', value: 0.001, symbol: 'DFS', assetId: '1.3.0', precision: 5 },
    memo: '中文 memo', toMemoKey: key.toPublicKey().toString(),
    operation: { fee: { amount: 0, asset_id: '1.3.0' }, from: '1.2.1', to: '1.2.2', amount: { amount: '100000', asset_id: '1.3.0' }, extensions: [] },
  }, key.toWif());
  const operation = (transaction as any).operations[0][1];
  assert.equal(typeof operation.memo.from, 'string');
  assert.equal(operation.memo.to, key.toPublicKey().toString());
  assert.equal(typeof operation.memo.nonce, 'string');
  assert.equal(typeof operation.memo.message, 'string');
});

test('maps Graphene broadcast errors to RN-compatible messages', () => {
  assert.equal(formatGrapheneError(new Error('duplicate transaction')), '该交易已存在，不用重复广播。');
  assert.equal(formatGrapheneError(new Error('missing required active authority')), '签名无效。');
});

test('requires a strong local PIN for devices without Passkey', () => {
  assert.match(validatePin('short') || '', /必须为 10 位/);
  assert.match(validatePin('lowercase1') || '', /大写字母/);
  assert.match(validatePin('UPPERCASE1') || '', /小写字母/);
  assert.match(validatePin('Aa12345678') || '', /特殊字符/);
  assert.equal(validatePin('Abcdefghi!'), null);
});
