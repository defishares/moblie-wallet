import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AssetsPage } from './pages/AssetsPage';
import { DashboardPage } from './pages/DashboardPage';
import { KlinePage } from './pages/KlinePage';
import { LendingPage } from './pages/LendingPage';
import { MarketsPage } from './pages/MarketsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TradePage } from './pages/TradePage';
import { LoginPage } from './pages/LoginPage';
import { OrdersPage } from './pages/OrdersPage';
import { TransferPage } from './pages/TransferPage';
import { FlashSwapPage } from './pages/FlashSwapPage';
import { BSCWithdrawPage } from './pages/BSCWithdrawPage';
import { AnnouncementsPage } from './pages/AnnouncementsPage';
import { BSCHistoryPage } from './pages/BSCHistoryPage';
import { BSCDepositPage } from './pages/BSCDepositPage';
import { AuthProvider, useAuth } from './state/AuthProvider';
import { AboutPage } from './pages/AboutPage';
import { RegisterPage } from './pages/RegisterPage';
import { BSCHistoryDetailPage } from './pages/BSCHistoryDetailPage';
import { WebViewPage } from './pages/WebViewPage';
import { TransactionHistoryPage } from './pages/TransactionHistoryPage';

function RequireAuth() {
  const { isAuthenticated, biometricRestorePending } = useAuth();
  const location = useLocation();
  if (!isAuthenticated && biometricRestorePending) {
    return <main className="rn-auth-restore-page"><span className="rn-login-restore-spinner" />正在验证本机设备…</main>;
  }
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace state={{ from: location }} />;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="webview" element={<WebViewPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="markets" element={<MarketsPage />} />
            <Route path="trade/:base?/:quote?" element={<TradePage />} />
            <Route path="markets/:base/:quote/kline" element={<KlinePage />} />
            <Route path="lending" element={<LendingPage />} />
            <Route path="flash-swap" element={<FlashSwapPage />} />
            <Route path="bsc-withdraw" element={<BSCWithdrawPage />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="bsc-history" element={<BSCHistoryPage />} />
            <Route path="bsc-history/:txid" element={<BSCHistoryDetailPage />} />
            <Route path="bsc-deposit" element={<BSCDepositPage />} />
            <Route path="assets" element={<AssetsPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="history" element={<TransactionHistoryPage />} />
            <Route path="history/:id" element={<TransactionHistoryPage />} />
            <Route path="transfer" element={<TransferPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
