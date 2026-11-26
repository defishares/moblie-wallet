import test from 'node:test';
import assert from 'node:assert/strict';
import { decimalToAtomic, normalizeGrapheneTicker } from '@defishares/core';

// Cross-platform vectors: RN imports the same @defishares/core implementation
// that powers the Web package, so these values are the compatibility contract.
test('RN/Web ticker vector stays identical', () => {
  assert.deepEqual(
    normalizeGrapheneTicker({
      latest: '2',
      lowest_ask: '1.9',
      highest_bid: '2.1',
      percent_change: '10',
    }),
    {
      latest: '0.5',
      lowest_ask: String(1 / 2.1),
      highest_bid: String(1 / 1.9),
      percent_change: String((-10 / 110) * 100),
    },
  );
});

test('RN/Web decimal precision vector stays identical', () => {
  assert.equal(decimalToAtomic('123.45678', 5), '12345678');
});
