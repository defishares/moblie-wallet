/** A separate, read-only connection. It never switches the trading/signing connection. */
export async function readStorageFromNode(
  url: string,
  expectedChainId: string,
  account: string | null,
  catalog: string,
  timeoutMs = 10000,
): Promise<any[]> {
  if (!expectedChainId) throw new Error('无法确认当前网络，请重新连接节点');
  const ws = new WebSocket(url);
  let requestId = 0;
  let rejectOpen: (error: Error) => void = () => {};
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const fail = (error: Error) => {
    rejectOpen(error);
    pending.forEach(request => request.reject(error));
    pending.clear();
  };
  const timer = setTimeout(() => {
    fail(new Error('公告存储节点响应超时，请稍后重试'));
    ws.close();
  }, timeoutMs);
  const opened = new Promise<void>((resolve, reject) => {
    rejectOpen = reject;
    ws.onopen = () => resolve();
  });
  ws.onerror = () => fail(new Error('无法连接公告存储节点'));
  ws.onclose = () => fail(new Error('公告存储连接已断开'));
  ws.onmessage = event => {
    try {
      const message = JSON.parse(String(event.data));
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message || '公告存储查询失败'));
      } else {
        request.resolve(message.result);
      }
    } catch {
      fail(new Error('公告存储节点返回了无效数据'));
    }
  };
  const call = (api: number, method: string, params: unknown[]): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      try {
        ws.send(JSON.stringify({ id, method: 'call', params: [api, method, params] }));
      } catch {
        pending.delete(id);
        reject(new Error('无法发送公告存储查询'));
      }
    });
  try {
    await opened;
    if (!await call(1, 'login', ['', ''])) throw new Error('公告存储节点登录失败');
    const db = await call(1, 'database', []);
    const chainId = await call(db, 'get_chain_id', []);
    if (chainId !== expectedChainId) throw new Error('公告存储节点属于不同网络，已停止读取');
    const api = await call(1, 'custom_operations', []);
    const rows = await call(api, 'get_storage_info', [account, catalog]);
    if (!Array.isArray(rows)) throw new Error('公告存储节点返回格式错误');
    return rows;
  } finally {
    clearTimeout(timer);
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
  }
}

export const isStorageApiUnavailable = (error: unknown): boolean => {
  // bitsharesjs-ws rejects with the JSON-RPC error object, not an Error instance.
  const message = typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message : '';
  return /Access denied|custom_operations_api 不可用|unknown api|no method with name/i.test(message);
};
