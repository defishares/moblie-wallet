/**
 * 市场行情页面组件
 * 底部导航栏第二个 Tab - 市场
 * 
 * 功能：
 * 1. 顶部搜索栏（带热搜提示）
 * 2. 分类 Tab（自选 + 链上动态配置的分组）
 * 3. 列表表头（支持排序）
 * 4. 行情列表（显示交易对、成交额、价格、涨跌幅）
 * 5. 点击行跳转到 K 线详情页
 */

import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
  TextInput,
  Image,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  useMarketStore,
  useFilteredMarketList,
  useComputedMarketList,
  useFavoritesList,
  type ComputedMarketItem,
} from '../store/useMarketStore';
import { useChainConfigStore, getDynamicLang } from '../store/useChainConfigStore';
import type {
  MarketCategory,
  SortField,
  SortDirection,
  RootStackParamList,
} from '../types';
import { getCoinIcon, getColorForAsset } from '../utils';
import { CURRENT_NETWORK_TYPE, DEFAULT_MAINNET_MARKET_GROUP } from '../config';
import { backgroundService } from '../services';

// 导航类型
type MarketScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

// 表头排序配置
type SortColumnConfig = {
  type: 'single' | 'double';
  flex: number;
  items: { field: SortField; label: string }[];
};

const sortColumns: SortColumnConfig[] = [
  {
    type: 'double',
    flex: 2.2,
    items: [
      { field: 'name', label: '名称' },
      { field: 'volume', label: '成交额' },
    ]
  },
  {
    type: 'single',
    flex: 1,
    items: [{ field: 'price', label: '最新价' }]
  },
  {
    type: 'single',
    flex: 1,
    items: [{ field: 'change', label: '24h涨跌幅' }]
  },
];

