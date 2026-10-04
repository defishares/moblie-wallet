export type NetworkType = 'mainnet' | 'testnet';
export type ChannelType = 'hdextest' | 'hdextestadmin' | 'hdexmain' | 'hdexmainadmin';

export interface WsNodeConfig {
  name: string;
  url: string;
  group?: 'official' | 'community';
}

export interface NetworkConfig {
  type: NetworkType;
  name: string;
  wsNodes: WsNodeConfig[];
  defaultWsNode: string;
  coreAsset: string;
  coreAssetId: string;
  defaultQuoteAsset: string;
  chainId: string;
}

export interface ChannelConfig {
  type: ChannelType;
  appName: string;
  channelId: number;
  isAdminMode: boolean;
  onChainSettingsAccount: string;
  networkType: NetworkType;
}

export const MAINNET_CONFIG: NetworkConfig = {
  type: 'mainnet',
  name: 'DeFiShares',
  wsNodes: [
    { name: 'DeFiShares 官方节点', url: 'wss://api.defishares.org/ws/', group: 'official' },
    { name: 'DeFiShares 节点01', url: 'wss://api-01.defishares.org/ws/', group: 'official' },
    { name: '社区节点', url: 'wss://8.148.185.200:8008', group: 'community' },
  ],
  defaultWsNode: 'wss://api.defishares.org/ws/',
  coreAsset: 'DFS',
  coreAssetId: '1.3.0',
  defaultQuoteAsset: 'USDT',
  chainId: '7089639ad55d91ef53946f3fc4dc86ea5b8a4917edcfce6d3c39bc259657acb5',
};

export const TESTNET_CONFIG: NetworkConfig = {
  ...MAINNET_CONFIG,
  type: 'testnet',
  name: '测试网',
  defaultQuoteAsset: 'CNY',
};

export const NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
  mainnet: MAINNET_CONFIG,
  testnet: TESTNET_CONFIG,
};

export const CHANNEL_CONFIGS: Record<ChannelType, ChannelConfig> = {
  hdextest: {
    type: 'hdextest', appName: 'DefiShares测试网', channelId: 1001,
    isAdminMode: false, onChainSettingsAccount: '1.2.185991', networkType: 'testnet',
  },
  hdextestadmin: {
    type: 'hdextestadmin', appName: 'DefiShares管理(测)', channelId: 1001,
    isAdminMode: true, onChainSettingsAccount: '1.2.185991', networkType: 'testnet',
  },
  hdexmain: {
    type: 'hdexmain', appName: 'DefiShares', channelId: 1000,
    isAdminMode: false, onChainSettingsAccount: '1.2.185992', networkType: 'mainnet',
  },
  hdexmainadmin: {
    type: 'hdexmainadmin', appName: 'DefiShares管理(主)', channelId: 1000,
    isAdminMode: true, onChainSettingsAccount: '1.2.185992', networkType: 'mainnet',
  },
};

export const DEFAULT_MAINNET_MARKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['CNY', 'DFS'],
  ['CNY', 'GOLD'],
  ['CNY', 'USD'],
];

export interface RuntimeConfig {
  channel: ChannelConfig;
  network: NetworkConfig;
}

export function isChannelType(value: string | undefined): value is ChannelType {
  return Boolean(value && value in CHANNEL_CONFIGS);
}

export function resolveRuntimeConfig(channelValue?: string): RuntimeConfig {
  const channelType: ChannelType = isChannelType(channelValue) ? channelValue : 'hdexmain';
  const channel = CHANNEL_CONFIGS[channelType];
  return { channel, network: NETWORK_CONFIGS[channel.networkType] };
}
