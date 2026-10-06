import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicToDecimal, decimalToAtomic, marketKey, minimumReceiveWithSlippage, normalizeGrapheneTicker, normalizeTicker, resolveRuntimeConfig } from '../src/index';

test('runtime channel determines the same network as mobile configuration', () => {
  assert.equal(resolveRuntimeConfig('hdexmain').network.type, 'mainnet');
  assert.equal(resolveRuntimeConfig('hdextestadmin').network.type, 'testnet');
  assert.equal(resolveRuntimeConfig('invalid').channel.type, 'hdexmain');
});

test('market identity and ticker normalization are deterministic', () => {
  const pair = { base: 'DFS', quote: 'CNY' };
  assert.equal(marketKey(pair), 'DFS_CNY');
  assert.deepEqual(normalizeTicker(pair, {
    latest: '1.25', percent_change: '-2.5', base_volume: '100', quote_volume: '125',
    highest_bid: '1.24', lowest_ask: '1.26',
  }), {
    ...pair, key: 'DFS_CNY', latest: 0.8, change24h: 2.564102564102564,
    baseVolume: 100, quoteVolume: 125, highestBid: 0.7936507936507936, lowestAsk: 0.8064516129032259,
  });
});

test('RN and Web share Graphene ticker inversion rules', () => {
  assert.deepEqual(normalizeGrapheneTicker({ latest: '2', lowest_ask: '1.9', highest_bid: '2.1', percent_change: '10' }), {
    latest: '0.5', lowest_ask: String(1 / 2.1), highest_bid: String(1 / 1.9), percent_change: String((-10 / 110) * 100),
  });
});

test('atomic amounts use asset precision', () => {
  assert.equal(atomicToDecimal('123456', 5), 1.23456);
  assert.equal(atomicToDecimal(1250, 2), 12.5);
});

test('decimal transfer amounts preserve precision without floating point rounding', () => {
  assert.equal(decimalToAtomic('1.2345', 5), '123450');
  assert.equal(decimalToAtomic('0.01', 2), '1');
  assert.throws(() => decimalToAtomic('1.001', 2), /最多支持/);
  assert.throws(() => decimalToAtomic('0', 2), /大于 0/);
});

test('minimum receive floors small quotes instead of rounding them up', () => {
  assert.equal(minimumReceiveWithSlippage(0.1004, 2), '0.09');
  assert.equal(minimumReceiveWithSlippage(12.3456, 2), '12.28');
  assert.equal(minimumReceiveWithSlippage(0.0001, 2), '');
});
