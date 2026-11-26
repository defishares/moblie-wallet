import { Buffer } from 'buffer';
import { Serializer, types } from 'bitsharesjs';

export interface AccountStorageUpdate {
  accountId: string;
  remove: boolean;
  catalog: string;
  keyValues: Array<[string, string]>;
  feeAssetId?: string;
}

// Graphene fc::raw::pack<static_variant<account_storage_map>>.
// Field order and optional string values follow custom_operations.hpp.
const storageMap = new Serializer('account_storage_map', {
  remove: types.bool,
  catalog: types.string,
  key_values: types.map(types.string, types.optional(types.string)),
});

export function serializeAccountStorageMap(
  remove: boolean, catalog: string, keyValues: Array<[string, string]>,
): string {
  if (!catalog || Buffer.byteLength(catalog, 'utf8') > 200) throw new Error('存储目录长度无效');
  const payload = storageMap.toBuffer(storageMap.fromObject({
    remove, catalog,
    key_values: keyValues.map(([key, value]) => [key, remove ? undefined : value]),
  }));
  return Buffer.concat([Buffer.from([0]), payload]).toString('hex');
}

function sameValue(actual: unknown, expected: string): boolean {
  if (actual === expected) return true;
  try {
    const decoded = typeof actual === 'string' ? JSON.parse(actual) : actual;
    return JSON.stringify(decoded) === JSON.stringify(JSON.parse(expected));
  } catch {
    return false;
  }
}

export async function confirmStorageWrite(
  read: () => Promise<Array<{ key: string; value: unknown }>>,
  keyValues: Array<[string, string]>, remove: boolean,
  attempts = 5, delayMs = 1500,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const rows = await read();
      const matches = remove && keyValues.length === 0 ? rows.length === 0 : keyValues.every(([key, value]) => {
        const row = rows.find(item => item.key === key);
        return remove ? !row : !!row && sameValue(row.value, value);
      });
      if (matches) return true;
    } catch {
      // A failed read after broadcast is not proof that the transaction failed.
    }
    if (attempt + 1 < attempts) await new Promise<void>(resolve => setTimeout(() => resolve(), delayMs));
  }
  return false;
}

export class StorageConfirmationPendingError extends Error {
  constructor() {
    super('交易已广播，但节点暂未确认存储结果。请刷新确认，勿重复发布。');
    this.name = 'StorageConfirmationPendingError';
  }
}
