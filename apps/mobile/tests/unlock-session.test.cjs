const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function fixture() {
  let now = 1700000000000;
  let nextTimer = 0;
  const timers = new Map();
  const globals = {
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    console: { log() {}, warn() {}, error() {} },
  };
  function load(relative, deps = {}) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
    });
    const exports = {};
    vm.runInNewContext(compiled.outputText, {
      ...globals, exports, require: name => {
        if (Object.hasOwn(deps, name)) return deps[name];
        throw new Error(`Unexpected dependency ${name}`);
      },
    });
    return exports;
  }
  const sessionModule = load('src/services/unlock_session.ts');
  const session = sessionModule.unlockSession;
  const stored = new Map();
  let reads = 0;
  const keychain = {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'unlocked' },
    ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'biometric' },
    BIOMETRY_TYPE: { FINGERPRINT: 'Fingerprint' },
    getSupportedBiometryType: async () => 'Fingerprint',
    getGenericPassword: async ({ service }) => { reads++; return stored.get(service) || false; },
    setGenericPassword: async (username, password, { service }) => { stored.set(service, { username, password }); return { service }; },
    resetGenericPassword: async ({ service }) => { stored.delete(service); return true; },
  };
  const { secureStorageService: secure } = load('src/services/secure_storage_service.ts', {
    'react-native-keychain': keychain,
    bitsharesjs: { hash: { sha256: value => crypto.createHash('sha256').update(value).digest() } },
    './unlock_session': sessionModule,
  });
  const { UnlockModal } = load('src/components/UnlockModal.tsx', {
    react: {},
    'react-native': { Dimensions: { get: () => ({ height: 800 }) }, StyleSheet: { create: value => value } },
    '@rneui/themed': {},
    'react-native-vector-icons/MaterialCommunityIcons': {},
    '../services/secure_storage_service': { secureStorageService: secure },
    '../services/unlock_session': sessionModule,
  });
  return {
    session, secure, UnlockModal, keychain, stored,
    get reads() { return reads; },
    get timerCount() { return timers.size; },
    ttl: sessionModule.UNLOCK_SESSION_TTL_MS,
    advance: ms => { now += ms; },
    runTimers: () => { for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
  };
}

test('unlock lasts exactly one hour; cache reads do not extend it, including after background suspension', () => {
  const f = fixture();
  f.session.markUnlocked('a', { active: 'test-active' });
  f.advance(f.ttl - 1);
  assert.equal(f.session.getKey('a', 'active'), 'test-active');
  f.advance(1); // Deliberately do not run the timer: background JS may be paused.
  assert.equal(f.session.getKeys('a'), null);
  assert.equal(f.timerCount, 0);
});

test('timer clears keys; a different account never inherits the unlock', () => {
  const f = fixture();
  f.session.markUnlocked('a', { active: 'test-active' });
  assert.equal(f.session.getKeys('b'), null);
  f.advance(f.ttl);
  f.runTimers();
  assert.equal(f.session.isActive('a'), false);
});

test('new authentication replaces old keys and callers cannot mutate the stored session', () => {
  const f = fixture();
  f.session.markUnlocked('a', { active: 'old', owner: 'old-owner' });
  f.advance(f.ttl);
  f.session.markUnlocked('a', { active: 'new' });
  const keys = f.session.getKeys('a');
  keys.active = 'mutated';
  assert.equal(f.session.getKey('a', 'active'), 'new');
  assert.equal(f.session.getKey('a', 'owner'), undefined);
  f.session.clear('a');
  assert.equal(f.session.getKeys('a'), null);
  assert.equal(f.timerCount, 0);
});

test('clock rollback expires the session', () => {
  const f = fixture();
  f.session.markUnlocked('a', { active: 'test-active' });
  f.advance(-1);
  assert.equal(f.session.isActive('a'), false);
});

test('PIN success from a single-key caller shares all keys across the global modal and biometric callers', async () => {
  const f = fixture();
  assert.equal(await f.secure.initializeAccount('a', 'TestPin!135790', { active: 'test-active', memo: 'test-memo' }), true);
  assert.equal((await f.secure.retrievePrivateKeyWithPin('a', 'wrong')).success, false);
  assert.equal(f.session.isActive('a'), false);
  assert.equal((await f.secure.retrievePrivateKeyWithPin('a', 'TestPin!135790')).privateKey, 'test-active');
  const reads = f.reads;
  const result = await f.secure.retrieveAllKeysWithBiometric('a');
  assert.equal(result.keys.memo, 'test-memo');
  let unlocked;
  f.UnlockModal.show({ accountId: 'a', accountName: 'test', onSuccess: keys => { unlocked = keys; } });
  assert.equal(unlocked.active, 'test-active'); // Works without showing an authentication modal.
  assert.equal(f.reads, reads);
  f.advance(f.ttl);
  assert.equal((await f.secure.retrieveAllKeysWithPin('a', '')).success, false);
});

test('biometric success shares the session with PIN and smart-unlock callers', async () => {
  const f = fixture();
  f.stored.set('com.hdex.wallet.biometric.a', { username: 'a', password: JSON.stringify({ active: 'test-active' }) });
  assert.equal((await f.secure.retrieveAllKeysWithBiometric('a')).success, true);
  const reads = f.reads;
  assert.equal((await f.secure.retrievePrivateKeyWithPin('a', '')).privateKey, 'test-active');
  assert.equal((await f.secure.smartUnlock('a', 'active', false)).usedMethod, 'session');
  assert.equal((await f.secure.smartUnlockAllKeys('a', false)).keys.active, 'test-active');
  assert.equal(f.reads, reads);
});

test('failed biometric authentication never creates an unlocked session', async () => {
  const f = fixture();
  f.keychain.getGenericPassword = async () => { throw new Error('User canceled'); };
  assert.equal((await f.secure.retrieveAllKeysWithBiometric('a')).success, false);
  assert.equal(f.session.isActive('a'), false);
});

test('PIN verification starts the same session; deleting or replacing credentials invalidates it', async () => {
  const f = fixture();
  await f.secure.initializeAccount('a', 'TestPin!135790', { active: 'test-active' });
  assert.equal(await f.secure.verifyPin('a', 'TestPin!135790'), true);
  assert.equal(f.session.isActive('a'), true);
  await f.secure.initializeAccount('a', 'TestPin!246801', { active: 'replacement' });
  assert.equal(f.session.isActive('a'), false);
  assert.equal(await f.secure.verifyPin('a', 'TestPin!246801'), true);
  await f.secure.clearAccountSecureData('a');
  assert.equal(f.session.isActive('a'), false);
  assert.equal((await f.secure.retrieveAllKeysWithPin('a', 'TestPin!246801')).success, false);
});
