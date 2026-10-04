import type { StorageAdapter } from '@defishares/core';

const DATABASE_NAME = 'defishares-web';
const STORE_NAME = 'key-value';

export class IndexedDbStorage implements StorageAdapter {
  private readonly dbPromise: Promise<IDBDatabase>;

  constructor(namespace: string) {
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(`${DATABASE_NAME}-${namespace}`, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 初始化失败'));
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const result = await this.request<T | undefined>('readonly', store => store.get(key));
    return result ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.request('readwrite', store => store.put(value, key));
  }

  async remove(key: string): Promise<void> {
    await this.request('readwrite', store => store.delete(key));
  }

  async clear(): Promise<void> {
    await this.request('readwrite', store => store.clear());
  }

  private async request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.dbPromise;
    return new Promise<T>((resolve, reject) => {
      const request = operation(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
    });
  }
}
