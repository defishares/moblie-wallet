import type { Announcement } from '../types';

export const parseAnnouncementAdminList = (value: unknown): Array<{ id: string; name: string }> => {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error('链上管理员配置格式错误');
  return parsed.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error('链上管理员配置格式错误');
    }
    return { id: item.id, name: item.name.trim() };
  });
};

/** Reject malformed storage instead of overwriting an existing feed with an empty list. */
export const parseAnnouncementList = (value: unknown): Announcement[] => {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error('链上公告格式错误，请检查后重试');
  return parsed.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id ||
      typeof item.title !== 'string' || !item.title.trim() ||
      typeof item.content !== 'string' || !item.content.trim() ||
      !['new_coin', 'event', 'news'].includes(item.type)) {
      throw new Error('链上公告格式错误，请检查后重试');
    }
    return {
      id: item.id, title: item.title, content: item.content, type: item.type,
      enabled: item.enabled !== false,
      sort: Number.isFinite(item.sort) ? item.sort : 0,
      publishedAt: Number.isFinite(item.publishedAt) ? item.publishedAt : 0,
      expiresAt: Number.isFinite(item.expiresAt) ? item.expiresAt : 0,
    };
  });
};

/** Each administrator signs and owns their own feed; combine only those trusted feeds. */
export const mergeAnnouncementFeeds = (feeds: Announcement[][]): Announcement[] => feeds
  .flat()
  .filter(item => item.enabled !== false && (!item.expiresAt || item.expiresAt > Date.now()))
  .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || (a.sort ?? 0) - (b.sort ?? 0))
  .map((item, index) => ({ ...item, sort: index + 1 }));
