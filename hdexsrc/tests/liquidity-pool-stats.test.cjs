const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadTs(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = new Module(filename, module);
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(compiled.outputText, filename);
  return mod.exports;
}

const { getLiquidityPoolMetrics } = loadTs('src/utils/liquidityPoolStats.ts');

test('uses chain statistics for 24h pool volume and price change', () => {
  const metrics = getLiquidityPoolMetrics({
    assetA: 'DFS',
    assetB: 'CNY',
    balanceA: 402215.88676,
    balanceB: 38139.37,
    precisionA: 5,
    precisionB: 2,
    statistics: {
      _24h_exchange_a2b_amount_a: '13097981000',
      _24h_exchange_b2a_amount_a: '7007900898',
      _24h_balance_delta_a: '6090080102',
      _24h_balance_delta_b: '-673359',
    },
  });

  assert.ok(Math.abs(metrics.volume24h - 201058.81898) < 1e-10);
  assert.ok(Math.abs(metrics.change24h - (-27.875127193393656)) < 1e-10);
});

test('does not invent values when a node omits pool statistics', () => {
  assert.deepEqual(getLiquidityPoolMetrics({
    assetA: 'DFS',
    assetB: 'CNY',
    balanceA: 1,
    balanceB: 1,
    precisionA: 5,
    precisionB: 2,
  }), { change24h: null, volume24h: null });
});