const MarketScreen: React.FC = () => {
  const navigation = useNavigation<MarketScreenNavigationProp>();

  // 从 MarketStore 获取状态和方法
  const selectedCategory = useMarketStore(state => state.selectedCategory);
  const sortState = useMarketStore(state => state.sortState);
  const searchKeyword = useMarketStore(state => state.searchKeyword);
  const appSettings = useChainConfigStore(state => state.appSettings);
  const setSelectedCategory = useMarketStore(state => state.setSelectedCategory);
  const setSortState = useMarketStore(state => state.setSortState);
  const setSearchKeyword = useMarketStore(state => state.setSearchKeyword);

  // 使用衍生数据 hook 获取过滤后的列表（响应式）
  const filteredList = useFilteredMarketList();

  // 获取自选列表
  const favoritesList = useFavoritesList();

  // 获取完整市场列表用于计算热门榜
  const allMarketList = useComputedMarketList();

  // 标记是否已初始化默认选中
  const hasInitializedDefault = useRef(false);

  // 初始化默认选中的分类
  // 有自选则默认选中自选，否则选择 appSettings.markets 的第一个（如果存在），不存在也是自选
  useEffect(() => {
    if (hasInitializedDefault.current) return;

    if (favoritesList.length > 0) {
      // 有自选，选中自选
      setSelectedCategory('favorites');
    } else if (CURRENT_NETWORK_TYPE === 'mainnet' || !appSettings?.markets?.length) {
      // 主网使用内置核心交易对组；其他网络使用链上配置的第一个分组。
      setSelectedCategory(
        (CURRENT_NETWORK_TYPE === 'mainnet' || !appSettings?.markets?.length
          ? DEFAULT_MAINNET_MARKET_GROUP
          : appSettings!.markets[0].base.name) as MarketCategory
      );
    } else {
      // 都没有，默认自选
      setSelectedCategory('favorites');
    }

    hasInitializedDefault.current = true;
  }, [favoritesList, appSettings, setSelectedCategory]);

  // 去重后的市场列表（同一交易对可能在多个分组中出现，只保留第一个）
  const uniqueMarketList = useMemo(() => {
    const seen = new Set<string>();
    return allMarketList.filter(item => {
      const pairKey = `${item.baseAsset}_${item.quoteAsset}`;
      if (seen.has(pairKey)) {
        return false;
      }
      seen.add(pairKey);
      return true;
    });
  }, [allMarketList]);

  // 热门榜第一（成交额最高）- 用于搜索栏热搜提示
  const hotSearchTicker = useMemo(() => {
    if (uniqueMarketList.length === 0) return 'BTC';

    const sorted = [...uniqueMarketList].sort((a, b) => b.volume24h - a.volume24h);

    return sorted[0]?.baseAsset || 'BTC';
  }, [uniqueMarketList]);

  // 直接打开行情页时也启动实时 ticker 刷新服务。
  useEffect(() => {
    if (!backgroundService.getIsRunning()) {
      backgroundService.start();
    }
  }, []);

  // 动态构建分类 Tab（从链上配置获取）
  const categoryTabs = useMemo(() => {
    const tabs: { key: string; label: string }[] = [
      { key: 'favorites', label: '自选' },
    ];

    if (CURRENT_NETWORK_TYPE === 'mainnet' || !appSettings?.markets?.length) {
      tabs.push({ key: DEFAULT_MAINNET_MARKET_GROUP, label: '主网' });
    } else if (appSettings?.markets) {
      appSettings.markets.forEach(market => {
        const key = market.base.name;
        tabs.push({
          key,
          label: getDynamicLang(key),
        });
      });
    }

    return tabs;
  }, [appSettings]);

  // 处理排序点击
  const handleSortPress = useCallback((field: SortField) => {
    let newDirection: SortDirection = 'desc';

    if (sortState.field === field) {
      // 同一列：切换排序方向 none -> desc -> asc -> none
      if (sortState.direction === 'none') {
        newDirection = 'desc';
      } else if (sortState.direction === 'desc') {
        newDirection = 'asc';
      } else {
        newDirection = 'none';
      }
    }

    setSortState({ field, direction: newDirection });
  }, [sortState, setSortState]);

  // 处理行点击 - 跳转到 K 线详情页
  const handleItemPress = useCallback((item: ComputedMarketItem) => {
    // 转换为 MarketItem 格式用于导航
    const marketItem = {
      id: item.id,
      symbol: item.symbol,
      baseAsset: item.baseAsset,
      quoteAsset: item.quoteAsset,
      price: item.price,
      priceUsd: item.price,
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
      category: item.groupKey as MarketCategory,
      isFavorite: item.isFavorite,
    };
    navigation.navigate('KLine', { marketItem });
  }, [navigation]);

  // 渲染搜索栏
  const renderSearchBar = () => (
    <View style={styles.searchContainer}>
      <View style={styles.searchInputWrapper}>
        <Icon name="magnify" size={20} color="#666666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder={`${hotSearchTicker} 当前热搜`}
          placeholderTextColor="#666666"
          value={searchKeyword}
          onChangeText={setSearchKeyword}
        />
        {/* 热搜火焰图标 */}
        {!searchKeyword && (
          <Text style={styles.hotIcon}>🔥</Text>
        )}
      </View>
    </View>
  );

  // 渲染分类 Tab
  const renderCategoryTabs = () => (
    <View style={styles.tabsContainer}>
      {categoryTabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={[
            styles.tabItem,
            selectedCategory === tab.key && styles.tabItemActive,
          ]}
          onPress={() => setSelectedCategory(tab.key as MarketCategory)}
        >
          <Text
            style={[
              styles.tabText,
              selectedCategory === tab.key && styles.tabTextActive,
            ]}
          >
            {tab.label}
          </Text>
          {selectedCategory === tab.key && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
      ))}
    </View>
  );

  // 渲染排序箭头（上下两个三角形）
  const renderSortArrows = (field: SortField) => {
    const isActive = sortState.field === field && sortState.direction !== 'none';
    const isAsc = isActive && sortState.direction === 'asc';
    const isDesc = isActive && sortState.direction === 'desc';

    return (
      <View style={styles.sortArrowsContainer}>
        <Text style={[
          styles.sortArrowUp,
          isAsc && styles.sortArrowActive
        ]}>▲</Text>
        <Text style={[
          styles.sortArrowDown,
          isDesc && styles.sortArrowActive
        ]}>▼</Text>
      </View>
    );
  };

  // 渲染列表表头
  const renderListHeader = () => (
    <View style={styles.listHeader}>
      {sortColumns.map((column, columnIndex) => (
        <View key={columnIndex} style={[
          styles.headerCell,
          { flex: column.flex },
          // 单排序项（最新价、涨跌幅）右对齐
          column.type === 'single' && styles.headerCellRight
        ]}>
          {column.type === 'double' ? (
            // 双排序项（名称 / 成交额）
            <View style={styles.doubleHeaderCell}>
              {column.items.map((item, itemIndex) => (
                <React.Fragment key={item.field}>
                  <TouchableOpacity
                    style={styles.headerSortItem}
                    onPress={() => handleSortPress(item.field)}
                  >
                    <Text style={styles.headerText}>{item.label}</Text>
                    {renderSortArrows(item.field)}
                  </TouchableOpacity>
                  {itemIndex < column.items.length - 1 && (
                    <Text style={styles.headerSeparator}>/</Text>
                  )}
                </React.Fragment>
              ))}
            </View>
          ) : (
            // 单排序项 - 右对齐
            <TouchableOpacity
              style={styles.headerSortItem}
              onPress={() => handleSortPress(column.items[0].field)}
            >
              <Text style={styles.headerText}>{column.items[0].label}</Text>
              {renderSortArrows(column.items[0].field)}
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );

  // 格式化成交额显示
  const formatVolume = (volume: number, unit: string) => {
    return `$${volume.toLocaleString()}${unit}`;
  };

  // 格式化价格显示
  const formatPrice = (price: number) => {
    if (price < 0.0001) {
      return price.toFixed(6);
    } else if (price < 1) {
      return price.toFixed(6);
    } else if (price < 100) {
      return price.toFixed(2);
    } else {
      return price.toLocaleString(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      });
    }
  };

  // 渲染单个行情项
  const renderMarketItem = ({ item }: { item: ComputedMarketItem }) => {
    const isPositive = item.change24h >= 0;
    const coinIcon = getCoinIcon(item.baseAsset);
    const coinColor = getColorForAsset(item.baseAsset);

    return (
      <TouchableOpacity
        style={styles.marketItem}
        onPress={() => handleItemPress(item)}
        activeOpacity={0.7}
      >
        {/* 左侧：图标、名称和成交额 */}
        <View style={[styles.itemCell, { flex: 2.2 }]}>
          <View style={styles.itemLeft}>
            {coinIcon ? (
              <Image source={coinIcon} style={styles.coinIconImage} />
            ) : (
              <View style={[styles.coinIcon, { backgroundColor: coinColor }]}>
                <Text style={styles.coinIconText}>
                  {item.baseAsset.charAt(0)}
                </Text>
              </View>
            )}
            <View style={styles.coinInfo}>
              <View style={styles.coinNameRow}>
                <Text style={styles.coinSymbol}>{item.baseAsset}</Text>
                <Text style={styles.coinQuote}> /{item.quoteAsset}</Text>
                {/* 杠杆倍数标签 - 如有需要可动态显示 */}
              </View>
              <Text style={styles.coinVolume}>
                {formatVolume(item.volume24hDisplay, item.volumeUnit)}
              </Text>
            </View>
          </View>
        </View>

        {/* 最新价 - 右对齐 */}
        <View style={[styles.itemCell, { flex: 1, alignItems: 'flex-end' }]}>
          <Text style={styles.priceText}>{formatPrice(item.price)}</Text>
          <Text style={styles.priceUsdText}>${formatPrice(item.price)}</Text>
        </View>

        {/* 涨跌幅 - 右对齐 */}
        <View style={[styles.itemCell, { flex: 1, alignItems: 'flex-end' }]}>
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
      <Icon name="chart-line" size={48} color="#333333" />
      <Text style={styles.emptyText}>
        {selectedCategory === 'favorites' ? '暂无自选' : '暂无数据'}
      </Text>
      {selectedCategory === 'favorites' && (
        <Text style={styles.emptySubText}>
          去其他分类添加自选吧
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      {/* 搜索栏 */}
      {renderSearchBar()}

      {/* 分类 Tab */}
      {renderCategoryTabs()}

      {/* 列表表头 */}
      {renderListHeader()}

      {/* 行情列表 */}
      <FlatList
        data={filteredList}
        renderItem={renderMarketItem}
        keyExtractor={(item) => `${item.baseAsset}_${item.quoteAsset}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyList}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },

  // 搜索栏样式
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#FFFFFF',
    padding: 0,
  },
  hotIcon: {
    fontSize: 16,
    marginLeft: 8,
  },

  // 分类 Tab 样式
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  tabItem: {
    marginRight: 32,
    paddingBottom: 10,
    position: 'relative',
  },
  tabItemActive: {},
  tabText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
  },

  // 列表表头样式
  listHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  headerCell: {
    justifyContent: 'center',
  },
  headerCellRight: {
    alignItems: 'flex-end',
  },
  doubleHeaderCell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSortItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    fontSize: 12,
    color: '#666666',
  },
  headerSeparator: {
    fontSize: 12,
    color: '#666666',
    marginHorizontal: 4,
  },
  sortArrowsContainer: {
    marginLeft: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortArrowUp: {
    fontSize: 6,
    color: '#444444',
    lineHeight: 7,
  },
  sortArrowDown: {
    fontSize: 6,
    color: '#444444',
    lineHeight: 7,
  },
  sortArrowActive: {
    color: '#FFFFFF',
  },

  // 列表内容
  listContent: {
    flexGrow: 1,
  },

  // 行情项样式
  marketItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  itemCell: {
    justifyContent: 'center',
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  coinIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  coinIconImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  coinIconText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  coinInfo: {
    justifyContent: 'center',
  },
  coinNameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  coinSymbol: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  coinQuote: {
    fontSize: 12,
    color: '#666666',
  },
  coinVolume: {
    fontSize: 11,
    color: '#666666',
    marginTop: 2,
  },
  priceText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  priceUsdText: {
    fontSize: 11,
    color: '#666666',
    marginTop: 2,
  },
  changeContainer: {
    paddingHorizontal: 12,
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
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // 空列表样式
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 16,
    color: '#666666',
    marginTop: 16,
  },
  emptySubText: {
    fontSize: 14,
    color: '#444444',
    marginTop: 8,
  },
});

export default MarketScreen;
