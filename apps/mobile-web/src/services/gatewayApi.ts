const BASE = 'https://gate.defishares.org/bridge';
const BNB_CHAIN = 'BNBChain';
export interface BSCBridgeConfig { symbol: string; code: string; token: string; chain: string; chainId: number; contract: string; fundingAccount: string; assetId: string; precision: number; withdrawalAllowed: boolean; withdrawalMin?: number; withdrawalFee?: number; withdrawalFeeAsset?: string; tips?: string; }
export interface BSCDepositRoute { address: string; account: string; chain: string; token: string; contract: string; confirmations: number; minimum?: number; }
export interface BridgeHistoryRecord { type: string; time: string; address: string; amount: string; status: string; txid: string; }
async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
  try { const response = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(String(payload?.message || payload?.msg || `请求失败 (${response.status})`)); return payload as T; }
  catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') throw new Error('充值服务连接超时，请稍后重试'); throw cause; } finally { clearTimeout(timer); }
}
function coins(payload: any): any[] { return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : payload?.symbol ? [payload] : []; }
export const gatewayApi = {
  async getBSCConfig(): Promise<BSCBridgeConfig> {
    const coin = coins(await request('/api/nbs/coin')).find(item => String(item.symbol || '').toUpperCase() === 'USDT' || String(item.outputCoinType || '').toUpperCase() === 'USDT');
    if (!coin) throw new Error('bridge 未配置 USDT');
    return { symbol: coin.symbol, code: coin.code, token: coin.outputCoinType || coin.symbol, chain: coin.code || 'BSC', chainId: 56, contract: coin.coin_address, fundingAccount: coin.gatewayWallet || coin.wallet_address || 'dao-gate-hot-wallet', assetId: coin.asset_id, precision: Number(coin.precision), withdrawalAllowed: Boolean(coin.withdrawalAllowed), withdrawalMin: Number.isFinite(Number(coin.minAmount)) ? Number(coin.minAmount) : undefined, withdrawalFee: Number.isFinite(Number(coin.gateFee ?? coin.withdrawFee)) ? Number(coin.gateFee ?? coin.withdrawFee) : undefined, withdrawalFeeAsset: coin.symbol, tips: coin.withdrawlTips };
  },
  async checkBSCAddress(address: string, code = BNB_CHAIN): Promise<void> { const payload = await request<{ isValid?: boolean }>('/api/nbs/check-address', { address: address.trim(), inputCoinType: code }); if (!payload?.isValid) throw new Error('提币地址校验失败，请检查地址和网络'); },
  async getBSCDepositAddress(account: string): Promise<BSCDepositRoute> { const config = await this.getBSCConfig(); const payload = await request<any>('/api/nbs/wallet', { outputAddress: account.trim(), inputCoinType: BNB_CHAIN }); if (!payload?.inputAddress || !payload?.outputAddress) throw new Error('充值服务返回的地址无效'); return { address: payload.inputAddress, account: payload.outputAddress, chain: payload.inputCoinType || config.chain, token: payload.outputCoinType || config.token, contract: config.contract, confirmations: 20, minimum: config.withdrawalMin }; },
  async getBSCHistory(account: string): Promise<{ data: BridgeHistoryRecord[]; count: number; rangeDays: number }> { const payload = await request<any>('/api/nbs/history?account=' + encodeURIComponent(account.trim())); if (!Array.isArray(payload?.data)) throw new Error(payload?.msg || '读取充提记录失败'); return { data: payload.data, count: Number(payload.count || payload.data.length), rangeDays: Number(payload.range_days || 90) }; },
};
