const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Run the production TS helpers without React Native's device-only Jest setup.
function loadTs(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = new Module(filename, module);
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : originalRequire(name);
  mod._compile(compiled.outputText, filename);
  return mod.exports;
}
const { serializeAccountStorageMap, confirmStorageWrite } = loadTs('src/utils/accountStorage.ts');
const { readStorageFromNode, isStorageApiUnavailable } = loadTs('src/services/storage_rpc.ts');

test('account_storage_map binary fixtures include variant tag, bool, strings, map and optional', () => {
  assert.equal(serializeAccountStorageMap(false, 'c', [['k', 'v']]), '0000016301016b010176');
  assert.equal(serializeAccountStorageMap(true, 'c', [['k', '']]), '0001016301016b00');
  assert.equal(serializeAccountStorageMap(true, 'c', []), '0001016300');
});

test('Chinese data uses UTF-8 byte lengths, including emoji', () => {
  const { Serializer, types } = require('bitsharesjs');
  const decoder = new Serializer('map', {
    remove: types.bool, catalog: types.string, key_values: types.map(types.string, types.optional(types.string)),
  });
  const value = JSON.stringify([{ title: '公告 📣', content: '新增管理员' }]);
  const bytes = Buffer.from(serializeAccountStorageMap(false, '公告', [['公告列表', value]]), 'hex');
  assert.equal(bytes[0], 0);
  const decoded = decoder.fromBuffer(bytes.subarray(1));
  assert.equal(decoded.catalog.toString('utf8'), '公告');
  assert.equal(decoded.key_values[0][1].toString('utf8'), value);
});

test('broadcast readback waits for the exact new value and handles parsed JSON', async () => {
  let reads = 0;
  assert.equal(await confirmStorageWrite(async () => {
    reads++;
    return [{ key: 'k', value: reads < 3 ? [] : [{ title: '已发布' }] }];
  }, [['k', '[{"title":"已发布"}]']], false, 3, 0), true);
  assert.equal(reads, 3);
});

test('a stale result or an RPC error never becomes publication success', async () => {
  assert.equal(await confirmStorageWrite(async () => [], [['k', '[]']], false, 2, 0), false);
  assert.equal(await confirmStorageWrite(async () => { throw new Error('offline'); }, [['k', '[]']], false, 1, 0), false);
  assert.equal(await confirmStorageWrite(async () => [], [['k', '']], true, 1, 0), true);
});

function fakeSocket(handler) {
  const calls = [];
  let closed = false;
  return { calls, get closed() { return closed; }, Socket: class {
    constructor() { queueMicrotask(() => this.onopen?.({})); }
    send(text) {
      const request = JSON.parse(text);
      calls.push(request.params);
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, ...handler(request.params) }) }));
    }
    close() { closed = true; this.onclose?.({}); }
  } };
}
const goodReply = ([api, method]) => ({ result: ({
  login: true, database: 0, get_chain_id: 'same-chain', custom_operations: 4,
  get_storage_info: [{ key: 'announcements.v1', value: [] }],
})[method] });

test('fallback only reads storage and closes its own socket', async () => {
  const fixture = fakeSocket(goodReply);
  const original = global.WebSocket;
  global.WebSocket = fixture.Socket;
  try {
    const rows = await readStorageFromNode('wss://fixture', 'same-chain', '1.2.100', 'app.settings.v2');
    assert.equal(rows[0].key, 'announcements.v1');
    assert.deepEqual(fixture.calls.map(call => call[1]), ['login', 'database', 'get_chain_id', 'custom_operations', 'get_storage_info']);
    assert.deepEqual(fixture.calls.at(-1)[2], ['1.2.100', 'app.settings.v2']);
    assert.equal(fixture.closed, true);
  } finally { global.WebSocket = original; }
});

test('fallback refuses a different chain before requesting its storage', async () => {
  const fixture = fakeSocket(goodReply);
  const original = global.WebSocket;
  global.WebSocket = fixture.Socket;
  try {
    await assert.rejects(readStorageFromNode('wss://fixture', 'other-chain', '1.2.100', 'c'), /不同网络/);
    assert.equal(fixture.calls.some(call => call[1] === 'get_storage_info'), false);
    assert.equal(fixture.closed, true);
  } finally { global.WebSocket = original; }
});

test('node API denial is distinct from a signing/authority error', () => {
  assert.equal(isStorageApiUnavailable(new Error('Execution error: Assert Exception: is_allowed: Access denied')), true);
  assert.equal(isStorageApiUnavailable({ code: 1, message: 'Execution error: Assert Exception: is_allowed: Access denied' }), true);
  assert.equal(isStorageApiUnavailable('Execution error: Assert Exception: is_allowed: Access denied'), true);
  assert.equal(isStorageApiUnavailable(new Error('missing required active authority')), false);
  assert.equal(isStorageApiUnavailable({ message: 'missing required active authority' }), false);
  assert.equal(isStorageApiUnavailable(null), false);
});

test('service routes the actual SDK plain-object denial to the fallback without broadcasting', async () => {
  const fixture = fakeSocket(goodReply);
  const original = global.WebSocket;
  global.WebSocket = fixture.Socket;
  let primaryReads = 0;
  const apis = {
    chain_id: 'same-chain',
    ws_rpc: { call: async args => {
      assert.deepEqual(args, [1, 'custom_operations', []]);
      primaryReads++;
      throw { code: 1, message: 'Execution error: Assert Exception: is_allowed: Access denied' };
    } },
  };
  const { chainServiceMgr } = loadTs('src/services/chainservice_mgr.ts', {
    'bitsharesjs-ws': { Apis: { instance: () => apis } },
    '../config': {}, './local_cache_mgr': {}, '../utils/marketTicker': {},
    './storage_rpc': { readStorageFromNode, isStorageApiUnavailable },
    '../utils/accountStorage': loadTs('src/utils/accountStorage.ts'),
  });
  chainServiceMgr.isConnected = true;
  try {
    assert.equal((await chainServiceMgr.getStorageInfo('1.2.100', 'app.settings.v2'))[0].key, 'announcements.v1');
    assert.equal((await chainServiceMgr.getStorageInfo('1.2.100', 'app.settings.v2'))[0].key, 'announcements.v1');
    assert.equal(primaryReads, 1);
    assert.equal(fixture.calls.some(call => call[1].includes('broadcast')), false);
    assert.equal(fixture.closed, true);
  } finally { global.WebSocket = original; }
});

test('unresponsive fallback times out and closes', async () => {
  const original = global.WebSocket;
  let closed = false;
  global.WebSocket = class { close() { closed = true; } };
  try {
    await assert.rejects(readStorageFromNode('wss://fixture', 'same-chain', '1.2.100', 'c', 10), /超时/);
    assert.equal(closed, true);
  } finally { global.WebSocket = original; }
});
