/**
 * 资产页面组件
 * 底部导航栏第五个 Tab - 资产
 * 显示用户资产总览、快捷操作和持有资产列表
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  useBalanceItemsWithValue,
  useTotalEstimatedValue,
  useValuationAsset,
  useBalanceLoaded,
  type BalanceItemWithValue,
} from '../store/useBalanceStore';
import { backgroundService } from '../services/background_service';
import type { RootStackParamList } from '../types';
import { Toast } from '../components/Toast';
import { getCoinIcon, getColorForAsset } from '../utils';

type AssetsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

// 快捷操作按钮配置
const quickActions = [
  { id: 'deposit', icon: 'arrow-down', label: '充值' },
  { id: 'withdraw', icon: 'arrow-up', label: '提现' },
  { id: 'transfer', icon: 'swap-horizontal', label: '转账' },
  { id: 'finance', icon: 'file-document-outline', label: '理财' },
];

const AssetsScreen: React.FC = () => {
  const navigation = useNavigation<AssetsScreenNavigationProp>();

  // 从 BalanceStore 获取数据
  const balanceItems = useBalanceItemsWithValue();
  const totalValue = useTotalEstimatedValue();
  const valuationAsset = useValuationAsset();
  const isLoaded = useBalanceLoaded();

  // 是否显示资产
  const [showBalance, setShowBalance] = useState(true);
  // 刷新状态
  const [refreshing, setRefreshing] = useState(false);

  // 下拉刷新处理
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await backgroundService.refreshAccountBalance();
    } catch (error) {
      console.error('刷新余额失败:', error);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // 处理快捷操作点击
  const handleQuickAction = (actionId: string) => {
    switch (actionId) {
      case 'transfer':
        navigation.navigate('Transfer', {});
        break;
      case 'deposit':
      case 'withdraw':
      case 'finance':
        Toast.show('敬请期待');
        break;
    }
  };

  // 渲染头部区域
  const renderHeader = () => (
    <View style={styles.header}>
      {/* 资产估值标题行 */}
      <View style={styles.headerTitleRow}>
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

      {/* 资产金额 */}
      <View style={styles.balanceContainer}>
        <Text style={styles.balanceAmount}>
          {showBalance ? totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '****'}
        </Text>
        <TouchableOpacity style={styles.currencySelector}>
          <Text style={styles.balanceCurrency}>{valuationAsset}</Text>
          <Icon name="chevron-down" size={16} color="#888888" />
        </TouchableOpacity>
      </View>
    </View>
  );

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

  // 渲染资产列表标题
  const renderAssetHeader = () => (
    <View style={styles.assetHeaderContainer}>
      <Text style={styles.assetHeaderTitle}>资产</Text>
      <TouchableOpacity style={styles.filterButton}>
        <Icon name="tune-variant" size={20} color="#888888" />
      </TouchableOpacity>
    </View>
  );

  // 格式化数量显示
  const formatBalance = (value: number, precision: number = 6): string => {
    if (value === 0) return '0';
    // 根据精度动态显示小数位
    const displayPrecision = Math.min(precision, 8);
    return value.toFixed(displayPrecision).replace(/\.?0+$/, '');
  };

  // 格式化价格显示
  const formatPrice = (price: number): string => {
    if (price === 0) return '0';
    if (price < 0.0001) return price.toExponential(2);
    if (price < 1) return price.toFixed(4);
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // 渲染单个资产项
  const renderAssetItem = ({ item }: { item: BalanceItemWithValue }) => {
    const isPositive = item.change24h >= 0;
    const changeColor = item.change24h === 0 ? '#888888' : (isPositive ? '#00D094' : '#FF4757');

    // 显示各种余额类型的附加信息
    const hasExtraBalance = item.onOrder > 0 || item.collateral > 0 || item.debt > 0;

    // 获取币种图标
    const coinIcon = getCoinIcon(item.symbol);
    const coinColor = getColorForAsset(item.symbol);

    return (
      <View style={styles.assetItem}>
        {/* 左侧：图标和名称 */}
        <View style={styles.assetLeft}>
          {coinIcon ? (
            <Image source={coinIcon} style={styles.assetIconImage} />
          ) : (
            <View style={[styles.assetIcon, { backgroundColor: coinColor }]}>
              <Text style={styles.assetIconText}>
                {item.symbol.charAt(0)}
              </Text>
            </View>
          )}
          <View style={styles.assetNameContainer}>
            <Text style={styles.assetSymbol}>{item.symbol}</Text>
            <Text style={styles.assetBalance}>
              {showBalance ? formatBalance(item.available, item.precision) : '****'}
              {hasExtraBalance && showBalance && (
                <Text style={styles.extraBalanceHint}> (+)</Text>
              )}
            </Text>
          </View>
        </View>

        {/* 右侧：价值和价格 */}
        <View style={styles.assetRight}>
          <Text style={styles.assetValue}>
            {showBalance ? formatPrice(item.estimatedValue) : '****'} {valuationAsset}
          </Text>
          <Text style={[styles.assetPriceInfo, { color: changeColor }]}>
            {formatPrice(item.estimatedPrice)}
            {item.estimatedPrice > 0 && (
              <> ({isPositive ? '+' : ''}{item.change24h.toFixed(2)}%)</>
            )}
          </Text>
        </View>
      </View>
    );
  };

  // 渲染资产列表
  const renderAssetList = () => {
    if (!isLoaded) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00D094" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      );
    }

    if (balanceItems.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="wallet-outline" size={48} color="#666666" />
          <Text style={styles.emptyText}>暂无资产</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={balanceItems}
        renderItem={renderAssetItem}
        keyExtractor={(item) => item.assetId}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00D094"
            colors={['#00D094']}
          />
        }
      >
        {/* 头部资产区域 */}
        {renderHeader()}

        {/* 快捷操作 */}
        {renderQuickActions()}

        {/* 资产列表标题 */}
        {renderAssetHeader()}

        {/* 资产列表 */}
        {renderAssetList()}
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
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 14,
    color: '#888888',
  },
  eyeIcon: {
    marginLeft: 8,
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
  currencySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  balanceCurrency: {
    fontSize: 14,
    color: '#888888',
    marginRight: 4,
  },

  // 快捷操作样式
  quickActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    marginBottom: 32,
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

  // 资产列表标题样式
  assetHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  assetHeaderTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  filterButton: {
    padding: 4,
  },

  // 资产项样式
  assetItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  assetLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assetIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  assetIconImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  assetIconText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  assetNameContainer: {
    justifyContent: 'center',
  },
  assetSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  assetBalance: {
    fontSize: 12,
    color: '#666666',
  },
  assetRight: {
    alignItems: 'flex-end',
  },
  assetValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  assetPriceInfo: {
    fontSize: 12,
  },
  extraBalanceHint: {
    fontSize: 10,
    color: '#666666',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666666',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666666',
  },
});

export default AssetsScreen;
