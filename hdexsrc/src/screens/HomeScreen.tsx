/**
 * 首页组件
 * 显示用户资产概览、快捷操作、公告和加密货币列表
 * 
 * 列表数据来自 useMarketStore：
 * - 自选：用户收藏的交易对
 * - 热门榜：成交额 Top5
 * - 涨幅榜：涨幅 Top5
 * - 跌幅榜：跌幅 Top5
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  FlatList,
  Image,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../store/useAppStore';
import {
  useMarketStore,
  useComputedMarketList,
  useFavoritesList,
  type ComputedMarketItem,
} from '../store/useMarketStore';
import {
  useTotalEstimatedValue,
  useValuationAsset,
} from '../store/useBalanceStore';
import { backgroundService, unlockSession } from '../services';
import { useAccountStore } from '../store/useAccountStore';
import type { RootStackParamList } from '../types';
import { Toast } from '../components/Toast';
import { MoreFunctionsSheet } from '../components/MoreFunctionsSheet';
import { QuoteAssetSelector } from '../components/QuoteAssetSelector';
import { getCoinIcon, getColorForAsset } from '../utils';
import { getAssetConversionRate } from '../utils/assetConversion';
import { formatQuotePrice } from '../utils/quoteDisplay';
import { useUnlock } from '../hooks/useUnlock';

// 首页 Tab 类型
type HomeTabType = 'favorites' | 'hot' | 'gainers' | 'losers';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

// 快捷操作按钮配置
const quickActions = [
  { id: 'transfer', icon: 'arrow-up', label: '转账' },
  { id: 'receive', icon: 'arrow-down', label: '收款' },
  { id: 'buy', icon: 'credit-card-outline', label: '买币' },
  { id: 'flashSwap', icon: 'lightning-bolt', label: '闪兑' },
  { id: 'more', icon: 'dots-horizontal', label: '更多' },
];

// 首页固定 Tab 配置
const assetTabs: { key: HomeTabType; label: string }[] = [
  { key: 'favorites', label: '自选' },
  { key: 'hot', label: '热门榜' },
  { key: 'gainers', label: '涨幅榜' },
  { key: 'losers', label: '跌幅榜' },
];

const HomeScreen: React.FC = () => {
  const announcementScrollRef = useRef<ScrollView>(null);
  const announcementPageWidth = Dimensions.get('window').width;
  // 导航
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const currentAccount = useAccountStore(state => state.currentAccount);
  const [walletUnlocked, setWalletUnlocked] = useState(() => (
    currentAccount ? unlockSession.isActive(currentAccount.id) : false
  ));
  const { requestUnlock } = useUnlock({
    onSuccess: () => Toast.success('钱包已解锁，当前处于 1 小时免验证期'),
  });

  useEffect(() => {
    const syncUnlockState = () => {
      setWalletUnlocked(currentAccount ? unlockSession.isActive(currentAccount.id) : false);
    };

    syncUnlockState();
    return unlockSession.subscribe(syncUnlockState);
  }, [currentAccount]);

  // 从 AppStore 获取数据
  const { announcements } = useAppStore();
  const visibleAnnouncements = useMemo(
    () => announcements.filter(item => item.enabled !== false && (!item.expiresAt || item.expiresAt > Date.now())),
    [announcements],
  );

  // 从 BalanceStore 获取总资产估值
  const totalEstimatedValue = useTotalEstimatedValue();
  const valuationAsset = useValuationAsset();

  // 从 MarketStore 获取市场数据
  const allMarketList = useComputedMarketList();
  const tickerMap = useMarketStore(state => state.tickerMap);
  const selectedQuoteAsset = useMarketStore(state => state.selectedQuoteAsset);
  const favoritesList = useFavoritesList();

  // 当前选中的 Tab - 有自选则默认选中自选，否则默认选中热门
  const [selectedTab, setSelectedTab] = useState<HomeTabType>(() => {
    return favoritesList.length > 0 ? 'favorites' : 'hot';
  });

  // 当前公告索引
  const [, setCurrentAnnouncementIndex] = useState(0);

  // 公告每 10 秒自动轮播；手动滑动时由分页回调更新当前索引。
  useEffect(() => {
    setCurrentAnnouncementIndex(0);
    announcementScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [visibleAnnouncements.length]);

  useEffect(() => {
    if (visibleAnnouncements.length <= 1) return undefined;
    const timer = setInterval(() => {
      setCurrentAnnouncementIndex(previous => {
        const next = (previous + 1) % visibleAnnouncements.length;
        announcementScrollRef.current?.scrollTo({ x: next * announcementPageWidth, animated: true });
        return next;
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [visibleAnnouncements.length, announcementPageWidth]);

  // 是否显示资产
  const [showBalance, setShowBalance] = useState(true);

  // 去重后的市场列表（同一交易对可能在多个分组中出现，只保留第一个）
  const uniqueMarketList = useMemo(() => {
    const seen = new Set<string>();
    return allMarketList.filter(item => {
      if (selectedQuoteAsset && item.quoteAsset !== selectedQuoteAsset) return false;
      const pairKey = `${item.baseAsset}_${item.quoteAsset}`;
      if (seen.has(pairKey)) {
        return false;
      }
      seen.add(pairKey);
      return true;
    });
  }, [allMarketList, selectedQuoteAsset]);

  // 计算热门榜（成交额 Top5）
  const hotList = useMemo(() => {
    return [...uniqueMarketList]
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 5);
  }, [uniqueMarketList]);

  // 计算涨幅榜（涨幅 Top5）
  const gainersList = useMemo(() => {
    return [...uniqueMarketList]
      .sort((a, b) => b.change24h - a.change24h)
      .slice(0, 5);
  }, [uniqueMarketList]);

  // 计算跌幅榜（跌幅 Top5，即涨幅最小的）
  const losersList = useMemo(() => {
    return [...uniqueMarketList]
      .sort((a, b) => a.change24h - b.change24h)
      .slice(0, 5);
  }, [uniqueMarketList]);

  // 根据当前 Tab 获取对应的列表
  const topList = useMemo(() => {
    switch (selectedTab) {
      case 'favorites':
        // 自选按涨跌幅降序，最多显示5个
        return [...favoritesList]
          .filter(item => !selectedQuoteAsset || item.quoteAsset === selectedQuoteAsset)
          .sort((a, b) => b.change24h - a.change24h)
          .slice(0, 5);
      case 'hot':
        return hotList;
      case 'gainers':
        return gainersList;
      case 'losers':
        return losersList;
      default:
        return [];
    }
  }, [selectedTab, favoritesList, hotList, gainersList, losersList, selectedQuoteAsset]);

  // 启动后台服务
  useEffect(() => {
    if (!backgroundService.getIsRunning()) {
      console.log('[HomeScreen] 启动后台数据更新服务');
      backgroundService.start();
    }

    return () => {
      // 注意：通常不在首页卸载时停止服务
    };
  }, []);

  // 渲染头部区域
  const renderHeader = () => (
    <View style={styles.header}>
      {/* 资产估值标题行 */}
      <View style={styles.headerTitleRow}>
        <View style={styles.headerTitleLeft}>
          <Text style={styles.headerTitle}>总资产估值</Text>
          <TouchableOpacity onPress={() => setShowBalance(!showBalance)}>
            <Icon
              name={showBalance ? 'eye-outline' : 'eye-off-outline'}
              size={18}
              color="#666666"
              style={styles.eyeIcon}
            />
          </TouchableOpacity>
        </View>

        {/* 充值、提现和设置按钮 */}
        <View style={styles.headerButtons}>
          <TouchableOpacity style={styles.headerButton} onPress={() => navigation.navigate('BSCDeposit')}>
            <Text style={styles.headerButtonText}>充值</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.headerButton, styles.headerButtonOutline]} onPress={() => navigation.navigate('BSCWithdraw')}>
            <Text style={styles.headerButtonTextOutline}>提现</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Icon name="cog-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => requestUnlock({ forcePin: true })}
            accessibilityRole="button"
            accessibilityLabel={walletUnlocked ? '钱包已解锁' : '使用 PIN 解锁'}
          >
            <Icon
              name={walletUnlocked ? 'lock-open-outline' : 'lock-outline'}
              size={22}
              color={walletUnlocked ? '#00D094' : '#FFFFFF'}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* 资产金额 */}
      <View style={styles.balanceContainer}>
        <Text style={styles.balanceAmount}>
          {showBalance ? totalEstimatedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '****'}
        </Text>
        <Text style={styles.balanceCurrency}>{valuationAsset}</Text>
      </View>
    </View>
  );

  // 处理快捷操作点击
  const handleQuickAction = (actionId: string) => {
    switch (actionId) {
      case 'transfer':
        navigation.navigate('Transfer', {});
        break;
      case 'receive':
        navigation.navigate('BSCDeposit');
        break;
      case 'buy':
        Toast.show('敬请期待');
        break;
      case 'flashSwap':
        navigation.navigate('FlashSwap');
        break;
      case 'more':
        // 显示更多功能菜单（网格布局）
        MoreFunctionsSheet.show({
          items: [
            {
              key: 'lending',
              label: '借贷',
              icon: 'bank-outline',
              iconColor: '#00D094',
              iconBgColor: 'rgba(0, 208, 148, 0.15)',
              onPress: () => {
                navigation.navigate('Lending');
              },
            },
            {
              key: 'finance',
              label: '理财',
              icon: 'chart-line',
              iconColor: '#FFB800',
              iconBgColor: 'rgba(255, 184, 0, 0.15)',
              onPress: () => {
                Toast.show('敬请期待');
              },
            },
            {
              key: 'bridgeHistory',
              label: '充提查询',
              icon: 'history',
              iconColor: '#F0B90B',
              iconBgColor: 'rgba(240, 185, 11, 0.15)',
              onPress: () => {
                navigation.navigate('BSCHistory');
              },
            },
          ],
        });
        break;
    }
  };

  // 渲染快捷操作区域
  const renderQuickActions = () => (
    <View style={styles.quickActionsContainer}>
      {quickActions.map((action) => (
        <TouchableOpacity
          key={action.id}
          style={styles.quickActionItem}
          onPress={() => handleQuickAction(action.id)}
        >
          <View style={styles.quickActionIcon}>
            <Icon name={action.icon} size={24} color="#FFFFFF" />
          </View>
          <Text style={styles.quickActionLabel}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // 渲染公告区域
  const renderAnnouncement = () => {
    if (visibleAnnouncements.length === 0) return null;

    return (
      <ScrollView
        ref={announcementScrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          const index = Math.round(event.nativeEvent.contentOffset.x / announcementPageWidth);
          setCurrentAnnouncementIndex(Math.max(0, Math.min(index, visibleAnnouncements.length - 1)));
        }}
      >
        {visibleAnnouncements.map((announcement, index) => <View key={announcement.id} style={{ width: announcementPageWidth }}>
          <TouchableOpacity style={styles.announcementContainer}>
            <View style={styles.announcementContent}>
              {/* 左侧图标 */}
              <View style={styles.announcementIconContainer}>
                <View style={styles.announcementIcon}>
                  <Text style={styles.announcementIconText}>$</Text>
                </View>
              </View>

              {/* 公告内容 */}
              <View style={styles.announcementTextContainer}>
                <View style={styles.announcementHeader}>
                  <View style={styles.announcementBadge}>
                    <Text style={styles.announcementBadgeText}>{announcement.title}</Text>
                  </View>
                  <Text style={styles.announcementIndex}>{index + 1}/{visibleAnnouncements.length}</Text>
                </View>
                <Text style={styles.announcementText} numberOfLines={2}>
                  {announcement.content}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>)}
      </ScrollView>
    );
  };

  // 渲染资产分类 Tab
  const renderAssetTabs = () => (
    <View style={styles.assetTabsContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rankTabsScroll}>
      {assetTabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={[
            styles.assetTab,
            selectedTab === tab.key && styles.assetTabActive,
          ]}
          onPress={() => setSelectedTab(tab.key)}
        >
          <Text
            style={[
              styles.assetTabText,
              selectedTab === tab.key && styles.assetTabTextActive,
            ]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
      </ScrollView>
      <QuoteAssetSelector />
    </View>
  );

  // 格式化价格
  const formatPrice = (price: number) => {
    if (price < 1) {
      return price.toFixed(5);
    }
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // 渲染单个加密货币项
  const renderCryptoItem = ({ item }: { item: ComputedMarketItem }) => {
    const isPositive = item.change24h >= 0;
    const coinIcon = getCoinIcon(item.baseAsset);
    const coinColor = getColorForAsset(item.baseAsset);

    return (
      <TouchableOpacity
        style={styles.cryptoItem}
        onPress={() => {
          // 跳转到 K 线页面
          const marketItem = {
            id: item.id,
            symbol: item.symbol,
            baseAsset: item.baseAsset,
            quoteAsset: item.quoteAsset,
            price: item.price,
            priceUsd: item.price * getAssetConversionRate(item.quoteAsset, 'USD', tickerMap),
            change24h: item.change24h,
            volume24h: item.volume24h,
            volume24hDisplay: item.volume24hDisplay,
            volumeUnit: item.volumeUnit,
            high24h: item.high24h,
            low24h: item.low24h,
            amount24h: item.amount24h,
            amount24hDisplay: item.amount24hDisplay,
            amountUnit: item.amountUnit,
            color: item.color,
            category: item.groupKey as any,
            isFavorite: item.isFavorite,
          };
          navigation.navigate('KLine', { marketItem });
        }}
      >
        {/* 左侧：图标和名称 */}
        <View style={styles.cryptoLeft}>
          {coinIcon ? (
            <Image source={coinIcon} style={styles.cryptoIconImage} />
          ) : (
            <View style={[styles.cryptoIcon, { backgroundColor: coinColor }]}>
              <Text style={styles.cryptoIconText}>
                {item.baseAsset.charAt(0)}
              </Text>
            </View>
          )}
          <View style={styles.cryptoNameContainer}>
            <Text style={styles.cryptoSymbol}>{item.baseAsset}</Text>
            <Text style={styles.cryptoName}>{item.quoteAsset}</Text>
          </View>
        </View>

        {/* 右侧：价格和涨跌幅 */}
        <View style={styles.cryptoRight}>
          <View style={styles.cryptoPriceContainer}>
            <Text style={styles.cryptoPrice}>
              {formatPrice(item.price)}
            </Text>
            <Text style={styles.cryptoPriceUsd}>
              {formatQuotePrice(item.price, item.quoteAsset, formatPrice)}
            </Text>
          </View>
          <View
            style={[
              styles.changeContainer,
              isPositive ? styles.changePositive : styles.changeNegative,
            ]}
          >
            <Text style={styles.changeText}>
              {isPositive ? '+' : ''}{item.change24h.toFixed(2)}%
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // 渲染空列表提示
  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <Icon name="chart-line" size={36} color="#333333" />
      <Text style={styles.emptyText}>
        {selectedTab === 'favorites' ? '暂无自选' : selectedQuoteAsset ? `暂无 ${selectedQuoteAsset} 交易对` : '暂无数据'}
      </Text>
      {selectedTab === 'favorites' && (
        <Text style={styles.emptySubText}>
          去行情页面添加自选吧
        </Text>
      )}
    </View>
  );

  // 渲染加密货币列表
  const renderCryptoList = () => (
    <View>
      {topList.length > 0 ? (
        <FlatList
          data={topList}
          renderItem={renderCryptoItem}
          keyExtractor={(item) => `${item.baseAsset}_${item.quoteAsset}`}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        renderEmptyList()
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* 头部资产区域 */}
        {renderHeader()}

        {/* 快捷操作 */}
        {renderQuickActions()}

        {/* 公告区域 */}
        {renderAnnouncement()}

        {/* 资产分类 Tab */}
        {renderAssetTabs()}

        {/* 加密货币列表 (Top5) */}
        {renderCryptoList()}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },

  // 头部样式
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 14,
    color: '#888888',
  },
  eyeIcon: {
    marginLeft: 8,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
  },
  headerButtonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#333333',
  },
  headerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  headerButtonTextOutline: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A1A1A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  balanceAmount: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  balanceCurrency: {
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 8,
  },

  // 快捷操作样式
  quickActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  quickActionItem: {
    alignItems: 'center',
  },
  quickActionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1A1A1A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionLabel: {
    fontSize: 12,
    color: '#888888',
  },

  // 公告样式
  announcementContainer: {
    marginHorizontal: 20,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  announcementContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  announcementIconContainer: {
    marginRight: 12,
  },
  announcementIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2D2D2D',
    justifyContent: 'center',
    alignItems: 'center',
  },
  announcementIconText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00D094',
  },
  announcementTextContainer: {
    flex: 1,
  },
  announcementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  announcementBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  announcementBadgeText: {
    fontSize: 12,
    color: '#00D094',
    marginLeft: 4,
  },
  announcementIndex: {
    fontSize: 12,
    color: '#666666',
  },
  announcementText: {
    fontSize: 14,
    color: '#CCCCCC',
    lineHeight: 20,
  },

  // 资产 Tab 样式
  assetTabsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  rankTabsScroll: { flex: 1 },
  assetTab: {
    marginRight: 24,
    paddingBottom: 8,
  },
  assetTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#FFFFFF',
  },
  assetTabText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: '500',
  },
  assetTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // 加密货币列表样式
  cryptoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  cryptoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cryptoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cryptoIconImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  cryptoIconText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  cryptoNameContainer: {
    justifyContent: 'center',
  },
  cryptoSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  cryptoName: {
    fontSize: 12,
    color: '#666666',
  },
  cryptoRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cryptoPriceContainer: {
    alignItems: 'flex-end',
    marginRight: 12,
  },
  cryptoPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  cryptoPriceUsd: {
    fontSize: 12,
    color: '#666666',
  },
  changeContainer: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    minWidth: 72,
    alignItems: 'center',
  },
  changePositive: {
    backgroundColor: '#00D094',
  },
  changeNegative: {
    backgroundColor: '#FF4757',
  },
  changeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // 空列表样式
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    color: '#666666',
    marginTop: 12,
  },
  emptySubText: {
    fontSize: 12,
    color: '#444444',
    marginTop: 4,
  },
});

export default HomeScreen;
