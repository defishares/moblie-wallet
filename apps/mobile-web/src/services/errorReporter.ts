/** Optional production error sink. Never includes passwords, WIFs, memo text or account data. */
export function reportClientError(error: unknown, context: string): void {
  const message = error instanceof Error ? error.message : String(error);
  const endpoint = import.meta.env.VITE_ERROR_REPORT_URL;
  if (!endpoint) return;
  const payload = JSON.stringify({ app: 'defishares-web', context, message: message.slice(0, 500), path: window.location.pathname, release: import.meta.env.VITE_RELEASE_VERSION || 'dev', at: new Date().toISOString() });
  try { if (navigator.sendBeacon) navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' })); else void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }); } catch { /* reporting must never affect the wallet flow */ }
}
