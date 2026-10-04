export type HistoryAsset = { id: string; symbol: string; precision: number };
export type HistoryField = { label: string; value: string; highlight?: boolean };
export type LiquidityHistoryEntry = {
  id: string;
  title: string;
  time: string;
  summary: string;
  fields: HistoryField[];
};

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const variantValue = (value: unknown): JsonObject => object(Array.isArray(value) ? value[1] : value);
const amounts = (value: unknown): JsonObject[] => (Array.isArray(value) ? value : []).map(object).filter(item => typeof item.asset_id === 'string');

export function collectLiquidityHistoryReferences(rows: unknown[]) {
  const assetIds = new Set<string>();
  const accountIds = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    Object.entries(object(value)).forEach(([key, child]) => {
      if (['asset_id', 'asset_a', 'asset_b', 'share_asset'].includes(key) && typeof child === 'string') assetIds.add(child);
      if (key === 'account' && typeof child === 'string') accountIds.add(child);
      if (typeof child === 'object') visit(child);
    });
  };
  rows.forEach(visit);
  return { assetIds: [...assetIds], accountIds: [...accountIds] };
}

export function formatHistoryTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return '时间未提供';
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function formatAtomic(raw: unknown, asset: HistoryAsset | undefined): string {
  if (typeof raw !== 'number' && typeof raw !== 'string') return '链上未提供';
  const value = String(raw);
  if (!asset) return `${value} 原始单位（未知资产）`;
  if (!/^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${parsed.toFixed(asset.precision)} ${asset.symbol}` : '链上未提供';
  }
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).padStart(asset.precision + 1, '0');
  const point = asset.precision ? digits.length - asset.precision : digits.length;
  const decimal = asset.precision ? `${digits.slice(0, point)}.${digits.slice(point)}` : digits;
  return `${negative ? '-' : ''}${decimal} ${asset.symbol}`;
}

export function parseLiquidityHistory(value: unknown, assets: ReadonlyMap<string, HistoryAsset>, accounts: ReadonlyMap<string, string>): LiquidityHistoryEntry {
  const row = object(value);
  const history = object(row.op);
  const operation = variantValue(history.op);
  const result = variantValue(history.result);
  const type = Number(Array.isArray(history.op) ? history.op[0] : row.op_type);
  const titles: Record<number, string> = { 59: '创建流动性池', 60: '删除流动性池', 61: '增加流动性', 62: '提取流动性', 63: '闪兑', 75: '更新流动性池' };
  const fields: HistoryField[] = [];
  const add = (label: string, text: string, highlight = false) => fields.push({ label, value: text, highlight });
  const symbol = (id: unknown) => typeof id === 'string' ? assets.get(id)?.symbol || id : '未知资产';
  const format = (input: unknown) => { const amount = object(input); const id = typeof amount.asset_id === 'string' ? amount.asset_id : ''; return formatAtomic(amount.amount, assets.get(id)); };
  const formatList = (list: JsonObject[]) => list.map(format).join(' + ');
  const paid = amounts(result.paid);
  const received = amounts(result.received);
  const fees = amounts(result.fees);

  if (type === 63) {
    add('实际支出', paid.length ? formatList(paid) : format(operation.amount_to_sell));
    add('实际获得', received.length ? formatList(received) : '链上未提供成交结果', true);
    if (operation.min_to_receive) add('最低获得', format(operation.min_to_receive));
  } else if (type === 61) {
    const requested = [operation.amount_a, operation.amount_b].filter(Boolean).map(object);
    add(paid.length ? '实际注入' : '提交数量', formatList(paid.length ? paid : requested) || '链上未提供');
    add('获得 LP', received.length ? formatList(received) : '链上未提供成交结果', true);
  } else if (type === 62) {
    add('销毁 LP', paid.length ? formatList(paid) : format(operation.share_amount));
    add('实际取回', received.length ? formatList(received) : '链上未提供成交结果', true);
  } else if (type === 59 || type === 75) {
    if (operation.asset_a && operation.asset_b) add('交易对', `${symbol(operation.asset_a)} / ${symbol(operation.asset_b)}`);
    if (operation.share_asset) add('LP 资产', symbol(operation.share_asset));
    if (typeof operation.taker_fee_percent === 'number') add('兑换费率', `${(operation.taker_fee_percent / 100).toFixed(2)}%`);
    if (typeof operation.withdrawal_fee_percent === 'number') add('提取费率', `${(operation.withdrawal_fee_percent / 100).toFixed(2)}%`);
  } else if (type !== 60) {
    if (paid.length) add('实际支出', formatList(paid));
    if (received.length) add('实际获得', formatList(received), true);
    if (!paid.length && !received.length) add('操作详情', '暂不支持解析此操作');
  }
  if (operation.fee) add('网络手续费', format(operation.fee));
  const feeLabels = ['支出资产手续费', '获得资产手续费', '池子手续费'];
  fees.forEach((fee, index) => add(type === 63 ? feeLabels[index] || '其他手续费' : type === 62 ? `提取手续费（${symbol(fee.asset_id)}）` : '手续费', format(fee)));
  const accountId = typeof operation.account === 'string' ? operation.account : '';
  const accountName = accountId ? accounts.get(accountId) || accountId : '账户';
  if (accountId) add('操作账户', accounts.has(accountId) ? `${accountName} (${accountId})` : accountId);
  const poolId = typeof row.pool === 'string' ? row.pool : operation.pool;
  if (typeof poolId === 'string') add('池子', poolId);
  if (row.sequence !== undefined) add('池内序号', String(row.sequence));
  if (typeof history.block_num === 'number' && history.block_num > 0) add('区块高度', String(history.block_num));
  if (typeof history.trx_in_block === 'number' && typeof history.op_in_trx === 'number') add('区块内位置', `第 ${history.trx_in_block + 1} 笔交易 · 第 ${history.op_in_trx + 1} 个操作`);
  const fieldValue = (label: string) => fields.find(field => field.label === label)?.value;
  let summary = `${accountName}完成${titles[type] || '链上操作'}。`;
  if (type === 63) summary = `${accountName}完成交易，支出${fieldValue('实际支出') || '链上未提供'}，获得${fieldValue('实际获得') || '链上未提供'}。`;
  if (type === 61) summary = `${accountName}完成注入，注入${fieldValue('实际注入') || '链上未提供'}，获得${fieldValue('获得 LP') || '链上未提供'}。`;
  if (type === 62) summary = `${accountName}完成提取，销毁${fieldValue('销毁 LP') || '链上未提供'}，取回${fieldValue('实际取回') || '链上未提供'}。`;
  const id = typeof row.id === 'string' ? row.id : `${String(row.pool)}-${String(row.sequence)}-${String(row.time)}`;
  return { id, title: titles[type] || `链上操作 ${Number.isFinite(type) ? type : '未知'}`, time: formatHistoryTime(row.time || history.block_time), summary, fields };
}
