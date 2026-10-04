import {
  atomicToDecimal,
  normalizeTicker,
  type AccountAssetBalance,
  type AccountHistoryEntry,
  type AccountOrder,
  type CancelOrderPreview,
  type AssetObject,
  decimalToAtomic,
  type FullAccountData,
  type LimitOrderPreview,
  type KLineData,
  type LendingOverview,
  type LendingPreview,
  type LiquidityOperation,
  type LiquidityPool,
  type LiquidityPreview,
  type MarketPair,
  type MarketTrade,
  type MarketTicker,
  type OrderBookData,
  type TickerData,
  type TransferPreview,
} from '../domain';

type ApiName = 'database' | 'history' | 'network_broadcast' | 'custom_operations';

interface RpcReply {
  id?: number;
  result?: unknown;
  error?: { message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ConnectResult {
  url: string;
  chainId: string;
  latency: number;
}

export interface GrapheneRpcClientOptions {
  requestTimeoutMs?: number;
  WebSocketImpl?: typeof WebSocket;
}

const apiIdDefaults: Record<ApiName, number | null> = {
  database: null,
  history: null,
  network_broadcast: null,
  custom_operations: null,
};

export class GrapheneRpcClient {
  private socket: WebSocket | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private apiIds: Record<ApiName, number | null> = { ...apiIdDefaults };
  private readonly requestTimeoutMs: number;
  private readonly WebSocketImpl: typeof WebSocket;
  private connectedUrl: string | null = null;
  private closedByClient = false;

  constructor(options: GrapheneRpcClientOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 12_000;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  }

  get url(): string | null {
    return this.connectedUrl;
  }

  get isConnected(): boolean {
    return this.socket?.readyState === this.WebSocketImpl.OPEN;
  }

  async connect(url: string, expectedChainId?: string): Promise<ConnectResult> {
    await this.disconnect();
    const startedAt = performance.now();
    this.closedByClient = false;

    const socket = new this.WebSocketImpl(this.resolveWebSocketUrl(url));
    this.socket = socket;
    socket.addEventListener('message', event => { void this.handleMessage(event); });
    socket.addEventListener('close', () => this.handleClose());

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('节点连接超时')), this.requestTimeoutMs);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('节点连接失败'));
      }, { once: true });
    });

    await this.rawCall(1, 'login', ['', '']);
    this.apiIds.database = await this.resolveApi('database', true);
    this.apiIds.history = await this.resolveApi('history', false);
    this.apiIds.network_broadcast = await this.resolveApi('network_broadcast', false);
    this.apiIds.custom_operations = await this.resolveApi('custom_operations', false);

    const chainId = await this.db<string>('get_chain_id');
    if (expectedChainId && chainId !== expectedChainId) {
      await this.disconnect();
      throw new Error('节点链 ID 与当前网络不匹配');
    }

    this.connectedUrl = url;
    return { url, chainId, latency: Math.max(1, Math.round(performance.now() - startedAt)) };
  }

  async connectWithFallback(urls: string[], expectedChainId?: string): Promise<ConnectResult> {
    let lastError: unknown = new Error('没有可用节点');
    for (const url of urls) {
      try {
        return await this.connect(url, expectedChainId);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async disconnect(): Promise<void> {
    this.closedByClient = true;
    const socket = this.socket;
    this.socket = null;
    this.connectedUrl = null;
    this.apiIds = { ...apiIdDefaults };
    this.rejectAll(new Error('连接已关闭'));
    if (socket && socket.readyState < this.WebSocketImpl.CLOSING) socket.close();
  }

  async db<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.apiCall<T>('database', method, params);
  }

  async history<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.apiCall<T>('history', method, params);
  }

  async custom<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.apiCall<T>('custom_operations', method, params);
  }

  async getTickers(pairs: MarketPair[]): Promise<MarketTicker[]> {
    const results = await Promise.allSettled(
      pairs.map(async pair => normalizeTicker(pair, await this.db<TickerData>('get_ticker', [pair.base, pair.quote]))),
    );
    return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  }

  async getOrderBook(base: string, quote: string, limit = 30): Promise<OrderBookData> {
    const assets = await this.lookupAssets([base, quote]);
    const baseAsset = assets[0];
    const quoteAsset = assets[1];
    if (!baseAsset || !quoteAsset) throw new Error('交易对资产不存在');

    // The mobile app uses get_limit_orders and interprets the sell side
    // explicitly. Keeping the same direction here avoids the common
    // get_order_book base/quote inversion when presenting bids and asks.
    const orders = await this.db<Array<Record<string, any>>>('get_limit_orders', [quoteAsset.id, baseAsset.id, limit]);
    const bids: Array<{ price: number; quote: number; base: number }> = [];
    const asks: Array<{ price: number; quote: number; base: number }> = [];
    for (const order of orders) {
      const sellPrice = order.sell_price;
      if (!sellPrice?.base || !sellPrice?.quote) continue;
      const sellBase = atomicToDecimal(sellPrice.base.amount, sellPrice.base.asset_id === baseAsset.id ? baseAsset.precision : quoteAsset.precision);
      const receiveQuote = atomicToDecimal(sellPrice.quote.amount, sellPrice.quote.asset_id === quoteAsset.id ? quoteAsset.precision : baseAsset.precision);
      if (!sellBase || !receiveQuote) continue;
      const isBid = sellPrice.base.asset_id === quoteAsset.id;
      const price = isBid ? sellBase / receiveQuote : receiveQuote / sellBase;
      const amount = atomicToDecimal(order.for_sale, isBid ? quoteAsset.precision : baseAsset.precision);
      const row = {
        price,
        quote: isBid ? amount : amount * price,
        base: isBid ? amount / price : amount,
      };
      (isBid ? bids : asks).push(row);
    }
    bids.sort((a, b) => b.price - a.price);
    asks.sort((a, b) => a.price - b.price);
    return { bids, asks };
  }

  lookupAssets(symbolsOrIds: string[]): Promise<Array<AssetObject | null>> {
    return this.db<Array<AssetObject | null>>('lookup_asset_symbols', [symbolsOrIds]);
  }

  getFullAccounts(namesOrIds: string[]): Promise<Array<[string, FullAccountData]>> {
    return this.db<Array<[string, FullAccountData]>>('get_full_accounts', [namesOrIds, false]);
  }

  async getTransferPreview(params: {
    fromAccountNameOrId: string;
    toAccountNameOrId: string;
    assetSymbolOrId: string;
    amount: string;
    feeAssetId?: string;
    memo?: string;
  }): Promise<TransferPreview> {
    const fromRows = await this.getFullAccounts([params.fromAccountNameOrId]);
    const toRows = await this.getFullAccounts([params.toAccountNameOrId]);
    const from = fromRows[0]?.[1]?.account;
    const to = toRows[0]?.[1]?.account;
    if (!from) throw new Error('发送账户不存在');
    if (!to) throw new Error('收款账户不存在');
    if (from.id === to.id) throw new Error('不能给自己转账');

    const asset = (await this.lookupAssets([params.assetSymbolOrId]))[0];
    if (!asset) throw new Error('转账资产不存在');
    const feeAssetId = params.feeAssetId ?? '1.3.0';
    const feeAsset = (await this.lookupAssets([feeAssetId]))[0];
    if (!feeAsset) throw new Error('手续费资产不存在');
    const atomicAmount = decimalToAtomic(params.amount, asset.precision);
    const sourceBalance = (fromRows[0]?.[1]?.balances ?? []).find(item => item.asset_type === asset.id);
    if (!sourceBalance || BigInt(String(sourceBalance.balance)) < BigInt(atomicAmount)) throw new Error('余额不足');
    const memo = params.memo?.trim() || undefined;
    const toMemoKey = to.options?.memo_key;
    if (memo && !toMemoKey) throw new Error('备注加密失败：缺少接收方公钥信息');
    const operation: Record<string, unknown> = {
      fee: { amount: 0, asset_id: feeAsset.id },
      from: from.id,
      to: to.id,
      amount: { amount: atomicAmount, asset_id: asset.id },
      extensions: [],
    };
    // Graphene's wire format uses the numeric operation id (transfer = 0),
    // matching TransactionBuilder.add_type_operation('transfer', ...).
    const feeRows = await this.db<Array<{ amount: string | number; asset_id: string }>>('get_required_fees', [[[0, operation]], feeAsset.id]);
    const fee = feeRows[0];
    if (!fee || fee.amount == null || fee.asset_id !== feeAsset.id) throw new Error('节点未返回有效手续费');
    const feeBalance = (fromRows[0]?.[1]?.balances ?? []).find(item => item.asset_type === feeAsset.id);
    if (feeAsset.id !== asset.id && (!feeBalance || BigInt(String(feeBalance.balance)) <= 0n)) throw new Error(`${feeAsset.symbol}余额不足以支付手续费`);
    const atomicFee = String(fee.amount);
    return {
      from: { id: from.id, name: from.name },
      to: { id: to.id, name: to.name },
      amount: { atomic: atomicAmount, value: atomicToDecimal(atomicAmount, asset.precision), symbol: asset.symbol, assetId: asset.id, precision: asset.precision },
      fee: { atomic: atomicFee, value: atomicToDecimal(atomicFee, feeAsset.precision), symbol: feeAsset.symbol, assetId: feeAsset.id, precision: feeAsset.precision },
      operation,
      memo,
      toMemoKey,
    };
  }

  async getDynamicGlobalProperties(): Promise<{
    head_block_number: number;
    head_block_id: string;
    time: string;
  }> {
    return this.db('get_dynamic_global_properties');
  }

  async getLimitOrderPreview(params: {
    accountNameOrId: string;
    baseSymbolOrId: string;
    quoteSymbolOrId: string;
    side: 'buy' | 'sell';
    amount: string;
    price: string;
    feeAssetId?: string;
  }): Promise<LimitOrderPreview> {
    const rows = await this.getFullAccounts([params.accountNameOrId]);
    const fullAccount = rows[0]?.[1];
    const account = fullAccount?.account;
    if (!account) throw new Error('账户不存在');
    const assets = await this.lookupAssets([params.baseSymbolOrId, params.quoteSymbolOrId]);
    const base = assets[0];
    const quote = assets[1];
    if (!base || !quote) throw new Error('交易对资产不存在');
    const amountNumber = Number(params.amount);
    const priceNumber = Number(params.price);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) throw new Error('请输入有效的数量');
    if (!Number.isFinite(priceNumber) || priceNumber <= 0) throw new Error('请输入有效的价格');
    const sellSymbol = params.side === 'buy' ? quote.symbol : base.symbol;
    const receiveSymbol = params.side === 'buy' ? base.symbol : quote.symbol;
    const sellAsset = params.side === 'buy' ? quote : base;
    const receiveAsset = params.side === 'buy' ? base : quote;
    const sellValue = params.side === 'buy' ? amountNumber * priceNumber : amountNumber;
    const receiveValue = params.side === 'buy' ? amountNumber : amountNumber * priceNumber;
    const sellAtomic = String(Math.round(sellValue * 10 ** sellAsset.precision));
    const receiveAtomic = String(Math.round(receiveValue * 10 ** receiveAsset.precision));
    const balance = (fullAccount.balances ?? []).find(item => item.asset_type === sellAsset.id);
    if (!balance || BigInt(String(balance.balance)) < BigInt(sellAtomic)) throw new Error(`${sellSymbol}余额不足`);
    const feeAssetId = params.feeAssetId ?? '1.3.0';
    const feeAsset = (await this.lookupAssets([feeAssetId]))[0];
    if (!feeAsset) throw new Error('手续费资产不存在');
    const operation: Record<string, unknown> = {
      fee: { amount: 0, asset_id: feeAsset.id },
      seller: account.id,
      amount_to_sell: { amount: sellAtomic, asset_id: sellAsset.id },
      min_to_receive: { amount: receiveAtomic, asset_id: receiveAsset.id },
      expiration: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 19),
      fill_or_kill: false,
      extensions: [],
    };
    const fees = await this.db<Array<{ amount: string | number; asset_id: string }>>('get_required_fees', [[[1, operation]], feeAsset.id]);
    const fee = fees[0];
    if (!fee || fee.amount == null || fee.asset_id !== feeAsset.id) throw new Error('节点未返回有效手续费');
    const feeBalance = (fullAccount.balances ?? []).find(item => item.asset_type === feeAsset.id);
    if (feeAsset.id !== sellAsset.id && (!feeBalance || BigInt(String(feeBalance.balance)) <= 0n)) throw new Error(`${feeAsset.symbol}余额不足以支付手续费`);
    return {
      account: { id: account.id, name: account.name }, side: params.side,
      base: { id: base.id, symbol: base.symbol, precision: base.precision },
      quote: { id: quote.id, symbol: quote.symbol, precision: quote.precision },
      price: priceNumber, amount: amountNumber,
      sell: { atomic: sellAtomic, value: atomicToDecimal(sellAtomic, sellAsset.precision), symbol: sellSymbol, assetId: sellAsset.id, precision: sellAsset.precision },
      receive: { atomic: receiveAtomic, value: atomicToDecimal(receiveAtomic, receiveAsset.precision), symbol: receiveSymbol, assetId: receiveAsset.id, precision: receiveAsset.precision },
      fee: { atomic: String(fee.amount), value: atomicToDecimal(fee.amount, feeAsset.precision), symbol: feeAsset.symbol, assetId: feeAsset.id, precision: feeAsset.precision },
      operation,
    };
  }

  async getCancelOrderPreview(accountNameOrId: string, orderId: string, feeAssetId = '1.3.0'): Promise<CancelOrderPreview> {
    const rows = await this.getFullAccounts([accountNameOrId]);
    const fullAccount = rows[0]?.[1];
    const account = fullAccount?.account;
    if (!account) throw new Error('账户不存在');
    const ownsOrder = (fullAccount.limit_orders ?? []).some((item: any) => item?.id === orderId);
    if (!ownsOrder) throw new Error('委托不存在或不属于当前账户');
    const feeAsset = (await this.lookupAssets([feeAssetId]))[0];
    if (!feeAsset) throw new Error('手续费资产不存在');
    const operation: Record<string, unknown> = { fee: { amount: 0, asset_id: feeAsset.id }, fee_paying_account: account.id, order: orderId, extensions: [] };
    const fees = await this.db<Array<{ amount: string | number; asset_id: string }>>('get_required_fees', [[[2, operation]], feeAsset.id]);
    const fee = fees[0];
    if (!fee || fee.amount == null || fee.asset_id !== feeAsset.id) throw new Error('节点未返回有效手续费');
    return { account: { id: account.id, name: account.name }, orderId, fee: { atomic: String(fee.amount), value: atomicToDecimal(fee.amount, feeAsset.precision), symbol: feeAsset.symbol, assetId: feeAsset.id, precision: feeAsset.precision }, operation };
  }

  async getObjects<T>(ids: string[]): Promise<Array<T | null>> {
    return this.db<Array<T | null>>('get_objects', [ids]);
  }

  async getLendingOverview(accountNameOrId: string): Promise<LendingOverview> {
    const rows = await this.getFullAccounts([accountNameOrId]);
    const fullAccount = rows[0]?.[1];
    const account = fullAccount?.account;
    if (!account) throw new Error('账户不存在');
    const dfs = (await this.lookupAssets(['DFS']))[0];
    if (!dfs) throw new Error('暂未找到 DFS 资产，请检查节点连接');
    const callOrders = Array.isArray(fullAccount.call_orders) ? fullAccount.call_orders as Array<any> : [];
    const debtIds = [...new Set(callOrders.map(order => order.call_price?.quote?.asset_id).filter((id): id is string => typeof id === 'string'))];
    const debtAssets = debtIds.length ? await this.lookupAssets(debtIds) : [];
    const byId = new Map(debtAssets.filter((asset): asset is AssetObject => Boolean(asset)).map(asset => [asset.id, asset]));
    const bitassetIds = [...new Set(debtAssets.flatMap(asset => asset?.bitasset_data_id ? [asset.bitasset_data_id] : []))];
    const bitassets = bitassetIds.length ? await this.getObjects<any>(bitassetIds) : [];
    const bitByAsset = new Map(bitassets.filter(Boolean).map(item => [item.asset_id, item]));
    const feedFor = (asset: AssetObject, suppliedBitasset?: any): { price: number; ratio: number } => {
      const bitasset = suppliedBitasset ?? bitByAsset.get(asset.id);
      const price = bitasset?.current_feed?.settlement_price;
      if (!price?.base || !price.quote) return { price: 0, ratio: 0 };
      const baseAmount = atomicToDecimal(price.base.amount, price.base.asset_id === asset.id ? asset.precision : dfs.precision);
      const quoteAmount = atomicToDecimal(price.quote.amount, price.quote.asset_id === asset.id ? asset.precision : dfs.precision);
      const debtPerDfs = price.base.asset_id === asset.id && price.quote.asset_id === dfs.id ? baseAmount / quoteAmount : price.base.asset_id === dfs.id && price.quote.asset_id === asset.id ? quoteAmount / baseAmount : 0;
      return { price: Number.isFinite(debtPerDfs) && debtPerDfs > 0 ? debtPerDfs : 0, ratio: Number(bitasset?.current_feed?.initial_collateral_ratio ?? 2000) / 10 };
    };
    const positions = callOrders.flatMap(order => {
      const debtId = order.call_price?.quote?.asset_id;
      const debtAsset = debtId ? byId.get(debtId) : undefined;
      if (!order.id || !debtAsset || order.call_price?.base?.asset_id !== dfs.id) return [];
      const feed = feedFor(debtAsset);
      return [{ id: order.id, debtAsset: { id: debtAsset.id, symbol: debtAsset.symbol, precision: debtAsset.precision }, collateral: atomicToDecimal(order.collateral, dfs.precision), debt: atomicToDecimal(order.debt, debtAsset.precision), feedPrice: feed.price, initialCollateralRatio: feed.ratio }];
    });
    let listedAssets: AssetObject[] = [];
    try { listedAssets = await this.db<AssetObject[]>('list_assets', ['', 100]); } catch { /* old nodes may not support empty lower bound */ }
    const fallbackAssets = await this.lookupAssets(['USDT', 'CNY', 'GOLD', 'USD', 'BTC', 'ETH']);
    const candidateMap = new Map<string, AssetObject>();
    [...listedAssets, ...fallbackAssets, ...debtAssets].forEach(asset => { if (asset && asset.id !== dfs.id && asset.bitasset_data_id) candidateMap.set(asset.id, asset); });
    const candidates = [...candidateMap.values()];
    const candidateBitassets = candidates.length ? await this.getObjects<any>(candidates.map(asset => asset.bitasset_data_id!)) : [];
    const borrowAssets = candidates.flatMap(asset => {
      const bitasset = candidateBitassets.find(item => item?.asset_id === asset.id);
      if (bitasset?.options?.short_backing_asset !== dfs.id) return [];
      const feed = feedFor(asset, bitasset);
      return feed.price > 0 ? [{ id: asset.id, symbol: asset.symbol, precision: asset.precision, feedPrice: feed.price, initialCollateralRatio: feed.ratio }] : [];
    });
    return { account: { id: account.id, name: account.name }, collateralAsset: { id: dfs.id, symbol: dfs.symbol, precision: dfs.precision }, borrowAssets, positions };
  }

  async getLendingPreview(params: { accountNameOrId: string; debtAssetSymbolOrId: string; targetCollateral: string; targetDebt: string; feeAssetId?: string }): Promise<LendingPreview> {
    const overview = await this.getLendingOverview(params.accountNameOrId);
    const debtAsset = (await this.lookupAssets([params.debtAssetSymbolOrId]))[0];
    if (!debtAsset || debtAsset.id === overview.collateralAsset.id) throw new Error('暂无可借资产');
    const targetCollateral = Number(params.targetCollateral);
    const targetDebt = Number(params.targetDebt);
    const current = overview.positions.find(position => position.debtAsset.id === debtAsset.id);
    const isClose = params.targetCollateral.trim() === '0' && params.targetDebt.trim() === '0' && Boolean(current);
    if (!Number.isFinite(targetCollateral) || (targetCollateral <= 0 && !isClose)) throw new Error('请输入调整后的 DFS 抵押数量');
    if (!Number.isFinite(targetDebt) || (targetDebt <= 0 && !isClose)) throw new Error('请输入借款数量');
    const collateralTargetAtomic = isClose ? 0n : BigInt(decimalToAtomic(params.targetCollateral, overview.collateralAsset.precision));
    const debtTargetAtomic = isClose ? 0n : BigInt(decimalToAtomic(params.targetDebt, debtAsset.precision));
    const currentCollateralAtomic = current ? BigInt(Math.round(current.collateral * 10 ** overview.collateralAsset.precision)) : 0n;
    const currentDebtAtomic = current ? BigInt(Math.round(current.debt * 10 ** debtAsset.precision)) : 0n;
    const collateralDelta = collateralTargetAtomic - currentCollateralAtomic;
    const debtDelta = debtTargetAtomic - currentDebtAtomic;
    if (collateralDelta === 0n && debtDelta === 0n) throw new Error('仓位没有变化');
    const balance = (await this.getFullAccounts([params.accountNameOrId]))[0]?.[1]?.balances ?? [];
    if (collateralDelta > 0n) {
      const dfsBalance = balance.find(item => item.asset_type === overview.collateralAsset.id);
      if (!dfsBalance || BigInt(String(dfsBalance.balance)) < collateralDelta) throw new Error('DFS 可用余额不足');
    }
    if (debtDelta < 0n) {
      const debtBalance = balance.find(item => item.asset_type === debtAsset.id);
      if (!debtBalance || BigInt(String(debtBalance.balance)) < -debtDelta) throw new Error(`${debtAsset.symbol} 可用余额不足，无法偿还`);
    }
    const feed = overview.borrowAssets.find(asset => asset.id === debtAsset.id) ?? (current ? { feedPrice: current.feedPrice, initialCollateralRatio: current.initialCollateralRatio } : null);
    const ratio = feed && targetDebt > 0 ? (targetCollateral * feed.feedPrice / targetDebt) * 100 : 0;
    if (!isClose && (debtDelta > 0n || collateralDelta < 0n) && feed && ratio > 0 && ratio < feed.initialCollateralRatio) throw new Error(`抵押率仅 ${ratio.toFixed(1)}%，必须达到开仓线 ${feed.initialCollateralRatio.toFixed(0)}%`);
    const feeAssetId = params.feeAssetId ?? '1.3.0';
    const feeAsset = (await this.lookupAssets([feeAssetId]))[0];
    if (!feeAsset) throw new Error('手续费资产不存在');
    const operation: Record<string, unknown> = { fee: { amount: 0, asset_id: feeAsset.id }, funding_account: overview.account.id, delta_collateral: { amount: String(collateralDelta), asset_id: overview.collateralAsset.id }, delta_debt: { amount: String(debtDelta), asset_id: debtAsset.id }, extensions: [] };
    const fees = await this.db<Array<{ amount: string | number; asset_id: string }>>('get_required_fees', [[[3, operation]], feeAsset.id]);
    const fee = fees[0];
    if (!fee || fee.amount == null || fee.asset_id !== feeAsset.id) throw new Error('节点未返回有效手续费');
    return { account: overview.account, debtAsset: { id: debtAsset.id, symbol: debtAsset.symbol, precision: debtAsset.precision }, targetCollateral, targetDebt, collateralDelta: String(collateralDelta), debtDelta: String(debtDelta), fee: { atomic: String(fee.amount), value: atomicToDecimal(fee.amount, feeAsset.precision), symbol: feeAsset.symbol, assetId: feeAsset.id, precision: feeAsset.precision }, operation };
  }

  async getLiquidityPools(limit = 100): Promise<LiquidityPool[]> {
    const rows = await this.db<Array<Record<string, any>>>('list_liquidity_pools', [limit, null, true]);
    const ids = [...new Set(rows.flatMap(row => [row.asset_a, row.asset_b, row.share_asset]).filter(Boolean))];
    const assets = await this.lookupAssets(ids);
    const byId = new Map(assets.filter((asset): asset is AssetObject => Boolean(asset)).map(asset => [asset.id, asset]));
    return rows.flatMap(row => {
      const assetA = byId.get(row.asset_a);
      const assetB = byId.get(row.asset_b);
      const shareAsset = byId.get(row.share_asset);
      if (!row.id || !assetA || !assetB || !shareAsset) return [];
      const balanceA = atomicToDecimal(row.balance_a ?? 0, assetA.precision);
      const balanceB = atomicToDecimal(row.balance_b ?? 0, assetB.precision);
      const statistics = row.statistics as Record<string, string | number> | undefined;
      const amountFromChain = (value: string | number | undefined, precision: number): number | null => {
        if (value === undefined || value === null || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed / 10 ** precision : null;
      };
      const exchangeA2B = amountFromChain(statistics?._24h_exchange_a2b_amount_a, assetA.precision);
      const exchangeB2A = amountFromChain(statistics?._24h_exchange_b2a_amount_a, assetA.precision);
      const volume24h = exchangeA2B !== null && exchangeB2A !== null ? exchangeA2B + exchangeB2A : null;
      const deltaA = amountFromChain(statistics?._24h_balance_delta_a, assetA.precision);
      const deltaB = amountFromChain(statistics?._24h_balance_delta_b, assetB.precision);
      const poolPrice = (a: number, b: number) => assetB.symbol === 'DFS' && assetA.symbol !== 'DFS' ? a / b : b / a;
      let change24h: number | null = null;
      if (deltaA !== null && deltaB !== null && balanceA > 0 && balanceB > 0) {
        const previousA = balanceA - deltaA;
        const previousB = balanceB - deltaB;
        const current = poolPrice(balanceA, balanceB);
        const previous = previousA > 0 && previousB > 0 ? poolPrice(previousA, previousB) : 0;
        if (current > 0 && previous > 0) change24h = (current / previous - 1) * 100;
      }
      return [{
        id: String(row.id),
        assetA: { id: assetA.id, symbol: assetA.symbol, precision: assetA.precision },
        assetB: { id: assetB.id, symbol: assetB.symbol, precision: assetB.precision },
        shareAsset: { id: shareAsset.id, symbol: shareAsset.symbol, precision: shareAsset.precision },
        balanceA,
        balanceB,
        takerFeePercent: Number(row.taker_fee_percent ?? 0) / 100,
        withdrawalFeePercent: Number(row.withdrawal_fee_percent ?? 0) / 100,
        change24h,
        volume24h,
        raw: row,
      } satisfies LiquidityPool];
    });
  }

  /** Read operation history for one liquidity pool from history_api. */
  async getLiquidityPoolHistory(
    poolId: string,
    start?: number | string,
    stop?: number | string,
    limit?: number,
    operationType?: number,
  ): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [poolId];
    if (start !== undefined || stop !== undefined || limit !== undefined || operationType !== undefined) params.push(start ?? null);
    if (stop !== undefined || limit !== undefined || operationType !== undefined) params.push(stop ?? null);
    if (limit !== undefined || operationType !== undefined) params.push(limit ?? null);
    if (operationType !== undefined) params.push(operationType);
    return this.history<Array<Record<string, unknown>>>('get_liquidity_pool_history', params);
  }

  async getLiquidityPreview(params: {
    accountNameOrId: string;
    poolId: string;
    operationType: LiquidityOperation;
    amountA?: string;
    amountB?: string;
    sellAssetId?: string;
    sellAmount?: string;
    minReceive?: string;
    receiveAssetId?: string;
    shareAmount?: string;
    feeAssetId?: string;
  }): Promise<LiquidityPreview> {
    const [rows, pools] = await Promise.all([this.getFullAccounts([params.accountNameOrId]), this.getLiquidityPools()]);
    const fullAccount = rows[0]?.[1];
    const account = fullAccount?.account;
    const pool = pools.find(item => item.id === params.poolId);
    if (!account) throw new Error('账户不存在');
    if (!pool) throw new Error('流动性池不存在或暂未同步');
    const feeAssetId = params.feeAssetId ?? '1.3.0';
    const feeAsset = (await this.lookupAssets([feeAssetId]))[0];
    if (!feeAsset) throw new Error('手续费资产不存在');
    const balanceOf = (assetId: string) => {
      const item = (fullAccount.balances ?? []).find(row => row.asset_type === assetId);
      return item ? BigInt(String(item.balance)) : 0n;
    };
    const amount = (raw: string | undefined, asset: { id: string; symbol: string; precision: number }, label: string, checkBalance = true) => {
      if (!raw) throw new Error(`请输入${label}`);
      const atomic = decimalToAtomic(raw, asset.precision);
      if (checkBalance && balanceOf(asset.id) < BigInt(atomic)) throw new Error(`${asset.symbol}余额不足`);
      return { atomic, value: atomicToDecimal(atomic, asset.precision), symbol: asset.symbol, assetId: asset.id, precision: asset.precision };
    };
    let operation: Record<string, unknown>;
    const result: LiquidityPreview = { account: { id: account.id, name: account.name }, pool, operationType: params.operationType, fee: { atomic: '0', value: 0, symbol: feeAsset.symbol, assetId: feeAsset.id, precision: feeAsset.precision }, operation: {} };
    let operationId: number;
    if (params.operationType === 'exchange') {
      if (!params.sellAssetId || !params.receiveAssetId || params.sellAmount == null || params.minReceive == null) throw new Error('兑换参数不完整');
      const sellAsset = [pool.assetA, pool.assetB].find(asset => asset.id === params.sellAssetId);
      const receiveAsset = [pool.assetA, pool.assetB].find(asset => asset.id === params.receiveAssetId);
      if (!sellAsset || !receiveAsset || sellAsset.id === receiveAsset.id) throw new Error('兑换资产不属于当前池子');
      result.sell = amount(params.sellAmount, sellAsset, '兑换数量');
      result.receive = amount(params.minReceive, receiveAsset, '最小获得数量', false);
      operationId = 63;
      operation = { fee: { amount: 0, asset_id: feeAsset.id }, account: account.id, pool: pool.id, amount_to_sell: { amount: result.sell.atomic, asset_id: sellAsset.id }, min_to_receive: { amount: result.receive.atomic, asset_id: receiveAsset.id }, extensions: [] };
    } else if (params.operationType === 'deposit') {
      result.amountA = amount(params.amountA, pool.assetA, '资产 A 数量');
      result.amountB = amount(params.amountB, pool.assetB, '资产 B 数量');
      operationId = 61;
      operation = { fee: { amount: 0, asset_id: feeAsset.id }, account: account.id, pool: pool.id, amount_a: { amount: result.amountA.atomic, asset_id: pool.assetA.id }, amount_b: { amount: result.amountB.atomic, asset_id: pool.assetB.id }, extensions: [] };
    } else {
      result.amountA = amount(params.shareAmount, pool.shareAsset, 'LP 数量');
      operationId = 62;
      operation = { fee: { amount: 0, asset_id: feeAsset.id }, account: account.id, pool: pool.id, share_amount: { amount: result.amountA.atomic, asset_id: pool.shareAsset.id }, extensions: [] };
    }
    const fees = await this.db<Array<{ amount: string | number; asset_id: string }>>('get_required_fees', [[[operationId, operation]], feeAsset.id]);
    const fee = fees[0];
    if (!fee || fee.amount == null || fee.asset_id !== feeAsset.id) throw new Error('节点未返回有效手续费');
    if (feeAsset.id !== pool.assetA.id && feeAsset.id !== pool.assetB.id && balanceOf(feeAsset.id) < BigInt(String(fee.amount))) throw new Error(`${feeAsset.symbol}余额不足以支付手续费`);
    result.fee = { atomic: String(fee.amount), value: atomicToDecimal(fee.amount, feeAsset.precision), symbol: feeAsset.symbol, assetId: feeAsset.id, precision: feeAsset.precision };
    result.operation = operation;
    return result;
  }

  async broadcastTransaction(transaction: Record<string, unknown>): Promise<unknown> {
    return this.apiCall('network_broadcast', 'broadcast_transaction', [transaction]);
  }

  async getAccountAssets(nameOrId: string): Promise<{ account: FullAccountData['account']; balances: AccountAssetBalance[] }> {
    const rows = await this.getFullAccounts([nameOrId]);
    const fullAccount = rows[0]?.[1];
    if (!fullAccount) throw new Error('未找到该账户');
    const ids = [...new Set((fullAccount.balances ?? []).map(item => item.asset_type))];
    const assets = await this.lookupAssets(ids);
    const byId = new Map(assets.filter((asset): asset is AssetObject => Boolean(asset)).map(asset => [asset.id, asset]));
    const balances = (fullAccount.balances ?? []).flatMap(balance => {
      const asset = byId.get(balance.asset_type);
      if (!asset) return [];
      return [{
        assetId: asset.id,
        symbol: asset.symbol,
        precision: asset.precision,
        amount: atomicToDecimal(balance.balance, asset.precision),
      }];
    }).filter(balance => balance.amount !== 0).sort((a, b) => b.amount - a.amount);
    return { account: fullAccount.account, balances };
  }

  async getAccountOrders(nameOrId: string): Promise<{ account: FullAccountData['account']; orders: AccountOrder[] }> {
    const rows = await this.getFullAccounts([nameOrId]);
    const fullAccount = rows[0]?.[1];
    if (!fullAccount) throw new Error('未找到该账户');
    const rawOrders = Array.isArray(fullAccount.limit_orders) ? fullAccount.limit_orders : [];
    const orders = rawOrders.flatMap(raw => {
      const order = raw as {
        id?: string;
        for_sale?: string | number;
        expiration?: string;
        sell_price?: { base?: { amount?: string | number; asset_id?: string }; quote?: { amount?: string | number; asset_id?: string } };
      };
      const base = order.sell_price?.base;
      const quote = order.sell_price?.quote;
      if (!order.id || order.for_sale == null || !base?.asset_id || !quote?.asset_id || base.amount == null || quote.amount == null) return [];
      return [{ order, base, quote }];
    });
    const assetIds = [...new Set(orders.flatMap(({ base, quote }) => [base.asset_id!, quote.asset_id!]))];
    const assets = await this.lookupAssets(assetIds);
    const byId = new Map(assets.filter((asset): asset is AssetObject => Boolean(asset)).map(asset => [asset.id, asset]));
    return {
      account: fullAccount.account,
      orders: orders.flatMap(({ order, base, quote }) => {
        const sellAsset = byId.get(base.asset_id!);
        const receiveAsset = byId.get(quote.asset_id!);
        if (!sellAsset || !receiveAsset) return [];
        const sellAmount = atomicToDecimal(order.for_sale!, sellAsset.precision);
        const unitSell = atomicToDecimal(base.amount!, sellAsset.precision);
        const unitReceive = atomicToDecimal(quote.amount!, receiveAsset.precision);
        if (!sellAmount || !unitSell || !unitReceive) return [];
        return [{
          id: order.id!,
          sellAmount,
          sellSymbol: sellAsset.symbol,
          receiveAmount: sellAmount * (unitReceive / unitSell),
          receiveSymbol: receiveAsset.symbol,
          price: unitReceive / unitSell,
          expiration: order.expiration,
        }];
      }),
    };
  }

  async getAccountHistory(nameOrId: string, limit = 20): Promise<AccountHistoryEntry[]> {
    const rows = await this.getFullAccounts([nameOrId]);
    const account = rows[0]?.[1]?.account;
    if (!account) throw new Error('未找到该账户');
    try {
      const result = await this.history<{ operation_history_objs?: Array<Record<string, unknown>> }>('get_account_history_by_operations', [account.id, [], 0, limit]);
      return (result.operation_history_objs ?? []).flatMap(item => {
        const operation = item.op;
        const operationType = Array.isArray(operation) && typeof operation[0] === 'number' ? operation[0] : Number(item.op_type);
        if (!Number.isFinite(operationType) || typeof item.id !== 'string') return [];
        return [{
          id: item.id,
          operationType,
          blockNum: typeof item.block_num === 'number' ? item.block_num : undefined,
          time: typeof item.block_time === 'string' ? item.block_time : typeof item.time === 'string' ? item.time : undefined,
          trxInBlock: typeof item.trx_in_block === 'number' ? item.trx_in_block : undefined,
          opInTrx: typeof item.op_in_trx === 'number' ? item.op_in_trx : undefined,
          virtualOp: typeof item.virtual_op === 'number' ? item.virtual_op : undefined,
          operation: Array.isArray(operation) ? operation[1] : operation,
          result: item.result,
          raw: item,
        }];
      });
    } catch {
      // Some public nodes do not expose history_api. Keep account pages usable.
      return [];
    }
  }

  async getMarketHistory(base: string, quote: string, bucketSeconds: number, count = 160): Promise<KLineData[]> {
    const assets = await this.lookupAssets([base, quote]);
    const baseAsset = assets[0];
    const quoteAsset = assets[1];
    if (!baseAsset || !quoteAsset) throw new Error('交易对资产不存在');
    const end = new Date();
    const start = new Date(end.getTime() - bucketSeconds * count * 1_000);
    const rows = await this.history<Array<Record<string, any>>>('get_market_history', [
      baseAsset.id,
      quoteAsset.id,
      bucketSeconds,
      start.toISOString().replace(/\.\d{3}Z$/, ''),
      end.toISOString().replace(/\.\d{3}Z$/, ''),
    ]);
    return rows.map(row => this.parseKline(row, baseAsset, quoteAsset)).filter(Boolean) as KLineData[];
  }

  async getRecentTrades(base: string, quote: string, limit = 30): Promise<MarketTrade[]> {
    const [baseAsset, quoteAsset] = await this.lookupAssets([base, quote]);
    if (!baseAsset || !quoteAsset) throw new Error('交易对资产不存在');
    const rows = await this.history<Array<Record<string, any>>>('get_fill_order_history', [baseAsset.id, quoteAsset.id, Math.max(limit * 2, limit)]);
    const trades: MarketTrade[] = [];
    const priceFromObject = (value: any): number => {
      const priceBase = value?.base;
      const priceQuote = value?.quote;
      if (!priceBase || !priceQuote) return 0;
      const baseValue = atomicToDecimal(priceBase.amount, priceBase.asset_id === baseAsset.id ? baseAsset.precision : quoteAsset.precision);
      const quoteValue = atomicToDecimal(priceQuote.amount, priceQuote.asset_id === quoteAsset.id ? quoteAsset.precision : baseAsset.precision);
      if (!(baseValue > 0 && quoteValue > 0)) return 0;
      return priceBase.asset_id === baseAsset.id ? quoteValue / baseValue : baseValue / quoteValue;
    };
    for (const row of rows) {
      const operation = row.op as Record<string, any> | undefined;
      if (!operation || operation.is_maker) continue;
      const pays = operation.pays;
      const receives = operation.receives;
      if (!pays?.asset_id || !receives?.asset_id) continue;
      const isSell = pays.asset_id === baseAsset.id;
      const atomicAmount = isSell ? Number(pays.amount) : Number(receives.amount);
      const amount = atomicToDecimal(atomicAmount, baseAsset.precision);
      if (!(amount > 0)) continue;
      const price = priceFromObject(operation.fill_price) || (isSell
        ? atomicToDecimal(receives.amount, quoteAsset.precision) / amount
        : atomicToDecimal(pays.amount, quoteAsset.precision) / amount);
      if (!(price > 0)) continue;
      const orderId = String(operation.order_id ?? '');
      trades.push({
        timestamp: row.time ? new Date(`${String(row.time).replace(/Z$/, '')}Z`).getTime() : Date.now(),
        isSell,
        isCall: orderId.split('.')[1] === '8',
        price,
        amount,
      });
      if (trades.length >= limit) break;
    }
    return trades;
  }

  async getStorageInfo(account: string | null, catalog: string, fallbackUrl?: string, expectedChainId?: string): Promise<any[]> {
    try {
      return await this.custom<any[]>('get_storage_info', [account, catalog]);
    } catch (primaryError) {
      const url = fallbackUrl && fallbackUrl !== this.connectedUrl ? fallbackUrl : null;
      if (!url) throw primaryError;
      const reader = new GrapheneRpcClient({ requestTimeoutMs: this.requestTimeoutMs, WebSocketImpl: this.WebSocketImpl });
      try {
        await reader.connect(url, expectedChainId);
        return await reader.custom<any[]>('get_storage_info', [account, catalog]);
      } finally {
        await reader.disconnect();
      }
    }
  }

  private parseKline(row: Record<string, any>, baseAsset: AssetObject, quoteAsset: AssetObject): KLineData | null {
    const ratio = (baseAmount: unknown, quoteAmount: unknown, direct: boolean): number => {
      const baseValue = atomicToDecimal(baseAmount as string | number, direct ? baseAsset.precision : quoteAsset.precision);
      const quoteValue = atomicToDecimal(quoteAmount as string | number, direct ? quoteAsset.precision : baseAsset.precision);
      if (!baseValue || !quoteValue) return 0;
      return direct ? quoteValue / baseValue : baseValue / quoteValue;
    };
    const direct = row.key?.base === baseAsset.id;
    const open = ratio(row.open_base, row.open_quote, direct);
    const close = ratio(row.close_base, row.close_quote, direct);
    let high = ratio(row.high_base, row.high_quote, direct);
    let low = ratio(row.low_base, row.low_quote, direct);
    if (!direct) [high, low] = [low, high];
    const openedAt = row.key?.open ? new Date(`${String(row.key.open).replace(/Z$/, '')}Z`).getTime() : NaN;
    if (![openedAt, open, high, low, close].every(Number.isFinite)) return null;
    return {
      timestamp: openedAt,
      open,
      high,
      low,
      close,
      volume: atomicToDecimal(direct ? row.quote_volume : row.base_volume, quoteAsset.precision),
    };
  }

  private async apiCall<T>(api: ApiName, method: string, params: unknown[]): Promise<T> {
    const apiId = this.apiIds[api];
    if (apiId == null) throw new Error(`${api}_api 不可用`);
    return this.rawCall<T>(apiId, method, params);
  }

  private resolveWebSocketUrl(url: string): string {
    if (/^wss?:\/\//i.test(url)) return url;
    if (typeof window === 'undefined') throw new Error(`无法在当前运行环境解析 WebSocket 地址: ${url}`);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new URL(url, `${protocol}//${window.location.host}`).toString();
  }

  private async resolveApi(name: ApiName, required: boolean): Promise<number | null> {
    try {
      return await this.rawCall<number>(1, name, []);
    } catch (error) {
      if (required) throw error;
      return null;
    }
  }

  private rawCall<T>(apiId: number, method: string, params: unknown[]): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== this.WebSocketImpl.OPEN) return Promise.reject(new Error('节点连接未建立'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.send(JSON.stringify({ id, method: 'call', params: [apiId, method, params] }));
    });
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    let payload: string;
    if (typeof event.data === 'string') {
      payload = event.data;
    } else if (event.data instanceof ArrayBuffer) {
      payload = new TextDecoder().decode(new Uint8Array(event.data));
    } else if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
      payload = await event.data.text();
    } else {
      return;
    }
    let reply: RpcReply;
    try {
      reply = JSON.parse(payload) as RpcReply;
    } catch {
      return;
    }
    if (typeof reply.id !== 'number') return;
    const request = this.pending.get(reply.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(reply.id);
    if (reply.error) {
      request.reject(new Error(reply.error.message || '节点请求失败'));
    } else {
      request.resolve(reply.result);
    }
  }

  private handleClose(): void {
    this.socket = null;
    this.connectedUrl = null;
    this.apiIds = { ...apiIdDefaults };
    this.rejectAll(new Error(this.closedByClient ? '连接已关闭' : '节点连接已断开'));
  }

  private rejectAll(error: Error): void {
    this.pending.forEach(request => {
      clearTimeout(request.timer);
      request.reject(error);
    });
    this.pending.clear();
  }
}
