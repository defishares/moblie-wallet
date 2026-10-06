import { resolveRuntimeConfig } from '@defishares/core';

export const runtimeConfig = resolveRuntimeConfig(import.meta.env.VITE_CHANNEL_TYPE);
// The selected channel owns the node list in both development and production.
// A proxy is opt-in so a test channel can never silently fall back to the
// mainnet `/ws` target.
const configuredNodes = runtimeConfig.network.wsNodes.map(node => node.url);
const proxyNode = import.meta.env.VITE_WS_PROXY_URL?.trim();
export const webSocketNodes = proxyNode ? [proxyNode, ...configuredNodes] : configuredNodes;
export const webSocketNodeConfigs = [
  ...(proxyNode ? [{ name: '本地代理节点', url: proxyNode, group: 'official' as const }] : []),
  ...runtimeConfig.network.wsNodes,
];
export const defaultPairs = [
  { base: 'DFS', quote: 'CNY' },
  { base: 'GOLD', quote: 'CNY' },
  { base: 'USD', quote: 'CNY' },
];
