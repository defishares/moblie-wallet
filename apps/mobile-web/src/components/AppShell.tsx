import { NavLink, Outlet } from 'react-router-dom';
import { formatPrice } from '@defishares/core';
import { useChain } from '../state/ChainProvider';

// Mirrors src/navigation/TabNavigator.tsx. Secondary RN stack screens remain
// reachable from the home quick actions and their existing in-page links.
const tabs = [
  { to: '/', label: '首页', icon: 'dashboard', end: true },
  { to: '/markets', label: '市场', icon: 'chart' },
  { to: '/trade', label: '交易', icon: 'swap' },
  { to: '/lending', label: '借贷', icon: 'bank' },
  { to: '/assets', label: '资产', icon: 'wallet' },
];

function TabIcon({ name }: { name: string }) {
  if (name === 'dashboard') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" fill="currentColor" /></svg>;
  if (name === 'chart') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16M7 16l4-5 3 2 5-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (name === 'swap') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3m6 11H7l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (name === 'bank') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-5 9 5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5zM4 8h14a2 2 0 0 1 2 2v4H16a3 3 0 0 1 0-6h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="11" r="1" fill="currentColor" /></svg>;
}

export function AppShell() {
  const { status, error } = useChain();
  const statusLabel = status === 'connected' ? '节点已连接' : status === 'connecting' ? '正在连接' : '连接异常';
  return (
    <div className="app-frame">
      <main className="content-area">
        {status !== 'connected' && <div className={`connection-banner ${status}`}><span className={`status-dot ${status}`} />{statusLabel}{error ? `：${error}` : ''}</div>}
        <Outlet />
      </main>
      <nav className="bottom-tab-bar" aria-label="主导航">
        {tabs.map(tab => <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => isActive ? 'bottom-tab active' : 'bottom-tab'}>
          <span className="bottom-tab-icon"><TabIcon name={tab.icon} /></span><span>{tab.label}</span>
        </NavLink>)}
      </nav>
    </div>
  );
}

export function Metric({ label, value, change }: { label: string; value: string; change?: number }) {
  return <div className="metric"><span className="metric-label">{label}</span><strong>{value}</strong>{change !== undefined && <span className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{formatPrice(change, 2)}%</span>}</div>;
}
