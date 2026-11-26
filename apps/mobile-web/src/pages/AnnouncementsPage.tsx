import { useCallback, useEffect, useState } from 'react';
import { useChain } from '../state/ChainProvider';
import { RNScreenHeader } from '../components/RNScreenHeader';

type Announcement = { id: string; title: string; content: string; type: string; enabled?: boolean; publishedAt?: number; expiresAt?: number; sort?: number };
const sources = ['1.2.185992', '1.2.100'];
function parse(value: unknown): Announcement[] { let parsed: unknown = value; if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { return []; } } if (!Array.isArray(parsed)) return []; return parsed.filter(item => item && typeof item === 'object' && typeof (item as any).id === 'string' && typeof (item as any).title === 'string' && typeof (item as any).content === 'string' && (item as any).enabled !== false).map(item => { const row = item as any; return { ...row, title: row.title.trim(), content: row.content.trim() }; }).filter(item => item.title && item.content && (!item.expiresAt || item.expiresAt > Date.now())); }

export function AnnouncementsPage() {
  const { client } = useChain(); const [items, setItems] = useState<Announcement[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => { setLoading(true); setError(null); try { const feeds = await Promise.all(sources.map(async id => (await client.getStorageInfo(id, 'app.settings.v2')).find(row => row?.key === 'announcements.v1'))); setItems(feeds.flatMap(row => row ? parse(row.value) : []).sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0) || (a.sort || 0) - (b.sort || 0))); } catch (cause) { setError(cause instanceof Error ? cause.message : '公告读取失败'); } finally { setLoading(false); } }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);
  return <div className="page-stack rn-secondary-page"><RNScreenHeader title="公告" backTo="/" action={<button className="rn-header-icon" type="button" onClick={() => void refresh()} disabled={loading}>↻</button>}/>{error && <div className="inline-error">{error}</div>}<section className="announcement-list">{!items.length && !loading ? <div className="empty-state">暂无有效公告</div> : items.map(item => <article className="panel-card announcement-card" key={item.id}><div className="announcement-meta"><span className="status-badge">{item.type}</span><time>{item.publishedAt ? new Date(item.publishedAt).toLocaleString('zh-CN') : '—'}</time></div><h3>{item.title}</h3><p>{item.content}</p></article>)}</section></div>;
}
