/**
 * 应用状态管理
 * 使用 Zustand 进行全局状态管理
 * 
 * 注意：市场行情相关的状态已移至 useMarketStore.ts
 */

import { create } from 'zustand';
import { 
  CryptoAsset, 
  Announcement, 
  UserAsset, 
  UserHolding,
  TabType,
} from '../types';
import { backgroundService } from '../services/background_service';

// 应用状态接口
interface AppState {
  // ========== 通用状态 ==========
  isInitialized: boolean;      // 是否已初始化完成
  isLoading: boolean;          // 是否正在加载

  // ========== 首页状态 ==========
  userAsset: UserAsset;        // 用户资产
  cryptoAssets: CryptoAsset[]; // 加密货币列表（首页）
  announcements: Announcement[]; // 公告列表
  selectedTab: TabType;        // 当前选中的 Tab（首页）

  // ========== 资产页面状态 ==========
  userHoldings: UserHolding[];       // 用户持有资产列表

  // ========== Actions ==========
  // 通用操作
  setInitialized: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  initializeApp: () => Promise<void>;
  
  // 首页操作
  setUserAsset: (asset: UserAsset) => void;
  setCryptoAssets: (assets: CryptoAsset[]) => void;
  setAnnouncements: (announcements: Announcement[]) => void;
  setSelectedTab: (tab: TabType) => void;
  
  // 资产页面操作
  setUserHoldings: (holdings: UserHolding[]) => void;
}

// 模拟加密货币数据（首页用）
const mockCryptoAssets: CryptoAsset[] = [
  {
    id: '1',
    symbol: 'BTC',
    name: 'Bitcoin',
    price: 91399.90,
    priceUsd: 91410.87,
    change24h: 0.36,
    color: '#F7931A',
  },
  {
    id: '2',
    symbol: 'ETH',
    name: 'Ethereum',
    price: 3009.41,
    priceUsd: 3009.77,
    change24h: 0.06,
    color: '#627EEA',
  },
  {
    id: '3',
    symbol: 'SOL',
    name: 'Solana',
    price: 136.77,
    priceUsd: 136.79,
    change24h: -0.57,
    color: '#9945FF',
  },
  {
    id: '4',
    symbol: 'DOGE',
    name: 'Dogecoin',
    price: 0.14965,
    priceUsd: 0.15,
    change24h: 0.11,
    color: '#C2A633',
  },
  {
    id: '5',
    symbol: 'OKB',
    name: 'OKB',
    price: 106.03,
    priceUsd: 106.04,
    change24h: -1.09,
    color: '#2D60E0',
  },
];

// 模拟公告数据
const mockAnnouncements: Announcement[] = [
  {
    id: '1',
    title: '新币上线',
    content: 'RWA资产VIH：交易RWA资产VIH并瓜分20万枚USDT奖池。',
    type: 'new_coin',
  },
  {
    id: '2',
    title: '活动公告',
    content: '参与交易大赛，赢取丰厚奖励！',
    type: 'event',
  },
];

// 模拟用户持有资产数据
const mockUserHoldings: UserHolding[] = [
  {
    id: '1',
    symbol: 'BNB',
    name: 'BNB',
    balance: 0.000348,
    valueUsd: 0.30,
    price: 863.90,
    change24h: 0.59,
    color: '#F3BA2F',
  },
  {
    id: '2',
    symbol: 'USDT',
    name: 'Tether',
    balance: 0.000000,
    valueUsd: 0.00,
    price: 1.00,
    change24h: 0.00,
    color: '#26A17B',
  },
  {
    id: '3',
    symbol: 'USDC',
    name: 'USD Coin',
    balance: 0.000000,
    valueUsd: 0.00,
    price: 1.00,
    change24h: 0.00,
    color: '#2775CA',
  },
  {
    id: '4',
    symbol: 'BTC',
    name: 'Bitcoin',
    balance: 0.000000,
    valueUsd: 0.00,
    price: 86461.60,
    change24h: -0.21,
    color: '#F7931A',
  },
  {
    id: '5',
    symbol: 'ETH',
    name: 'Ethereum',
    balance: 0.000000,
    valueUsd: 0.00,
    price: 2926.92,
    change24h: -0.01,
    color: '#627EEA',
  },
  {
    id: '6',
    symbol: 'OKB',
    name: 'OKB',
    balance: 0.000000,
    valueUsd: 0.00,
    price: 107.39,
    change24h: 1.37,
    color: '#2D60E0',
  },
];

// 创建 Zustand store
export const useAppStore = create<AppState>((set, get) => ({
  // ========== 初始状态 ==========
  isInitialized: false,
  isLoading: true,
  
  // 首页状态
  userAsset: {
    totalBalance: 0.00,
    currency: 'USD',
  },
  cryptoAssets: [],
  announcements: [],
  selectedTab: 'favorites',

  // 资产页面状态
  userHoldings: [],

  // ========== 通用操作 ==========
  setInitialized: (value: boolean) => set({ isInitialized: value }),
  setLoading: (value: boolean) => set({ isLoading: value }),

  // ========== 首页操作 ==========
  setUserAsset: (asset: UserAsset) => set({ userAsset: asset }),
  setCryptoAssets: (assets: CryptoAsset[]) => set({ cryptoAssets: assets }),
  setAnnouncements: (announcements: Announcement[]) => set({ announcements }),
  setSelectedTab: (tab: TabType) => set({ selectedTab: tab }),

  // ========== 资产页面操作 ==========
  setUserHoldings: (holdings: UserHolding[]) => set({ userHoldings: holdings }),

  // 初始化应用数据
  initializeApp: async () => {
    const { 
      setLoading, 
      setCryptoAssets, 
      setAnnouncements, 
      setUserHoldings, 
      setUserAsset, 
      setInitialized,
    } = get();
    
    try {
      setLoading(true);
      
      // 1. 初始化市场数据（通过 backgroundService）
      await backgroundService.initializeMarketData();
      
      // 2. 加载其他模拟数据（公告、资产等）
      setCryptoAssets(mockCryptoAssets);
      setAnnouncements(mockAnnouncements);
      setUserHoldings(mockUserHoldings);
      
      // 3. 计算总资产价值
      const totalValue = mockUserHoldings.reduce((sum, holding) => sum + holding.valueUsd, 0);
      setUserAsset({ totalBalance: totalValue, currency: 'USDT' });
      
      // 4. 标记初始化完成
      setInitialized(true);
      
      console.log('[Store] 应用初始化完成');
    } catch (error) {
      console.error('[Store] 初始化应用数据失败:', error);
    } finally {
      setLoading(false);
    }
  },
}));
