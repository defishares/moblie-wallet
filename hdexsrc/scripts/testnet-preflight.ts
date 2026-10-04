import { GrapheneRpcClient } from '@defishares/core';

/**
 * Non-mutating Testnet gate. It deliberately does not sign or broadcast.
 * The full write checklist remains in docs/web-release-runbook.md.
 */
const nodeUrl = process.env.E2E_WS_NODE?.trim();
const chainId = process.env.E2E_CHAIN_ID?.trim();
const account = process.env.E2E_ACCOUNT?.trim();

if (!nodeUrl || !chainId) {
  console.error('Missing E2E_WS_NODE or E2E_CHAIN_ID; refusing to substitute the mainnet node.');
  process.exit(2);
}

async function main(): Promise<void> {
  const client = new GrapheneRpcClient({ requestTimeoutMs: 15_000 });
  try {
    const connection = await client.connect(nodeUrl, chainId);
    const [globals, pools, accountRows] = await Promise.all([
      client.getDynamicGlobalProperties(),
      client.getLiquidityPools(20),
      account ? client.getFullAccounts([account]) : Promise.resolve([]),
    ]);

    if (account && !accountRows[0]?.[1]?.account) {
      throw new Error(`Testnet account not found: ${account}`);
    }

    console.log(JSON.stringify({
      ok: true,
      node: connection.url,
      chainId: connection.chainId,
      latencyMs: connection.latency,
      headBlock: globals.head_block_number,
      poolCount: pools.length,
      account: accountRows[0]?.[1]?.account?.name ?? null,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

void main();
