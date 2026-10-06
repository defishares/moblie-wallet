const GRAPHENE_ERROR_MESSAGES: Record<string, string> = {
  'no such account': '账号不存在。',
  'insufficient balance': '手续费不足。',
  'preimage size': '原像不正确。',
  'provided preimage': '原像不正确。',
  'no method with': '当前 API 节点版本太低。',
  hardfork: '该功能尚未激活，请等待硬分叉升级完毕后再尝试。',
  'now <= trx.expiration': '交易已过期。',
  'duplicate transaction': '该交易已存在，不用重复广播。',
  'missing required active authority': '签名无效。',
  'missing required owner authority': '签名无效。',
  'missing required other authority': '签名无效。',
  'fee pool balance': '手续费资产对应的手续费池余额不足。',
  'unable to exchange at expected price': '兑换数量过小或流动性池价格已变化，请提高兑换金额或降低最小获得数量后重试。',
  'unable to find object': '操作失败，目标已经被删除了。',
  'initial collateral ratio (icr)': '抵押率不能低于初始抵押率。',
};

function matchGrapheneError(message: string): string | null {
  const lower = message.toLowerCase();
  const entry = Object.entries(GRAPHENE_ERROR_MESSAGES).find(([pattern]) => lower.includes(pattern));
  return entry?.[1] ?? null;
}

/** Keep Web transaction errors aligned with RN's user-facing messages. */
export function formatGrapheneError(error: unknown): string {
  const fallback = '网络请求失败，请稍后重试';
  if (!error) return fallback;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return fallback;
  try {
    const parsed = JSON.parse(message) as { message?: string; data?: { stack?: Array<{ format?: string }> } };
    const raw = [parsed.message, parsed.data?.stack?.[0]?.format].filter(Boolean).join(' : ');
    return matchGrapheneError(raw) ?? raw ?? message;
  } catch {
    return matchGrapheneError(message) ?? message;
  }
}
