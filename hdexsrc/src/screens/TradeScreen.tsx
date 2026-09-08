/**
 * 交易页面组件
 * 底部导航栏第三个 Tab - 交易
 * 
 * 功能：
 * 1. 顶部导航（交易对名称、K线按钮、设置按钮）
 * 2. 左侧交易面板（买入/卖出切换、限价委托、价格/数量输入、滑块、买入按钮）
 * 3. 右侧订单薄（买卖挂单深度）
 * 4. 底部委托区域（TODO 预留）
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  TextInput,
  ScrollView,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
  LayoutChangeEvent,
  Modal,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp } from '@react-navigation/native';

import { useComputedMarketList, useMarketStore, type ComputedMarketItem } from '../store/useMarketStore';
import { useChainConfigStore } from '../store/useChainConfigStore';
import { useBalanceStore, type AssetBalanceDetail } from '../store/useBalanceStore';
import { useOrdersByTradingPair, useParsedLimitOrders, type ParsedLimitOrder } from '../store/useLimitOrderStore';
import { useAccountStore } from '../store/useAccountStore';
import type { RootStackParamList, MainTabParamList, MarketItem, TradingPair, OrderBookData, OrderBookItem } from '../types';
import { chainServiceMgr, formatGrapheneError } from '../services/chainservice_mgr';
import { localCacheManager } from '../services/local_cache_mgr';
import { backgroundService } from '../services/background_service';
import { useOrderBookStore, DEFAULT_BASE_SYMBOL, DEFAULT_QUOTE_SYMBOL } from '../store/useOrderBookStore';
import { Toast } from '../components/Toast';
import { BlockView } from '../components/BlockView';
import { UnlockModal, type UnlockedKeys } from '../components/UnlockModal';
import { filterNumericInput, INPUT_DECIMAL_PRESETS } from '../utils';

// 盘口配置
const ORDER_BOOK_DISPLAY_COUNT = 5;   // 默认显示数量（5档）


// 将 MarketItem 转换为 ComputedMarketItem（用于统一内部状态类型）
const toComputedMarketItem = (item: MarketItem): ComputedMarketItem => ({
  id: item.id,
  symbol: item.symbol,
  baseAsset: item.baseAsset,
  quoteAsset: item.quoteAsset,
  price: item.price,
  change24h: item.change24h,
  volume24h: item.volume24h,
  volume24hDisplay: item.volume24hDisplay,
  volumeUnit: item.volumeUnit,
  amount24h: item.amount24h,
  amount24hDisplay: item.amount24hDisplay,
  amountUnit: item.amountUnit,
  high24h: item.high24h,
  low24h: item.low24h,
  groupKey: item.category,
  isFavorite: item.isFavorite,
  color: item.color,
});

// 将 ComputedMarketItem 转换为 MarketItem（用于导航传参）
const toMarketItem = (item: ComputedMarketItem): MarketItem => ({
  id: item.id,
  symbol: item.symbol,
  baseAsset: item.baseAsset,
  quoteAsset: item.quoteAsset,
  price: item.price,
  priceUsd: item.price, // 使用 price 作为 priceUsd
  change24h: item.change24h,
  volume24h: item.volume24h,
  volume24hDisplay: item.volume24hDisplay,
  volumeUnit: item.volumeUnit,
  amount24h: item.amount24h,
  amount24hDisplay: item.amount24hDisplay,
  amountUnit: item.amountUnit,
  high24h: item.high24h,
  low24h: item.low24h,
  category: item.groupKey,
  isFavorite: item.isFavorite,
  color: item.color,
});

// 导航类型
type TradeScreenNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Trade'>,
  NativeStackNavigationProp<RootStackParamList>
>;
type TradeScreenRouteProp = RouteProp<MainTabParamList, 'Trade'>;

// 交易方向类型
type TradeDirection = 'buy' | 'sell';

// 委托类型
type OrderType = 'limit' | 'market' | 'stop_limit';

// 数量滑块位置
const SLIDER_POSITIONS = [0, 25, 50, 75, 100];

// 格式化订单簿价格
const formatOrderBookPrice = (price: number, decimals: number = 6): string => {
  if (price < 0.0001) {
    return price.toFixed(8);
  } else if (price < 1) {
    return price.toFixed(decimals);
  } else if (price < 100) {
    return price.toFixed(4);
  } else {
    return price.toFixed(2);
  }
};

// 格式化订单簿数量
const formatOrderBookAmount = (amount: number): string => {
  if (amount < 0.0001) {
    return amount.toFixed(8);
  } else if (amount < 1) {
    return amount.toFixed(6);
  } else if (amount < 1000) {
    return amount.toFixed(4);
  } else {
    return amount.toFixed(2);
  }
};


const TradeScreen: React.FC = () => {
  const navigation = useNavigation<TradeScreenNavigationProp>();
  const route = useRoute<TradeScreenRouteProp>();

  // 从 store 获取市场数据
  const marketList = useComputedMarketList();

  // 从 store 获取余额数据
  const balanceItems = useBalanceStore(state => state.balanceItems);

  // 从 store 获取当前账户
  const currentAccount = useAccountStore(state => state.currentAccount);

  // 当前交易对（优先从路由参数获取，否则使用默认）
  const [currentMarket, setCurrentMarket] = useState<ComputedMarketItem | null>(null);

  // 交易状态
  const [tradeDirection, setTradeDirection] = useState<TradeDirection>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [total, setTotal] = useState('');
  const [sliderPosition, setSliderPosition] = useState(0);

  // 委托类型选择弹窗状态
  const [showOrderTypePicker, setShowOrderTypePicker] = useState(false);


  // 底部 Tab 状态
  const [bottomTab, setBottomTab] = useState<'orders' | 'positions'>('orders');

  // 从 OrderBook Store 获取盘口数据
  const orderBook = useOrderBookStore(state => state.orderBook);
  const tradingPair = useOrderBookStore(state => state.tradingPair);
  const isLoadingOrderBook = useOrderBookStore(state => state.isLoading);
  const orderBookError = useOrderBookStore(state => state.error);
  const storeBaseSymbol = useOrderBookStore(state => state.baseSymbol);
  const storeQuoteSymbol = useOrderBookStore(state => state.quoteSymbol);

  // 是否隐藏其他交易对（默认选中）
  const [hideOtherPairs, setHideOtherPairs] = useState(true);

  // 从 ChainConfigStore 获取链上优先级配置
  const baseAssetQuotePriority = useChainConfigStore(state => state.appSettings?.asset_quote_priority);

  // 获取当前交易对的限价单（自动将交易对的 quote 设为最高优先级）
  const { orders: currentPairOrders } = useOrdersByTradingPair(tradingPair, baseAssetQuotePriority);

  // 计算合并后的优先级（用于显示所有订单时）
  // 规则：将当前交易对的 quote 资产设置为最高优先级
  const mergedAssetQuotePriority = useMemo(() => {
    if (!tradingPair) {
      return baseAssetQuotePriority;
    }
    // 将当前交易对的 quote 设置为最高优先级
    return {
      ...baseAssetQuotePriority,
      [tradingPair.quoteSymbol]: Number.MAX_SAFE_INTEGER,
    };
  }, [baseAssetQuotePriority, tradingPair]);

  // 获取所有限价单（根据合并后的优先级动态解析）
  const allParsedOrders = useParsedLimitOrders(mergedAssetQuotePriority);

  // 根据 hideOtherPairs 决定显示的订单列表
  const displayOrders = useMemo(() => {
    if (hideOtherPairs) {
      // 当前交易对的订单
      return currentPairOrders;
    } else {
      // 所有订单（已根据合并后的优先级解析）
      return allParsedOrders;
    }
  }, [hideOtherPairs, currentPairOrders, allParsedOrders]);

  // 是否已初始化
  const isInitializedRef = useRef(false);

  // 当前聚焦周期内是否已设置过价格（每次进入页面设置一次，停留期间不再覆盖）
  const hasPriceBeenSetThisFocusRef = useRef(false);

  // 滑块轨道宽度和位置（用于拖拽计算）
  const [sliderTrackWidth, setSliderTrackWidth] = useState(0);
  const [sliderTrackX, setSliderTrackX] = useState(0);
  const sliderTrackRef = useRef<View>(null);

  // 初始化交易对
  const initializeTradingPair = useCallback(async () => {
    let baseSymbol: string;
    let quoteSymbol: string;

    // 优先级：1. 路由参数（从K线界面传入） 2. Store中的当前交易对（已由 BackgroundService 初始化）
    if (route.params?.marketItem) {
      // 从路由参数获取（K线界面跳转过来）
      baseSymbol = route.params.marketItem.baseAsset;
      quoteSymbol = route.params.marketItem.quoteAsset;
      console.log(`[TradeScreen] 使用路由参数交易对: ${baseSymbol}/${quoteSymbol}`);
    } else {
      // 使用 Store 中的当前交易对
      baseSymbol = storeBaseSymbol;
      quoteSymbol = storeQuoteSymbol;
      console.log(`[TradeScreen] 使用Store交易对: ${baseSymbol}/${quoteSymbol}`);
    }

    // 从市场列表中查找对应的 ComputedMarketItem
    const market = marketList.find(
      m => m.baseAsset === baseSymbol && m.quoteAsset === quoteSymbol
    );

    if (market) {
      setCurrentMarket(market);
      // 每次进入页面设置一次价格，停留期间不再覆盖（避免覆盖用户输入）
      if (!hasPriceBeenSetThisFocusRef.current) {
        setPrice(formatOrderBookPrice(market.price));
        hasPriceBeenSetThisFocusRef.current = true;
      }
    } else {
      // 如果市场列表中没有，创建一个临时的 ComputedMarketItem
      setCurrentMarket({
        id: `${baseSymbol}_${quoteSymbol}`,
        symbol: `${baseSymbol}/${quoteSymbol}`,
        baseAsset: baseSymbol,
        quoteAsset: quoteSymbol,
        price: 0,
        change24h: 0,
        volume24h: 0,
        volume24hDisplay: 0,
        volumeUnit: '',
        amount24h: 0,
        amount24hDisplay: 0,
        amountUnit: '',
        high24h: 0,
        low24h: 0,
        groupKey: '',
        isFavorite: false,
        color: '#888888',
      });
    }

    // 切换盘口交易对（会保存到缓存并刷新数据）
    await backgroundService.switchOrderBookTradingPair(baseSymbol, quoteSymbol);
  }, [route.params?.marketItem, marketList, storeBaseSymbol, storeQuoteSymbol]);

  // 监听真正的页面聚焦事件（只在页面切换时触发，不会因依赖变化重复触发）
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // 每次进入页面时重置标志，允许设置一次价格
      hasPriceBeenSetThisFocusRef.current = false;
    });
    return unsubscribe;
  }, [navigation]);

  // 页面聚焦时初始化
  useFocusEffect(
    useCallback(() => {
      // 页面聚焦时重新初始化
      initializeTradingPair();

      // 设置盘口刷新间隔为 1 秒
      backgroundService.setOrderBookInterval(1000);

      // 页面失焦时恢复为 3 秒
      return () => {
        backgroundService.setOrderBookInterval(3000);
      };
    }, [initializeTradingPair])
  );

  // 处理路由参数变化（从K线界面跳转过来时）
  useEffect(() => {
    if (route.params?.marketItem && isInitializedRef.current) {
      const { baseAsset, quoteAsset } = route.params.marketItem;

      // 更新当前市场
      setCurrentMarket(toComputedMarketItem(route.params.marketItem));
      // 每次进入页面设置一次价格，停留期间不再覆盖
      if (!hasPriceBeenSetThisFocusRef.current) {
        setPrice(formatOrderBookPrice(route.params.marketItem.price));
        hasPriceBeenSetThisFocusRef.current = true;
      }

      // 切换盘口交易对（会保存到缓存并刷新数据）
      backgroundService.switchOrderBookTradingPair(baseAsset, quoteAsset);
    }
    isInitializedRef.current = true;
  }, [route.params?.marketItem]);

  // 交易方向切换时重置输入
  useEffect(() => {
    setAmount('');
    setTotal('');
    setSliderPosition(0);
  }, [tradeDirection]);

  // 获取显示的买卖盘数据（显示所有加载的数据，通过 ScrollView 滚动查看）
  const displayAsks = [...orderBook.asks].reverse(); // 卖盘从低到高显示（反转以便从上到下价格递减）
  const displayBids = orderBook.bids; // 买盘从高到低显示

  // 判断涨跌
  const isPositive = currentMarket ? currentMarket.change24h >= 0 : true;
  const priceColor = isPositive ? '#00D094' : '#FF4757';

  // ============================================
  // 衍生计算：可用余额和可买/可卖数量
  // ============================================

  // 获取当前交易对的 base 和 quote 资产余额
  const { quoteBalance, baseBalance } = useMemo(() => {
    const quoteAsset = currentMarket?.quoteAsset || DEFAULT_QUOTE_SYMBOL;
    const baseAsset = currentMarket?.baseAsset || DEFAULT_BASE_SYMBOL;

    const quoteItem = balanceItems.find(item => item.symbol === quoteAsset);
    const baseItem = balanceItems.find(item => item.symbol === baseAsset);

    return {
      quoteBalance: quoteItem?.available || 0,
      baseBalance: baseItem?.available || 0,
    };
  }, [balanceItems, currentMarket?.quoteAsset, currentMarket?.baseAsset]);

  // 计算可买数量（买入模式：可用 quote 资产 / 当前价格）
  const canBuyAmount = useMemo(() => {
    const currentPrice = parseFloat(price) || 0;
    if (currentPrice <= 0 || quoteBalance <= 0) {
      return 0;
    }
    return quoteBalance / currentPrice;
  }, [quoteBalance, price]);

  // 计算可卖金额（卖出模式：可用 base 资产 × 当前价格 = 预估可获得的 quote 资产）
  const canSellValue = useMemo(() => {
    const currentPrice = parseFloat(price) || 0;
    if (currentPrice <= 0 || baseBalance <= 0) {
      return 0;
    }
    return baseBalance * currentPrice;
  }, [baseBalance, price]);

  // 根据交易方向获取可用余额和可交易数量
  const { availableBalance, availableUnit, canTradeAmount, canTradeUnit } = useMemo(() => {
    if (tradeDirection === 'buy') {
      // 买入：可用 = quote余额（USDT），可买 = 能买入的 base 数量（ETH）
      return {
        availableBalance: quoteBalance,
        availableUnit: currentMarket?.quoteAsset || DEFAULT_QUOTE_SYMBOL,
        canTradeAmount: canBuyAmount,
        canTradeUnit: currentMarket?.baseAsset || DEFAULT_BASE_SYMBOL,
      };
    } else {
      // 卖出：可用 = base余额（ETH），可卖 = 预估能获得的 quote 金额（USDT）
      return {
        availableBalance: baseBalance,
        availableUnit: currentMarket?.baseAsset || DEFAULT_BASE_SYMBOL,
        canTradeAmount: canSellValue,
        canTradeUnit: currentMarket?.quoteAsset || DEFAULT_QUOTE_SYMBOL,
      };
    }
  }, [tradeDirection, quoteBalance, baseBalance, canBuyAmount, canSellValue, currentMarket]);

  // 滑块基准数量（买入基于可买 base 数量，卖出基于可用 base 数量）
  const sliderMaxAmount = useMemo(() => {
    return tradeDirection === 'buy' ? canBuyAmount : baseBalance;
  }, [tradeDirection, canBuyAmount, baseBalance]);

  // 格式化价格
  const formatPrice = (priceValue: number) => {
    if (priceValue < 1) {
      return priceValue.toFixed(6);
    } else if (priceValue < 100) {
      return priceValue.toFixed(2);
    } else {
      return priceValue.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
  };

  // 处理打开 K线
  const handleOpenKLine = useCallback(() => {
    if (currentMarket) {
      // 将 ComputedMarketItem 转换为 MarketItem 用于导航
      navigation.navigate('KLine', {
        marketItem: toMarketItem(currentMarket),
        source: 'trade',
      });
    }
  }, [navigation, currentMarket]);

  // 处理打开设置
  const handleOpenSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  // 获取用于计算的参考价格（市价模式使用当前市场价，限价模式使用输入价格）
  const getCalculationPrice = useCallback((): number => {
    if (orderType === 'market') {
      // 市价模式：使用当前市场价格
      return currentMarket?.price || 0;
    } else {
      // 限价模式：使用输入的价格
      return parseFloat(price) || 0;
    }
  }, [orderType, currentMarket?.price, price]);

  // 处理价格变化
  const handlePriceChange = useCallback((text: string) => {
    const filtered = filterNumericInput(text, INPUT_DECIMAL_PRESETS.PRICE);
    setPrice(filtered);
    if (filtered && amount) {
      const newTotal = (parseFloat(filtered) * parseFloat(amount)).toFixed(2);
      setTotal(newTotal);
    }
  }, [amount]);

  // 处理数量变化（同时更新滑块位置 - 双向绑定）
  const handleAmountChange = useCallback((text: string) => {
    const filtered = filterNumericInput(text, INPUT_DECIMAL_PRESETS.AMOUNT);
    setAmount(filtered);

    // 计算金额：市价模式用当前市场价，限价模式用输入价格
    const calcPrice = orderType === 'market' ? (currentMarket?.price || 0) : parseFloat(price);
    if (filtered && calcPrice > 0) {
      const newTotal = (calcPrice * parseFloat(filtered)).toFixed(2);
      setTotal(newTotal);
    }

    // 更新滑块位置（基于 sliderMaxAmount）
    const inputAmount = parseFloat(filtered) || 0;
    if (sliderMaxAmount > 0 && inputAmount > 0) {
      const newPosition = Math.min(100, Math.round((inputAmount / sliderMaxAmount) * 100));
      setSliderPosition(newPosition);
    } else {
      setSliderPosition(0);
    }
  }, [price, sliderMaxAmount, orderType, currentMarket?.price]);

  // 处理金额变化
  const handleTotalChange = useCallback((text: string) => {
    const filtered = filterNumericInput(text, INPUT_DECIMAL_PRESETS.TOTAL);
    setTotal(filtered);

    // 计算数量：市价模式用当前市场价，限价模式用输入价格
    const calcPrice = orderType === 'market' ? (currentMarket?.price || 0) : parseFloat(price);
    if (filtered && calcPrice > 0) {
      const newAmount = (parseFloat(filtered) / calcPrice).toFixed(4);
      setAmount(newAmount);

      // 同时更新滑块位置
      const inputAmount = parseFloat(newAmount) || 0;
      if (sliderMaxAmount > 0 && inputAmount > 0) {
        const newPosition = Math.min(100, Math.round((inputAmount / sliderMaxAmount) * 100));
        setSliderPosition(newPosition);
      } else {
        setSliderPosition(0);
      }
    }
  }, [price, orderType, currentMarket?.price, sliderMaxAmount]);

  // 根据滑块位置更新数量和金额（双向绑定核心逻辑）
  const updateAmountFromSlider = useCallback((position: number) => {
    const ratio = position / 100;
    const calculatedAmount = sliderMaxAmount * ratio;

    if (calculatedAmount > 0) {
      const newAmount = calculatedAmount.toFixed(4);
      setAmount(newAmount);

      // 同时计算金额：市价模式用当前市场价，限价模式用输入价格
      const calcPrice = orderType === 'market' ? (currentMarket?.price || 0) : parseFloat(price);
      if (calcPrice > 0) {
        const newTotal = (calculatedAmount * calcPrice).toFixed(2);
        setTotal(newTotal);
      }
    } else {
      setAmount('');
      setTotal('');
    }
  }, [sliderMaxAmount, price, orderType, currentMarket?.price]);

  // 处理滑块点击
  const handleSliderClick = useCallback((position: number) => {
    setSliderPosition(position);
    updateAmountFromSlider(position);
  }, [updateAmountFromSlider]);

  // 处理滑块拖拽（使用 pageX 计算相对位置）
  const handleSliderDrag = useCallback((pageX: number) => {
    if (sliderTrackWidth <= 0) return;

    // 计算相对于轨道的位置
    const relativeX = pageX - sliderTrackX;

    // 计算位置百分比（考虑圆点半径偏移）
    const dotRadius = 8; // 圆点半径
    const effectiveWidth = sliderTrackWidth - dotRadius * 2;
    const adjustedX = relativeX - dotRadius;
    const ratio = Math.max(0, Math.min(1, adjustedX / effectiveWidth));

    // 吸附到最近的档位（0, 25, 50, 75, 100）
    const rawPosition = ratio * 100;
    const snapThreshold = 8; // 吸附阈值
    let newPosition = Math.round(rawPosition);

    // 检查是否接近某个档位
    for (const pos of SLIDER_POSITIONS) {
      if (Math.abs(rawPosition - pos) < snapThreshold) {
        newPosition = pos;
        break;
      }
    }

    setSliderPosition(newPosition);
    updateAmountFromSlider(newPosition);
  }, [sliderTrackWidth, sliderTrackX, updateAmountFromSlider]);

  // 滑块 PanResponder（支持拖拽）
  const sliderPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt: GestureResponderEvent) => {
      // 每次触摸开始时重新测量轨道位置（处理滚动后位置变化）
      if (sliderTrackRef.current) {
        sliderTrackRef.current.measure((x, y, width, height, pageX, pageY) => {
          setSliderTrackWidth(width);
          setSliderTrackX(pageX);
          // 使用新测量的位置计算
          const relativeX = evt.nativeEvent.pageX - pageX;
          const dotRadius = 8;
          const effectiveWidth = width - dotRadius * 2;
          const adjustedX = relativeX - dotRadius;
          const ratio = Math.max(0, Math.min(1, adjustedX / effectiveWidth));
          const rawPosition = ratio * 100;
          const snapThreshold = 8;
          let newPosition = Math.round(rawPosition);
          for (const pos of SLIDER_POSITIONS) {
            if (Math.abs(rawPosition - pos) < snapThreshold) {
              newPosition = pos;
              break;
            }
          }
          setSliderPosition(newPosition);
          updateAmountFromSlider(newPosition);
        });
      }
    },
    onPanResponderMove: (evt: GestureResponderEvent) => {
      handleSliderDrag(evt.nativeEvent.pageX);
    },
  }), [handleSliderDrag, updateAmountFromSlider]);

  // 滑块轨道布局变化（获取宽度和绝对位置）
  const handleSliderTrackLayout = useCallback(() => {
    if (sliderTrackRef.current) {
      sliderTrackRef.current.measure((x, y, width, height, pageX, pageY) => {
        setSliderTrackWidth(width);
        setSliderTrackX(pageX);
      });
    }
  }, []);

  // 校验下单参数
  const validateOrderParams = useCallback((): string | null => {
    // 检查登录状态
    if (!currentAccount) {
      return '请先登录账户';
    }

    // 检查交易对
    if (!tradingPair) {
      return '交易对信息加载中，请稍候';
    }

    // 检查数量
    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      return '请输入有效的数量';
    }

    // 限价委托需要检查价格
    if (orderType === 'limit') {
      const priceNum = parseFloat(price);
      if (!price || isNaN(priceNum) || priceNum <= 0) {
        return '请输入有效的价格';
      }
    }

    // 检查余额
    if (tradeDirection === 'buy') {
      // 买入检查 quote 余额
      const totalValue = orderType === 'limit'
        ? amountNum * parseFloat(price)
        : amountNum * (currentMarket?.price || 0) * 1.1; // 市价预估
      if (totalValue > quoteBalance) {
        return `${currentMarket?.quoteAsset || 'USDT'} 余额不足`;
      }
    } else {
      // 卖出检查 base 余额
      if (amountNum > baseBalance) {
        return `${currentMarket?.baseAsset || ''} 余额不足`;
      }
    }

    return null;
  }, [currentAccount, tradingPair, amount, price, orderType, tradeDirection, quoteBalance, baseBalance, currentMarket]);

  // 执行下单
  const executeOrder = useCallback(async (privateKeyWif: string) => {
    if (!tradingPair || !currentAccount) {
      console.warn('[TradeScreen] 执行下单失败: 交易对或账户信息为空');
      return;
    }

    // 显示全局阻塞视图
    const orderActionText = tradeDirection === 'buy' ? '买入' : '卖出';
    BlockView.show(`正在${orderActionText}...`);

    try {
      const amountNum = parseFloat(amount);
      let orderPrice: number;

      if (orderType === 'market') {
        // 市价单：使用当前 ticker 价格的极端值确保成交
        const tickerPrice = currentMarket?.price || 0;
        if (tradeDirection === 'buy') {
          // 买入用当前价格的 200%（2倍）
          orderPrice = tickerPrice * 2;
        } else {
          // 卖出用当前价格的 50%（0.5倍）
          orderPrice = tickerPrice * 0.5;
        }
      } else {
        orderPrice = parseFloat(price);
      }

      const isMarketOrder = orderType === 'market';

      if (tradeDirection === 'buy') {
        await chainServiceMgr.createBuyOrder({
          accountId: currentAccount.id,
          tradingPair,
          price: orderPrice,
          amount: amountNum,
          isMarketOrder,
        }, privateKeyWif);
      } else {
        await chainServiceMgr.createSellOrder({
          accountId: currentAccount.id,
          tradingPair,
          price: orderPrice,
          amount: amountNum,
          isMarketOrder,
        }, privateKeyWif);
      }

      // 隐藏阻塞视图
      BlockView.hide();

      // 下单成功
      Toast.success(`${orderActionText} ${amount} ${currentMarket?.baseAsset || ''} 成功`);

      // 清空输入
      setAmount('');
      setTotal('');
      setSliderPosition(0);

      // 刷新委托列表
      backgroundService.refreshLimitOrders();

    } catch (error: any) {
      // 隐藏阻塞视图
      BlockView.hide();

      console.error('[TradeScreen] 下单失败:', error);
      Toast.error(formatGrapheneError(error));
    }
  }, [tradingPair, currentAccount, amount, price, orderType, tradeDirection, displayAsks, displayBids, currentMarket]);

  // 处理下单按钮点击
  const handlePlaceOrder = useCallback(() => {
    // 校验参数
    const error = validateOrderParams();
    if (error) {
      Toast.warning(error);
      return;
    }

    // 弹出解锁弹窗获取私钥
    UnlockModal.show({
      accountId: currentAccount!.id,
      accountName: currentAccount!.name,
      onSuccess: (keys: UnlockedKeys) => {
        console.log('[TradeScreen] 执行下单: 私钥已获取。');
        const activeKey = keys.active;
        if (activeKey) {
          executeOrder(activeKey);
        } else {
          Toast.error('缺少资金私钥。');
        }
      },
      onCancel: () => {
        // 用户取消
        console.log('[TradeScreen] 执行下单: 用户取消');
      },
    });
  }, [validateOrderParams, currentAccount, executeOrder]);

  // 渲染顶部导航栏
  const renderHeader = () => (
    <View style={styles.header}>
      {/* 交易对名称 */}
      <View style={styles.headerLeft}>
        <Text style={styles.headerTitle}>
          {currentMarket ? `${currentMarket.baseAsset}/${currentMarket.quoteAsset}` : 'ETH/USDT'}
        </Text>
      </View>

      {/* 右侧按钮 */}
      <View style={styles.headerRight}>
        <TouchableOpacity style={styles.headerButton} onPress={handleOpenKLine}>
          <Icon name="chart-line" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerButton} onPress={handleOpenSettings}>
          <Icon name="cog-outline" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  // 渲染买入/卖出切换
  const renderTradeDirectionTabs = () => (
    <View style={styles.directionTabs}>
      <TouchableOpacity
        style={[
          styles.directionTab,
          tradeDirection === 'buy' && styles.directionTabBuyActive,
        ]}
        onPress={() => setTradeDirection('buy')}
      >
        <Text style={[
          styles.directionTabText,
          tradeDirection === 'buy' && styles.directionTabTextActive,
        ]}>
          买入
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.directionTab,
          tradeDirection === 'sell' && styles.directionTabSellActive,
        ]}
        onPress={() => setTradeDirection('sell')}
      >
        <Text style={[
          styles.directionTabText,
          tradeDirection === 'sell' && styles.directionTabTextActive,
        ]}>
          卖出
        </Text>
      </TouchableOpacity>
    </View>
  );

  // 获取委托类型显示文字
  const getOrderTypeText = () => {
    return orderType === 'limit' ? '限价委托' : '市价委托';
  };

  // 渲染委托类型选择
  const renderOrderTypeSelector = () => (
    <TouchableOpacity
      style={styles.orderTypeSelector}
      onPress={() => setShowOrderTypePicker(true)}
    >
      <View style={styles.orderTypeLeft}>
        <Text style={styles.orderTypeText}>{getOrderTypeText()}</Text>
        <View style={styles.orderTypeIcon}>
          <Icon name="information-outline" size={14} color="#666666" />
        </View>
      </View>
      <Icon name="chevron-down" size={20} color="#666666" />
    </TouchableOpacity>
  );

  // 渲染委托类型选择弹窗
  const renderOrderTypePicker = () => (
    <Modal
      visible={showOrderTypePicker}
      transparent
      animationType="fade"
      onRequestClose={() => setShowOrderTypePicker(false)}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setShowOrderTypePicker(false)}
      >
        <View style={styles.orderTypePickerContainer}>
          <Text style={styles.orderTypePickerTitle}>选择委托类型</Text>

          <TouchableOpacity
            style={[
              styles.orderTypePickerItem,
              orderType === 'limit' && styles.orderTypePickerItemActive,
            ]}
            onPress={() => {
              setOrderType('limit');
              setShowOrderTypePicker(false);
            }}
          >
            <View style={styles.orderTypePickerItemContent}>
              <Text style={styles.orderTypePickerItemTitle}>限价委托</Text>
              <Text style={styles.orderTypePickerItemDesc}>
                指定价格下单，等待市场价格达到时成交
              </Text>
            </View>
            {orderType === 'limit' && (
              <Icon name="check" size={20} color="#00D094" />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.orderTypePickerItem,
              orderType === 'market' && styles.orderTypePickerItemActive,
            ]}
            onPress={() => {
              setOrderType('market');
              setShowOrderTypePicker(false);
              // 市价单不需要价格，清空价格输入
              setPrice('');
              // 如果已有数量，用当前市场价重新计算预估金额
              if (amount && currentMarket?.price) {
                const newTotal = (currentMarket.price * parseFloat(amount)).toFixed(2);
                setTotal(newTotal);
              }
            }}
          >
            <View style={styles.orderTypePickerItemContent}>
              <Text style={styles.orderTypePickerItemTitle}>市价委托</Text>
              <Text style={styles.orderTypePickerItemDesc}>
                以当前市场最优价格立即成交
              </Text>
            </View>
            {orderType === 'market' && (
              <Icon name="check" size={20} color="#00D094" />
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  // 渲染输入框
  const renderInputField = (
    label: string,
    value: string,
    onChangeText: (text: string) => void,
    unit: string,
    placeholder: string = '0'
  ) => (
    <View style={styles.inputContainer}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#444444"
          keyboardType="decimal-pad"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          inputMode="decimal"
        />
        <Text style={styles.inputUnit}>{unit}</Text>
      </View>
    </View>
  );

  // 计算进度条宽度（避免超出圆点区域）
  const getProgressWidth = useCallback(() => {
    if (sliderTrackWidth <= 0) return 0;
    const dotRadius = 8; // 圆点半径
    const effectiveWidth = sliderTrackWidth - dotRadius * 2; // 两端各留一个半径
    return (sliderPosition / 100) * effectiveWidth;
  }, [sliderTrackWidth, sliderPosition]);

  // 渲染数量滑块
  const renderSlider = () => {
    const progressWidth = getProgressWidth();
    const activeColor = tradeDirection === 'buy' ? '#00D094' : '#FF4757';

    return (
      <View style={styles.sliderContainer}>
        {/* 触摸区域（比实际轨道更大） */}
        <View
          style={styles.sliderTouchArea}
          {...sliderPanResponder.panHandlers}
        >
          {/* 实际轨道 */}
          <View
            ref={sliderTrackRef}
            style={styles.sliderTrack}
            onLayout={handleSliderTrackLayout}
          >
            {/* 灰色背景轨道 */}
            <View style={styles.sliderTrackBackground} />

            {/* 彩色进度轨道 */}
            <View
              style={[
                styles.sliderProgress,
                {
                  width: progressWidth,
                  backgroundColor: activeColor,
                },
              ]}
            />

            {/* 圆点 */}
            {SLIDER_POSITIONS.map((pos) => (
              <View
                key={pos}
                style={[
                  styles.sliderDot,
                  sliderPosition >= pos && [styles.sliderDotActive, { backgroundColor: activeColor, borderColor: activeColor }],
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    );
  };

  // 格式化余额数量（保留适当精度）
  const formatBalance = (value: number): string => {
    if (value === 0) return '0';
    if (value < 0.0001) return value.toFixed(8);
    if (value < 0.01) return value.toFixed(6);
    if (value < 1) return value.toFixed(4);
    if (value < 1000) return value.toFixed(4);
    if (value < 10000) return value.toFixed(2);
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  // 渲染可用余额
  const renderAvailableBalance = () => (
    <View style={styles.balanceContainer}>
      <View style={styles.balanceRow}>
        <Text style={styles.balanceLabel}>可用</Text>
        <Text style={styles.balanceValue}>
          {formatBalance(availableBalance)} {availableUnit}
        </Text>
        <Icon name="information-outline" size={14} color="#666666" />
      </View>
      <View style={styles.balanceRow}>
        <Text style={styles.balanceLabel}>{tradeDirection === 'buy' ? '可买' : '可卖'}</Text>
        <Text style={styles.balanceValue}>
          {formatBalance(canTradeAmount)} {canTradeUnit}
        </Text>
      </View>
    </View>
  );

  // 渲染交易按钮
  const renderTradeButton = () => (
    <TouchableOpacity
      style={[
        styles.tradeButton,
        tradeDirection === 'buy' ? styles.tradeButtonBuy : styles.tradeButtonSell,
      ]}
      onPress={handlePlaceOrder}
    >
      <Text style={styles.tradeButtonText}>
        {tradeDirection === 'buy' ? '买入' : '卖出'} {currentMarket?.baseAsset || 'ETH'}
      </Text>
    </TouchableOpacity>
  );

  // 渲染左侧交易面板
  const renderTradePanel = () => (
    <View style={styles.tradePanel}>
      {renderTradeDirectionTabs()}
      {renderOrderTypeSelector()}
      {/* 限价委托显示价格输入框 */}
      {orderType === 'limit' && renderInputField(
        `价格 (${currentMarket?.quoteAsset || 'USDT'})`,
        price,
        handlePriceChange,
        currentMarket?.quoteAsset || 'USDT'
      )}
      {renderInputField('数量', amount, handleAmountChange, currentMarket?.baseAsset || 'ETH')}
      {renderSlider()}
      {/* 金额输入框（限价和市价模式都显示，市价模式显示预估金额） */}
      {renderInputField(
        orderType === 'market' ? '预估金额' : '金额',
        total,
        handleTotalChange,
        currentMarket?.quoteAsset || 'USDT'
      )}
      {renderAvailableBalance()}
      {renderTradeButton()}
    </View>
  );

  // 渲染订单薄头部
  const renderOrderBookHeader = () => (
    <View style={styles.orderBookHeader}>
      <Text style={styles.orderBookHeaderText}>价格</Text>
      <Text style={styles.orderBookHeaderText}>数量</Text>
    </View>
  );

  // 点击盘口价格填充到输入框
  const handleOrderBookPriceClick = useCallback((orderItem: OrderBookItem) => {
    setPrice(formatOrderBookPrice(orderItem.price));
    // 如果已有数量，重新计算金额
    if (amount) {
      const newTotal = (orderItem.price * parseFloat(amount)).toFixed(2);
      setTotal(newTotal);
    }
  }, [amount]);

  // 渲染订单薄单项
  const renderOrderBookItem = (order: OrderBookItem, isAsk: boolean, index: number) => (
    <TouchableOpacity
      key={`${order.oid}-${index}`}
      style={styles.orderBookItem}
      onPress={() => handleOrderBookPriceClick(order)}
      activeOpacity={0.7}
    >
      <Text style={[styles.orderBookPrice, { color: isAsk ? '#FF4757' : '#00D094' }]}>
        {formatOrderBookPrice(order.price)}
      </Text>
      <Text style={styles.orderBookAmount}>{formatOrderBookAmount(order.base)}</Text>
    </TouchableOpacity>
  );

  // 渲染当前价格（使用盘口最优价格）
  const renderCurrentPrice = () => {
    // 优先使用盘口数据中的最新价格
    const bestBid = displayBids.length > 0 ? displayBids[0].price : 0;
    const bestAsk = displayAsks.length > 0 ? displayAsks[displayAsks.length - 1].price : 0;
    // 中间价 = (最高买价 + 最低卖价) / 2，如果没有盘口数据则使用 market 价格
    const midPrice = bestBid > 0 && bestAsk > 0
      ? (bestBid + bestAsk) / 2
      : currentMarket?.price || 0;

    return (
      <TouchableOpacity style={styles.currentPriceContainer}>
        <View style={styles.currentPriceRow}>
          <Text style={[styles.currentPrice, { color: priceColor }]}>
            {formatPrice(midPrice)}
          </Text>
          <Icon name="chevron-right" size={18} color="#666666" />
        </View>
        <Text style={styles.currentPriceUsd}>
          ≈ ${formatPrice(currentMarket?.price || midPrice)} {' '}
          <Text style={{ color: priceColor }}>
            {isPositive ? '' : ''}{currentMarket?.change24h?.toFixed(2) || '0.00'}%
          </Text>
        </Text>
      </TouchableOpacity>
    );
  };


  // 渲染档位选择
  const renderDepthSelector = () => (
    <View style={styles.depthSelectorContainer}>
      <TouchableOpacity style={styles.depthSelector}>
        <Text style={styles.depthSelectorText}>10</Text>
        <Icon name="chevron-down" size={16} color="#666666" />
      </TouchableOpacity>
      <View style={styles.depthModeButtons}>
        <View style={[styles.depthModeIcon, styles.depthModeActive]}>
          <View style={styles.depthModeBar} />
          <View style={[styles.depthModeBar, { backgroundColor: '#FF4757' }]} />
        </View>
      </View>
    </View>
  );

  // 渲染加载中的占位行
  const renderPlaceholderRow = (index: number, isAsk: boolean) => (
    <View key={`placeholder-${isAsk ? 'ask' : 'bid'}-${index}`} style={styles.orderBookItem}>
      <Text style={[styles.orderBookPrice, { color: isAsk ? '#FF4757' : '#00D094' }]}>--</Text>
      <Text style={styles.orderBookAmount}>--</Text>
    </View>
  );

  // 渲染订单薄
  const renderOrderBook = () => {
    // 计算买卖比例（使用交易标的数量 base）
    const totalBidAmount = displayBids.reduce((sum, bid) => sum + bid.base, 0);
    const totalAskAmount = displayAsks.reduce((sum, ask) => sum + ask.base, 0);
    const totalAmount = totalBidAmount + totalAskAmount;
    const buyRatio = totalAmount > 0 ? Math.round((totalBidAmount / totalAmount) * 100) : 50;
    const sellRatio = 100 - buyRatio;

    // 是否显示加载占位符
    const showAskPlaceholder = isLoadingOrderBook && displayAsks.length === 0;
    const showBidPlaceholder = isLoadingOrderBook && displayBids.length === 0;

    return (
      <View style={styles.orderBook}>
        {/* 订单薄头部 */}
        <View style={styles.orderBookHeaderRow}>
          <Text style={styles.orderBookHeaderLabel}>价格</Text>
          <Text style={styles.orderBookHeaderLabel}>数量</Text>
        </View>
        <View style={styles.orderBookSubHeader}>
          <Text style={styles.orderBookSubHeaderText}>({currentMarket?.quoteAsset || 'USDT'})</Text>
          <Text style={styles.orderBookSubHeaderText}>({currentMarket?.baseAsset || 'HBW'})</Text>
        </View>

        {/* 卖盘 - 固定5档高度，可滚动 */}
        <ScrollView
          style={styles.askOrders}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
          scrollEnabled={true}
          bounces={false}
        >
          {showAskPlaceholder ? (
            // 加载中显示 "--" 占位
            Array.from({ length: ORDER_BOOK_DISPLAY_COUNT }).map((_, index) =>
              renderPlaceholderRow(index, true)
            )
          ) : orderBookError && displayAsks.length === 0 ? (
            <View style={styles.orderBookEmpty}>
              <Text style={styles.orderBookEmptyText}>{orderBookError}</Text>
            </View>
          ) : displayAsks.length === 0 ? (
            // 无数据时显示 "--" 占位
            Array.from({ length: ORDER_BOOK_DISPLAY_COUNT }).map((_, index) =>
              renderPlaceholderRow(index, true)
            )
          ) : (
            displayAsks.map((order, index) => renderOrderBookItem(order, true, index))
          )}
        </ScrollView>

        {/* 当前价格 */}
        {renderCurrentPrice()}

        {/* 买盘 - 固定5档高度，可滚动 */}
        <ScrollView
          style={styles.bidOrders}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
          scrollEnabled={true}
          bounces={false}
        >
          {showBidPlaceholder ? (
            // 加载中显示 "--" 占位
            Array.from({ length: ORDER_BOOK_DISPLAY_COUNT }).map((_, index) =>
              renderPlaceholderRow(index, false)
            )
          ) : orderBookError && displayBids.length === 0 ? (
            <View style={styles.orderBookEmpty}>
              <Text style={styles.orderBookEmptyText}>{orderBookError}</Text>
            </View>
          ) : displayBids.length === 0 ? (
            // 无数据时显示 "--" 占位
            Array.from({ length: ORDER_BOOK_DISPLAY_COUNT }).map((_, index) =>
              renderPlaceholderRow(index, false)
            )
          ) : (
            displayBids.map((order, index) => renderOrderBookItem(order, false, index))
          )}
        </ScrollView>

        {/* 买卖比例 */}
        <View style={styles.ratioContainer}>
          <View style={[styles.ratioBar, styles.ratioBarBuy, { flex: buyRatio }]}>
            <Text style={styles.ratioText}>B {buyRatio}%</Text>
          </View>
          <View style={[styles.ratioBar, styles.ratioBarSell, { flex: sellRatio }]}>
            <Text style={styles.ratioText}>{sellRatio}% S</Text>
          </View>
        </View>

        {/* 档位选择 */}
        {renderDepthSelector()}
      </View>
    );
  };

  // 格式化订单价格
  const formatOrderPrice = (price: number): string => {
    if (price < 0.0001) return price.toFixed(8);
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    if (price < 100) return price.toFixed(4);
    return price.toFixed(2);
  };

  // 格式化订单数量
  const formatOrderAmount = (amount: number): string => {
    if (amount < 0.0001) return amount.toFixed(8);
    if (amount < 0.01) return amount.toFixed(6);
    if (amount < 1) return amount.toFixed(4);
    if (amount < 1000) return amount.toFixed(4);
    return amount.toFixed(2);
  };

  // 格式化时间
  const formatOrderTime = (expiration: string): string => {
    try {
      const date = new Date(expiration + 'Z');
      // 显示为本地时间，格式：YYYY-MM-DD HH:mm:ss
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } catch {
      return expiration;
    }
  };

  // 执行撤单（支持单个或批量）
  const executeCancelOrders = useCallback(async (orderIds: string[], privateKeyWif: string) => {
    if (!currentAccount) return;

    try {
      await chainServiceMgr.cancelLimitOrder({
        accountId: currentAccount.id,
        orderIds,
      }, privateKeyWif);
      return true;
    } catch (error: any) {
      console.error('[TradeScreen] 撤单失败:', error);
      throw error;
    }
  }, [currentAccount]);

  // 处理撤单（单个）
  const handleCancelOrder = useCallback((order: ParsedLimitOrder) => {
    if (!currentAccount) {
      Toast.warning('请先登录账户');
      return;
    }

    // 弹出解锁弹窗获取私钥
    UnlockModal.show({
      accountId: currentAccount.id,
      accountName: currentAccount.name,
      onSuccess: async (keys: UnlockedKeys) => {
        const activeKey = keys.active;
        if (!activeKey) {
          Toast.error('缺少资金私钥。');
          return;
        }

        // 显示全局阻塞视图
        BlockView.show('正在撤单...');

        try {
          await executeCancelOrders([order.id], activeKey);
          // 隐藏阻塞视图
          BlockView.hide();
          Toast.success('撤单成功');
          // 刷新委托列表
          backgroundService.refreshLimitOrders();
        } catch (error: any) {
          // 隐藏阻塞视图
          BlockView.hide();
          Toast.error(formatGrapheneError(error));
        }
      },
      onCancel: () => {
        // 用户取消
      },
    });
  }, [currentAccount, executeCancelOrders]);

  // 处理撤销全部（批量撤单，一个交易包含所有撤单操作）
  const handleCancelAll = useCallback(() => {
    if (!currentAccount) {
      Toast.warning('请先登录账户');
      return;
    }

    const ordersToCancel = displayOrders;
    if (ordersToCancel.length === 0) {
      Toast.info('暂无可撤销的委托');
      return;
    }

    // 弹出解锁弹窗获取私钥
    UnlockModal.show({
      accountId: currentAccount.id,
      accountName: currentAccount.name,
      onSuccess: async (keys: UnlockedKeys) => {
        const activeKey = keys.active;
        if (!activeKey) {
          Toast.error('缺少资金私钥。');
          return;
        }

        // 显示全局阻塞视图
        BlockView.show('正在撤销全部委托...');

        try {
          // 提取所有订单 ID
          const orderIds = ordersToCancel.map(order => order.id);
          await executeCancelOrders(orderIds, activeKey);
          // 隐藏阻塞视图
          BlockView.hide();
          Toast.success(`成功撤销 ${orderIds.length} 笔委托`);
          // 刷新委托列表
          backgroundService.refreshLimitOrders();
        } catch (error: any) {
          // 隐藏阻塞视图
          BlockView.hide();
          console.error('[TradeScreen] 批量撤单失败:', error);
          Toast.error(formatGrapheneError(error));
        }
      },
      onCancel: () => {
        // 用户取消
      },
    });
  }, [currentAccount, displayOrders, executeCancelOrders]);

  // 渲染单个委托订单
  const renderOrderItem = (order: ParsedLimitOrder) => {
    const isBuy = order.side === 'buy';
    const sideColor = isBuy ? '#00D094' : '#FF4757';
    const sideText = isBuy ? '买入' : '卖出';
    const filledPercent = Math.round(order.filledPercent);

    return (
      <View key={order.id} style={styles.orderItem}>
        {/* 第一行：交易对 + 成交百分比 + 撤单按钮 */}
        <View style={styles.orderItemHeader}>
          <View style={styles.orderItemLeft}>
            <Text style={styles.orderItemSymbol}>{order.symbol}</Text>
          </View>
          <View style={styles.orderItemRight}>
            <Text style={styles.orderItemPercent}>{filledPercent}%</Text>
            <TouchableOpacity
              style={styles.orderCancelButton}
              onPress={() => handleCancelOrder(order)}
            >
              <Text style={styles.orderCancelButtonText}>撤单</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 第二行：限价/方向 + 时间 */}
        <View style={styles.orderItemRow}>
          <Text style={[styles.orderItemSide, { color: sideColor }]}>
            限价 / {sideText}
          </Text>
          <Text style={styles.orderItemTime}>
            {formatOrderTime(order.expiration)}
          </Text>
        </View>

        {/* 第三行：成交数量 / 数量 */}
        <View style={styles.orderItemRow}>
          <Text style={styles.orderItemLabel}>成交数量 / 数量</Text>
          <Text style={styles.orderItemValue}>
            {formatOrderAmount(order.filledAmount)} / {formatOrderAmount(order.amount)}
          </Text>
        </View>

        {/* 第四行：价格 */}
        <View style={styles.orderItemRow}>
          <Text style={styles.orderItemLabel}>价格</Text>
          <Text style={styles.orderItemValue}>
            {formatOrderPrice(order.price)}
          </Text>
        </View>
      </View>
    );
  };

  // 渲染委托筛选栏
  const renderOrderFilterBar = () => (
    <View style={styles.orderFilterBar}>
      {/* 左边：隐藏其他交易对 */}
      <TouchableOpacity
        style={styles.hideOtherPairsContainer}
        onPress={() => setHideOtherPairs(!hideOtherPairs)}
      >
        <View style={[styles.filterCheckbox, hideOtherPairs && styles.filterCheckboxActive]}>
          {hideOtherPairs && <Icon name="check" size={12} color="#000000" />}
        </View>
        <Text style={styles.hideOtherPairsText}>隐藏其他交易对</Text>
      </TouchableOpacity>

      {/* 右边：撤销全部 */}
      <TouchableOpacity
        style={styles.cancelAllButton}
        onPress={handleCancelAll}
      >
        <Text style={styles.cancelAllButtonText}>撤销全部</Text>
      </TouchableOpacity>
    </View>
  );

  // 渲染底部委托区域
  const renderBottomOrders = () => (
    <View style={styles.bottomOrders}>
      {/* 底部 Tab */}
      <View style={styles.bottomTabs}>
        <TouchableOpacity
          style={styles.bottomTab}
          onPress={() => setBottomTab('orders')}
        >
          <Text style={[
            styles.bottomTabText,
            bottomTab === 'orders' && styles.bottomTabTextActive,
          ]}>
            当前委托 ({allParsedOrders.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.bottomTab}
          onPress={() => setBottomTab('positions')}
        >
          <Text style={[
            styles.bottomTabText,
            bottomTab === 'positions' && styles.bottomTabTextActive,
          ]}>
            持有币种 ({balanceItems.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* 委托筛选栏（仅在委托 Tab 时显示） */}
      {bottomTab === 'orders' && renderOrderFilterBar()}

      {/* 委托内容区域 */}
      <View style={styles.bottomContent}>
        {bottomTab === 'orders' && (
          displayOrders.length === 0 ? (
            <View style={styles.orderEmptyContainer}>
              <Text style={styles.orderEmptyText}>暂无委托</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.orderList}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled={true}
            >
              {displayOrders.map(order => renderOrderItem(order))}
            </ScrollView>
          )
        )}
        {bottomTab === 'positions' && (
          balanceItems.length === 0 ? (
            <View style={styles.orderEmptyContainer}>
              <Text style={styles.orderEmptyText}>暂无持仓</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.positionList}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled={true}
            >
              {balanceItems.map(item => (
                <View key={item.assetId} style={styles.positionItem}>
                  <Text style={styles.positionSymbol}>{item.symbol}</Text>
                  <Text style={styles.positionAmount}>{formatBalance(item.total)}</Text>
                </View>
              ))}
            </ScrollView>
          )
        )}
      </View>
    </View>
  );

  // 如果没有市场数据，显示占位
  if (!currentMarket && marketList.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>加载中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      {/* 顶部导航 */}
      {renderHeader()}

      {/* 主内容区域 */}
      <ScrollView style={styles.mainContent} showsVerticalScrollIndicator={false}>
        <View style={styles.tradingArea}>
          {/* 左侧交易面板 */}
          {renderTradePanel()}

          {/* 右侧订单薄 */}
          {renderOrderBook()}
        </View>

        {/* 底部委托区域 */}
        {renderBottomOrders()}
      </ScrollView>

      {/* 委托类型选择弹窗 */}
      {renderOrderTypePicker()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#666666',
    fontSize: 14,
  },

  // 顶部导航样式
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: 8,
    marginLeft: 4,
  },

  // 主内容区域
  mainContent: {
    flex: 1,
  },
  tradingArea: {
    flexDirection: 'row',
    paddingHorizontal: 12,
  },

  // 交易面板样式
  tradePanel: {
    flex: 1,
    paddingRight: 12,
  },
  directionTabs: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  directionTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 20,
    marginHorizontal: 4,
    backgroundColor: '#1A1A1A',
  },
  directionTabBuyActive: {
    backgroundColor: '#00D094',
  },
  directionTabSellActive: {
    backgroundColor: '#FF4757',
  },
  directionTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888888',
  },
  directionTabTextActive: {
    color: '#FFFFFF',
  },
  orderTypeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    marginBottom: 12,
  },
  orderTypeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderTypeText: {
    fontSize: 14,
    color: '#FFFFFF',
  },
  orderTypeIcon: {
    marginLeft: 6,
  },
  inputContainer: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    paddingVertical: 12,
  },
  inputUnit: {
    fontSize: 13,
    color: '#666666',
  },
  sliderContainer: {
    marginBottom: 12,
  },
  sliderTouchArea: {
    paddingVertical: 16, // 增大上下触摸区域
    marginHorizontal: -8, // 稍微扩展左右
    paddingHorizontal: 8,
  },
  sliderTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 16,
    position: 'relative',
  },
  sliderTrackBackground: {
    position: 'absolute',
    left: 8,  // 圆点半径
    right: 8, // 圆点半径
    top: 7,
    height: 2,
    backgroundColor: '#333333',
    borderRadius: 1,
  },
  sliderDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1A1A1A',
    borderWidth: 2,
    borderColor: '#444444',
    zIndex: 2,
  },
  sliderDotActive: {
    backgroundColor: '#00D094',
    borderColor: '#00D094',
  },
  sliderProgress: {
    position: 'absolute',
    left: 8,  // 圆点半径
    top: 7,
    height: 2,
    borderRadius: 1,
    zIndex: 1,
  },
  balanceContainer: {
    marginBottom: 12,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  balanceLabel: {
    fontSize: 12,
    color: '#666666',
    marginRight: 8,
  },
  balanceValue: {
    fontSize: 12,
    color: '#FFFFFF',
    marginRight: 4,
  },
  tradeButton: {
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
  },
  tradeButtonBuy: {
    backgroundColor: '#00D094',
  },
  tradeButtonSell: {
    backgroundColor: '#FF4757',
  },
  tradeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // 委托类型选择弹窗样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderTypePickerContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
    width: '85%',
    maxWidth: 320,
  },
  orderTypePickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 20,
  },
  orderTypePickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#252525',
  },
  orderTypePickerItemActive: {
    backgroundColor: 'rgba(0, 208, 148, 0.1)',
    borderWidth: 1,
    borderColor: '#00D094',
  },
  orderTypePickerItemContent: {
    flex: 1,
  },
  orderTypePickerItemTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  orderTypePickerItemDesc: {
    fontSize: 12,
    color: '#888888',
  },

  // 订单薄样式
  orderBook: {
    width: 160,
  },
  orderBookHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  orderBookHeaderLabel: {
    fontSize: 12,
    color: '#666666',
  },
  orderBookSubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  orderBookSubHeaderText: {
    fontSize: 10,
    color: '#444444',
  },
  orderBookHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  orderBookHeaderText: {
    fontSize: 12,
    color: '#666666',
  },
  askOrders: {
    marginBottom: 4,
    height: 100,  // 固定5档高度（每行约20px）
  },
  bidOrders: {
    marginTop: 4,
    height: 100,  // 固定5档高度（每行约20px）
  },
  orderBookLoading: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderBookEmpty: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderBookEmptyText: {
    fontSize: 12,
    color: '#666666',
  },
  orderBookItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    height: 20,  // 固定行高，确保滚动一致
  },
  orderBookPrice: {
    fontSize: 13,
    fontFamily: 'monospace',
  },
  orderBookAmount: {
    fontSize: 13,
    color: '#FFFFFF',
    fontFamily: 'monospace',
  },
  currentPriceContainer: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
  },
  currentPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currentPrice: {
    fontSize: 18,
    fontWeight: '600',
  },
  currentPriceUsd: {
    fontSize: 11,
    color: '#666666',
    marginTop: 2,
  },
  ratioContainer: {
    flexDirection: 'row',
    marginTop: 12,
    borderRadius: 4,
    overflow: 'hidden',
  },
  ratioBar: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  ratioBarBuy: {
    backgroundColor: '#00D094',
  },
  ratioBarSell: {
    backgroundColor: '#FF4757',
  },
  ratioText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  depthSelectorContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  depthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1A1A1A',
    borderRadius: 4,
  },
  depthSelectorText: {
    fontSize: 13,
    color: '#FFFFFF',
    marginRight: 4,
  },
  depthModeButtons: {
    flexDirection: 'row',
  },
  depthModeIcon: {
    padding: 6,
    backgroundColor: '#1A1A1A',
    borderRadius: 4,
  },
  depthModeActive: {},
  depthModeBar: {
    width: 12,
    height: 2,
    backgroundColor: '#00D094',
    marginVertical: 2,
  },

  // 底部委托区域样式
  bottomOrders: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
  },
  bottomTabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  // 委托筛选栏样式
  orderFilterBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  hideOtherPairsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#444444',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  filterCheckboxActive: {
    backgroundColor: '#FFD700',
    borderColor: '#FFD700',
  },
  hideOtherPairsText: {
    fontSize: 13,
    color: '#888888',
  },
  cancelAllButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#FFD700',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelAllButtonText: {
    fontSize: 12,
    color: '#FFD700',
  },
  bottomTab: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 24,
  },
  bottomTabText: {
    fontSize: 14,
    color: '#666666',
    marginRight: 4,
  },
  bottomTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  bottomContent: {
    minHeight: 120,
    paddingHorizontal: 16,
  },
  orderEmptyContainer: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderEmptyText: {
    fontSize: 14,
    color: '#666666',
  },
  // 持有币种列表样式
  positionList: {
    flex: 1,
    maxHeight: 200,
  },
  positionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  positionSymbol: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  positionAmount: {
    fontSize: 14,
    color: '#FFFFFF',
    fontFamily: 'monospace',
  },
  orderList: {
    flex: 1,
  },
  orderItem: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  orderItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderItemSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  orderItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderItemPercent: {
    fontSize: 13,
    color: '#666666',
    marginRight: 12,
  },
  orderCancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#444444',
  },
  orderCancelButtonText: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  orderItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  orderItemSide: {
    fontSize: 13,
  },
  orderItemTime: {
    fontSize: 12,
    color: '#666666',
  },
  orderItemLabel: {
    fontSize: 13,
    color: '#666666',
  },
  orderItemValue: {
    fontSize: 13,
    color: '#FFFFFF',
  },
});

export default TradeScreen;
