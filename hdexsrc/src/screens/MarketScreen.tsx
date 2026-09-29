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

import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
  TextInput,
  Image,
  Modal,
  Alert,
  ActivityIndicator,
  ScrollView,
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
import { getAssetConversionRate } from '../utils/assetConversion';
import { CURRENT_NETWORK_TYPE, DEFAULT_MAINNET_MARKET_GROUP } from '../config';
import { backgroundService, chainServiceMgr } from '../services';
import { QuoteAssetSelector } from '../components/QuoteAssetSelector';
import { formatQuotePrice } from '../utils/quoteDisplay';

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
  const tickerMap = useMarketStore(state => state.tickerMap);
  const chainMarketsLoaded = useMarketStore(state => state.chainMarketsLoaded);
  const chainMarketsLoading = useMarketStore(state => state.chainMarketsLoading);
  const chainMarketsError = useMarketStore(state => state.chainMarketsError);
  const selectedQuoteAsset = useMarketStore(state => state.selectedQuoteAsset);
  const sortState = useMarketStore(state => state.sortState);
  const searchKeyword = useMarketStore(state => state.searchKeyword);
  const appSettings = useChainConfigStore(state => state.appSettings);
  const setSelectedCategory = useMarketStore(state => state.setSelectedCategory);
  const setSortState = useMarketStore(state => state.setSortState);
  const setSearchKeyword = useMarketStore(state => state.setSearchKeyword);
  const customPairs = useMarketStore(state => state.customPairs);
  const addCustomPair = useMarketStore(state => state.addCustomPair);
  const removeCustomPair = useMarketStore(state => state.removeCustomPair);

  const [showAddPairModal, setShowAddPairModal] = useState(false);
  const [baseInput, setBaseInput] = useState('');
  const [quoteInput, setQuoteInput] = useState('');
  const [isAddingPair, setIsAddingPair] = useState(false);

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
      // 主网使用链上管理员配置的主区；其他网络使用链上配置的第一个分组。
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

    tabs.push({ key: DEFAULT_MAINNET_MARKET_GROUP, label: '主区' });
    if (CURRENT_NETWORK_TYPE !== 'mainnet' && appSettings?.markets) {
      appSettings.markets.forEach(market => {
        const key = market.base.name;
        tabs.push({
          key,
          label: getDynamicLang(key),
        });
      });
    }

    const customGroupKey = appSettings?.parameters?.custom_pair_default_groupkey || 'custom';
    if (!tabs.some(tab => tab.key === customGroupKey)) {
      tabs.push({ key: customGroupKey, label: '自定义' });
    }

    return tabs;
  }, [appSettings]);

  const handleAddCustomPair = useCallback(async () => {
    const base = baseInput.trim().toUpperCase();
    const quote = quoteInput.trim().toUpperCase();

    if (!base || !quote) {
      Alert.alert('提示', '请输入基础资产和报价资产');
      return;
    }
    if (base === quote) {
      Alert.alert('提示', '基础资产和报价资产不能相同');
      return;
    }

    const pairKey = `${base}_${quote}`;
    if (customPairs.length >= 100) {
      Alert.alert('提示', '最多保存 100 个自定义交易对');
      return;
    }
    const existsInMarket = allMarketList.some(item => `${item.baseAsset}_${item.quoteAsset}` === pairKey);
    if (existsInMarket) {
      Alert.alert('提示', '该交易对已经存在');
      return;
    }

    setIsAddingPair(true);
    try {
      // 只接受当前链上真实存在的资产，资产 ID/精度由节点返回。
      const assets = await chainServiceMgr.queryAssetsBySymbols([base, quote]);
      if (!assets.get(base) || !assets.get(quote)) {
        Alert.alert('添加失败', `未找到资产 ${!assets.get(base) ? base : quote}`);
        return;
      }

      const added = await addCustomPair(base, quote);
      if (!added) {
        Alert.alert('提示', '该交易对已经存在');
        return;
      }

      setBaseInput('');
      setQuoteInput('');
      setShowAddPairModal(false);
      setSelectedCategory(appSettings?.parameters?.custom_pair_default_groupkey || 'custom');
      // 新交易对加入后立即刷新一次行情，不必等待后台 10 秒轮询。
      backgroundService.refreshTickers().catch(error => {
        console.warn('[MarketScreen] 新交易对行情刷新失败:', error);
      });
      Alert.alert('添加成功', `${base}/${quote} 已加入自定义交易对`);
    } catch (error) {
      console.error('[MarketScreen] 添加自定义交易对失败:', error);
      Alert.alert('添加失败', '资产查询失败，请检查网络连接后重试');
    } finally {
      setIsAddingPair(false);
    }
  }, [addCustomPair, allMarketList, appSettings, baseInput, customPairs.length, quoteInput, setSelectedCategory]);

  const handleRemoveCustomPair = useCallback((item: ComputedMarketItem) => {
    Alert.alert('删除交易对', `确定删除 ${item.symbol}？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => removeCustomPair(`${item.baseAsset}_${item.quoteAsset}`),
      },
    ]);
  }, [removeCustomPair]);

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
      category: item.groupKey as MarketCategory,
      isFavorite: item.isFavorite,
    };
    navigation.navigate('KLine', { marketItem });
  }, [navigation, tickerMap]);

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
      <TouchableOpacity
        style={styles.addPairButton}
        onPress={() => setShowAddPairModal(true)}
        accessibilityLabel="添加自定义交易对"
      >
        <Icon name="plus" size={24} color="#00D094" />
      </TouchableOpacity>
    </View>
  );

  // 渲染分类 Tab
  const renderCategoryTabs = () => (
    <View style={styles.tabsContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
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
      </ScrollView>
      <QuoteAssetSelector />
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
          <Text style={styles.priceUsdText}>{formatQuotePrice(item.price, item.quoteAsset, formatPrice)}</Text>
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
        {customPairs.some(pair => pair.pairKey === `${item.baseAsset}_${item.quoteAsset}`) && (
          <TouchableOpacity
            style={styles.removePairButton}
            onPress={() => handleRemoveCustomPair(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close-circle-outline" size={18} color="#666666" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  // 渲染空列表提示
  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      {chainMarketsLoading && !chainMarketsLoaded
        ? <ActivityIndicator size="large" color="#00D094" />
        : <Icon name="chart-line" size={48} color="#333333" />}
      <Text style={styles.emptyText}>
        {chainMarketsLoading && !chainMarketsLoaded ? '正在加载链上市场...' :
          chainMarketsError && !chainMarketsLoaded ? chainMarketsError :
          selectedCategory === 'favorites' ? '暂无自选' :
          selectedQuoteAsset ? `暂无 ${selectedQuoteAsset} 交易对` : '暂无交易对'}
      </Text>
      {chainMarketsError && !chainMarketsLoading && (
        <TouchableOpacity onPress={() => backgroundService.refreshChainMarkets(true)}>
          <Text style={styles.emptySubText}>点击重试</Text>
        </TouchableOpacity>
      )}
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
        refreshing={chainMarketsLoading && chainMarketsLoaded}
        onRefresh={() => backgroundService.refreshChainMarkets(true)}
      />

      <Modal
        visible={showAddPairModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddPairModal(false)}
      >
        <View style={styles.addPairOverlay}>
          <View style={styles.addPairCard}>
            <View style={styles.addPairHeader}>
              <Text style={styles.addPairTitle}>添加自定义交易对</Text>
              <TouchableOpacity onPress={() => setShowAddPairModal(false)}>
                <Icon name="close" size={22} color="#888888" />
              </TouchableOpacity>
            </View>
            <Text style={styles.addPairHint}>请输入当前链上存在的资产符号</Text>
            <TextInput
              style={styles.pairInput}
              placeholder="基础资产，例如 DFS"
              placeholderTextColor="#666666"
              autoCapitalize="characters"
              value={baseInput}
              onChangeText={setBaseInput}
            />
            <TextInput
              style={styles.pairInput}
              placeholder="报价资产，例如 USDT"
              placeholderTextColor="#666666"
              autoCapitalize="characters"
              value={quoteInput}
              onChangeText={setQuoteInput}
            />
            <View style={styles.addPairActions}>
              <TouchableOpacity
                style={styles.cancelPairButton}
                onPress={() => setShowAddPairModal(false)}
                disabled={isAddingPair}
              >
                <Text style={styles.cancelPairText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmPairButton}
                onPress={handleAddCustomPair}
                disabled={isAddingPair}
              >
                {isAddingPair ? (
                  <ActivityIndicator size="small" color="#06130F" />
                ) : (
                  <Text style={styles.confirmPairText}>添加</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 44,
  },
  addPairButton: {
    width: 44,
    height: 44,
    marginLeft: 8,
    borderRadius: 22,
    backgroundColor: '#12251F',
    alignItems: 'center',
    justifyContent: 'center',
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
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  categoryScroll: { flex: 1 },
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
  removePairButton: {
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
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

  // 添加自定义交易对弹窗
  addPairOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  addPairCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 20,
  },
  addPairHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addPairTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  addPairHint: {
    color: '#888888',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  pairInput: {
    height: 46,
    borderRadius: 8,
    backgroundColor: '#252525',
    color: '#FFFFFF',
    paddingHorizontal: 14,
    marginBottom: 12,
    fontSize: 15,
  },
  addPairActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  cancelPairButton: {
    minWidth: 80,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cancelPairText: {
    color: '#AAAAAA',
    fontSize: 15,
  },
  confirmPairButton: {
    minWidth: 80,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#00D094',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmPairText: {
    color: '#06130F',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default MarketScreen;
