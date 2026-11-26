/**
 * K线详情页面组件
 * 
 * 功能：
 * 1. 顶部导航（返回、交易对名称、收藏、分享）
 * 2. 内容 Tab（行情、概况、数据）
 * 3. 价格信息区域（最新价、涨跌幅、24H数据）
 * 4. 时间周期选择（3分、5分、15分、30分、更多）
 * 5. K线图区域（TODO 预留）
 * 6. 底部交易按钮
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Platform
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import BigNumber from 'bignumber.js';

import { useMarketStore } from '../store/useMarketStore';
import { useOrderBookStore } from '../store/useOrderBookStore';
import type { RootStackParamList, KLineInterval, KLineSource, OrderBookItem } from '../types';

import chainServiceMgr from '../services/chainservice_mgr';
import { backgroundService } from '../services/background_service';
import { Toast } from '../components/Toast';

// 导航和路由类型
type KLineScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'KLine'>;
type KLineScreenRouteProp = RouteProp<RootStackParamList, 'KLine'>;

// 内容 Tab 类型
type ContentTab = 'market' | 'overview' | 'data';

// 内容 Tab 配置
const contentTabs: { key: ContentTab; label: string }[] = [
  { key: 'market', label: '行情' },
  { key: 'overview', label: '概况' },
  { key: 'data', label: '数据' },
];

// 时间周期配置
const timeIntervals: { key: KLineInterval; label: string }[] = [
  { key: '3m', label: '3分' },
  { key: '5m', label: '5分' },
  { key: '15m', label: '15分' },
  { key: '30m', label: '30分' },
];

// 底部 Tab 类型
type BottomTabType = 'orderbook' | 'trades';

// 底部 Tab 配置
const bottomTabs: { key: BottomTabType; label: string }[] = [
  { key: 'orderbook', label: '委托订单' },
  { key: 'trades', label: '最新成交' },
  // { key: 'network', label: '网络' },
];

const bucketsCountMap: Record<string, number> = {
  'timeline': 200,
  '1m': 200,
  '5m': 200,
  '15m': 200,
  '30m': 200,
  '1h': 200,
  '4h': 200,
  '1d': 200,
  '7d': 200
};

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

const KLineScreen: React.FC = () => {
  const navigation = useNavigation<KLineScreenNavigationProp>();
  const route = useRoute<KLineScreenRouteProp>();
  const { marketItem, source = 'market' } = route.params;

  // 从 MarketStore 获取方法
  const toggleFavorite = useMarketStore(state => state.toggleFavorite);

  // 从 OrderBook Store 获取盘口数据
  const orderBook = useOrderBookStore(state => state.orderBook);
  const isLoadingOrderBook = useOrderBookStore(state => state.isLoading);
  const orderBookError = useOrderBookStore(state => state.error);

  // 本地状态
  const [activeContentTab, setActiveContentTab] = useState<ContentTab>('market');
  const [selectedInterval, setSelectedInterval] = useState<KLineInterval>('30m');
  const [isFavorite, setIsFavorite] = useState(marketItem.isFavorite);
  const [klineDataState, setKlineDataState] = useState<any[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  // WebView 可能在首次请求完成后才触发 onLoad，因此单独记录状态，避免“无数据”消息被初始化脚本覆盖成“加载中”。
  const klineStatusRef = useRef<'loading' | 'ready' | 'empty' | 'error'>('loading');

  // 底部 Tab 状态
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTabType>('orderbook');

  // 成交记录状态
  const [fillOrders, setFillOrders] = useState<Array<{ time: string; isSell: boolean; isCall: boolean; price: number; amount: number }>>([]);
  const [isLoadingFillOrders, setIsLoadingFillOrders] = useState(false);
  const fillOrdersLoadedRef = useRef<boolean>(false);

  // K线图周期 state（webview 内用的）
  const [klineInterval, setKlineInterval] = useState<string>('1h');

  // WebView动态高度 (480基础 + 2个指标*60 = 600)
  const [webViewHeight, setWebViewHeight] = useState(600);

  // 是否首次加载（用于区分全量/增量更新）
  const isFirstLoadRef = useRef<boolean>(true);

  // 组件是否已卸载的标志
  const isMountedRef = useRef<boolean>(true);

  // 禁用外部ScrollView滚动（当webview交互时）
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // 记录WebView容器的布局位置
  const webViewLayoutRef = useRef<{ y: number; height: number } | null>(null);

  // WebView 引用
  const webViewRef = useRef<WebView<unknown>>(null);

  // 记录最后调用时间
  const lastCallTimeRef = useRef<number>(0);
  const isCallingRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 缓存资产精度
  // 按交易对缓存资产信息，不能使用全局 baseId/quoteId，否则切换自定义交易对后会串用上一对资产。
  const assetPairCache = useRef<Map<string, { base: number; quote: number; baseId: string; quoteId: string }>>(new Map());

  // 从amount和精度计算BigDecimal（等同于Kotlin的bigDecimalfromAmount）
  const bigDecimalFromAmount = useCallback((amount: string, precision: number): BigNumber => {
    const precisionDivisor = new BigNumber(10).pow(precision);
    return new BigNumber(amount).dividedBy(precisionDivisor);
  }, []);

  // 获取资产精度
  const getAsset = useCallback(async (baseSymbol: string, quoteSymbol: string): Promise<{ base: number, quote: number, baseId: string, quoteId: string }> => {
    const pairKey = `${baseSymbol}_${quoteSymbol}`;
    const cached = assetPairCache.current.get(pairKey);
    if (cached) {
      return cached;
    }

    // 查询资产信息
    const assetsMap = await chainServiceMgr.queryAssetsBySymbols([baseSymbol, quoteSymbol]);
    const baseAsset = assetsMap.get(baseSymbol);
    const quoteAsset = assetsMap.get(quoteSymbol);
    const baseId = baseAsset?.id;
    const quoteId = quoteAsset?.id;

    console.log("[资产查询] 查询资产精度:", baseSymbol, quoteSymbol, baseId, quoteId, baseAsset, quoteAsset);

    if (!baseAsset || !quoteAsset || baseAsset.precision === undefined || quoteAsset.precision === undefined || !baseId || !quoteId) {
      console.error('[错误] 无法获取资产信息:', baseSymbol, quoteSymbol);
      // 默认精度
      return { base: 5, quote: 5, baseId: '', quoteId: '' };
    }

    // 缓存精度
    const result = { base: baseAsset.precision, quote: quoteAsset.precision, baseId: baseAsset.id, quoteId: quoteAsset.id };
    assetPairCache.current.set(pairKey, result);

    console.log(`[base/quote 资产信息] ${baseSymbol}: ${baseAsset.precision}, ${quoteSymbol}: ${quoteAsset.precision}`);

    return result;
  }, []);

  // 解析单根K线数据（参考MKlineItemData.kt的parseData逻辑）
  const parseKlineData = useCallback((
    rawData: any,
    baseId: string,
    basePrecision: number,
    quotePrecision: number
  ) => {
    const cellScale = basePrecision; // 保留小数位数
    const cellRounding = BigNumber.ROUND_UP;

    const n_base_precision = new BigNumber(10).pow(basePrecision);
    const n_quote_precision = new BigNumber(10).pow(quotePrecision);

    const open_base = rawData.open_base;
    const open_quote = rawData.open_quote;
    const high_base = rawData.high_base;
    const high_quote = rawData.high_quote;
    const low_base = rawData.low_base;
    const low_quote = rawData.low_quote;
    const close_base = rawData.close_base;
    const close_quote = rawData.close_quote;

    let nPriceOpen: BigNumber;
    let nPriceHigh: BigNumber;
    let nPriceLow: BigNumber;
    let nPriceClose: BigNumber;
    let n24Vol: BigNumber;

    if (rawData.key.base === baseId) {
      // key.base 是交易资产: price = quote / base
      const n_open_base = bigDecimalFromAmount(open_base, basePrecision);
      const n_open_quote = bigDecimalFromAmount(open_quote, quotePrecision);

      const n_high_base = bigDecimalFromAmount(high_base, basePrecision);
      const n_high_quote = bigDecimalFromAmount(high_quote, quotePrecision);

      const n_low_base = bigDecimalFromAmount(low_base, basePrecision);
      const n_low_quote = bigDecimalFromAmount(low_quote, quotePrecision);

      const n_close_base = bigDecimalFromAmount(close_base, basePrecision);
      const n_close_quote = bigDecimalFromAmount(close_quote, quotePrecision);

      nPriceOpen = n_open_quote.dividedBy(n_open_base).decimalPlaces(cellScale, cellRounding);
      nPriceHigh = n_high_quote.dividedBy(n_high_base).decimalPlaces(cellScale, cellRounding);
      nPriceLow = n_low_quote.dividedBy(n_low_base).decimalPlaces(cellScale, cellRounding);
      nPriceClose = n_close_quote.dividedBy(n_close_base).decimalPlaces(cellScale, cellRounding);

      n24Vol = bigDecimalFromAmount(rawData.quote_volume, quotePrecision);
    } else {
      // key.base 是报价资产: price = base / quote
      const n_open_base = bigDecimalFromAmount(open_base, quotePrecision);
      const n_open_quote = bigDecimalFromAmount(open_quote, basePrecision);

      const n_high_base = bigDecimalFromAmount(high_base, quotePrecision);
      const n_high_quote = bigDecimalFromAmount(high_quote, basePrecision);

      const n_low_base = bigDecimalFromAmount(low_base, quotePrecision);
      const n_low_quote = bigDecimalFromAmount(low_quote, basePrecision);

      const n_close_base = bigDecimalFromAmount(close_base, quotePrecision);
      const n_close_quote = bigDecimalFromAmount(close_quote, basePrecision);

      nPriceOpen = n_open_base.dividedBy(n_open_quote).decimalPlaces(cellScale, cellRounding);
      nPriceHigh = n_high_base.dividedBy(n_high_quote).decimalPlaces(cellScale, cellRounding);
      nPriceLow = n_low_base.dividedBy(n_low_quote).decimalPlaces(cellScale, cellRounding);
      nPriceClose = n_close_base.dividedBy(n_close_quote).decimalPlaces(cellScale, cellRounding);

      // 注意：开收相同、高低反向
      const temp = nPriceHigh;
      nPriceHigh = nPriceLow;
      nPriceLow = temp;

      n24Vol = bigDecimalFromAmount(rawData.base_volume, quotePrecision);
    }
    let openTime = new Date(rawData.key.open)
    // 抓换成本地时间
    openTime = new Date(openTime.getTime() - openTime.getTimezoneOffset() * 60000);

    return {
      timestamp: openTime.getTime(),
      open: nPriceOpen.toNumber(),
      high: nPriceHigh.toNumber(),
      low: nPriceLow.toNumber(),
      close: nPriceClose.toNumber(),
      volume: n24Vol.toNumber()
    };
  }, [bigDecimalFromAmount]);

  // interval 转换为秒数
  const intervalToSeconds = useCallback((interval: string): number => {
    const intervalMap: Record<string, number> = {
      'timeline': 60,        // 分时（1分钟）
      '1m': 60,              // 1分钟
      '5m': 300,             // 5分钟
      '15m': 900,            // 15分钟
      '30m': 1800,           // 30分钟
      '1h': 3600,            // 1小时
      '4h': 14400,           // 4小时
      '1d': 86400,           // 1天
      '3d': 259200,          // 3天
      '7d': 604800,          // 7天
      '1M': 2592000,         // 1月（30天）
    };
    return intervalMap[interval] || 86400; // 默认1天
  }, []);

  // 计算 start 和 end 时间（获取1000根蜡烛或最新1根）
  const calculateTimeRange = useCallback((interval: string, isIncremental: boolean = false) => {
    const bucketSeconds = intervalToSeconds(interval);
    const end = new Date();
    let start: Date;

    const bucketsCount = bucketsCountMap[interval] || 200;
    if (isIncremental) {
      // 增量更新：获取最近10个周期的数据，确保能获取到不同时间戳的数据
      start = new Date(end.getTime() - bucketSeconds * 10 * 1000);
      console.log(`[增量更新] interval: ${interval}, 获取最近10个周期`);
    } else {
      // 全量更新：获取1000根蜡烛
      start = new Date(end.getTime() - bucketSeconds * bucketsCount * 1000);
      console.log(`[全量更新] interval: ${interval}, 获取${bucketsCount}根蜡烛`);
    }

    return {
      bucketSeconds,
      start: start.toISOString().split('.')[0],
      end: end.toISOString().split('.')[0]
    };
  }, [intervalToSeconds]);

  // 处理返回
  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // 处理收藏切换
  const handleToggleFavorite = useCallback(() => {
    const pairKey = `${marketItem.baseAsset}_${marketItem.quoteAsset}`;
    setIsFavorite(!isFavorite);
    toggleFavorite(pairKey);
  }, [isFavorite, marketItem.baseAsset, marketItem.quoteAsset, toggleFavorite]);

  // 处理分享
  // const handleShare = useCallback(() => {
  //   // TODO: 实现分享功能
  //   console.log('分享', marketItem.symbol);
  // }, [marketItem.symbol]);

  // 查询成交记录
  const fetchFillOrders = useCallback(async () => {
    if (isLoadingFillOrders) return;

    try {
      setIsLoadingFillOrders(true);

      const baseSymbol = marketItem.symbol.split('/')[0];
      const quoteSymbol = marketItem.symbol.split('/')[1];

      // 获取资产信息
      const { base: basePrecision, quote: quotePrecision, baseId, quoteId } = await getAsset(baseSymbol, quoteSymbol);

      if (!baseId || !quoteId) {
        console.error('[成交记录] 无法获取资产ID');
        return;
      }

      // 查询成交记录（最多30条）
      const records = await chainServiceMgr.queryFillOrderHistory(
        {
          baseId,
          quoteId,
          basePrecision,
          quotePrecision,
        },
        30
      );

      console.log('[成交记录] 获取到', records.length, '条记录');
      setFillOrders(records);
      fillOrdersLoadedRef.current = true;
    } catch (error) {
      console.error('[成交记录] 查询失败:', error);
    } finally {
      setIsLoadingFillOrders(false);
    }
  }, [marketItem.symbol, getAsset, isLoadingFillOrders]);

  // 切换到最新成交 Tab 时加载数据
  useEffect(() => {
    if (activeBottomTab === 'trades' && !fillOrdersLoadedRef.current) {
      fetchFillOrders();
    }
  }, [activeBottomTab, fetchFillOrders]);

  // 处理交易按钮点击 - 跳转到交易界面
  const handleTrade = useCallback(() => {
    // 使用 reset 清除 Stack 历史，直接跳转到 Trade Tab
    // 这样 Trade Tab 滑动返回会退出应用，而不是返回 KLineScreen
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [
          {
            name: 'MainTabs',
            state: {
              routes: [
                { name: 'Home' },
                { name: 'Market' },
                { name: 'Trade', params: { marketItem } },
                { name: 'Predict' },
                { name: 'Assets' },
              ],
              index: 2, // Trade Tab 的索引
            },
          },
        ],
      })
    );
  }, [navigation, marketItem]);

  // 发送数据到 WebView
  const sendDataToWebView = useCallback((data: any[], interval: string, isIncremental: boolean = false) => {
    let message;
    if (data.length > 0) {
      console.log(`[发送] K线数据到WebView: ${data.length} 条, interval: ${interval}, 增量: ${isIncremental}`, data);
      message = JSON.stringify({
        type: isIncremental ? 'UPDATE_LATEST_CANDLE' : 'KLINE_DATA',
        data: data,
        interval: interval
      });
    } else {
      message = JSON.stringify({
        type: 'UPDATE_LOADING_TEXT',
        text: '无数据'
      });
    }
    if (webViewRef.current){
      webViewRef.current.postMessage(message);
    }
  }, []);

  // 获取K线数据 - 使用useRef存储最新的函数避免闭包问题
  const fetchKlineDataRef = useRef<(() => Promise<void>) | undefined>(undefined);

  fetchKlineDataRef.current = async () => {
    if (isCallingRef.current) {
      console.log('[跳过] 上一次调用还未完成');
      return;
    }

    // 检查组件是否已卸载
    if (!isMountedRef.current) {
      console.log('[跳过] 组件已卸载，停止获取数据');
      return;
    }

    try {
      isCallingRef.current = true;
      const callStartTime = Date.now();
      const isIncremental = !isFirstLoadRef.current; // 非首次加载则为增量更新

      console.log(`[开始获取] K线数据 - ${marketItem.symbol} - ${klineInterval} - ${isIncremental ? '增量' : '全量'}`);

      const baseSymbol = marketItem.symbol.split('/')[0];
      const quoteSymbol = marketItem.symbol.split('/')[1];

      // 获取资产精度
      const { base: basePrecision, quote: quotePrecision, baseId: baseId, quoteId: quoteId } = await getAsset(baseSymbol, quoteSymbol);

      const { bucketSeconds, start, end } = calculateTimeRange(klineInterval, isIncremental);
      console.log("[--------------- 获取行情参数]", baseSymbol, quoteSymbol,"isIncremental:", isIncremental, "start:", start, "end:", end, "bucketSeconds:", bucketSeconds);

      // history API 接收资产 ID，不是资产符号；ticker/盘口接口才使用 symbol。
      const data = await chainServiceMgr.getMarketHistory(baseId, quoteId, bucketSeconds, start, end);
      const callEndTime = Date.now();
      const callDuration = callEndTime - callStartTime;

      // console.log(`[完成] 获取到 ${data.length} 条原始数据，耗时: ${callDuration}ms, start: ${start}, end: ${end}`);

      if (data.length > 0) {
        // console.log('[原始数据样例]', baseSymbol, quoteSymbol, baseId, quoteId, basePrecision, quotePrecision, marketItem, data);
        if (isIncremental) {
          // console.log('[增量数据详情] 获取到的所有数据:', data.map(d => ({
          //   timestamp: new Date(d.key.open).toISOString(),
          //   open: d.open_quote,
          //   close: d.close_quote
          // })));
        }
      }

      // 使用正确的计算逻辑转换数据
      // const baseId = marketItem.quoteAsset;
      const formattedData = data.map(item => parseKlineData(item, baseId, basePrecision, quotePrecision));

      if (!isIncremental) {
        // 全量更新：保存到state并打印调试
        console.log('========== 全量数据（前5条和后5条）==========');
        console.log('前5条:', formattedData.slice(0, 5));
        console.log('后5条:', formattedData.slice(-5));
        console.log('价格范围: ', {
          minPrice: Math.min(...formattedData.map(d => d.low)),
          maxPrice: Math.max(...formattedData.map(d => d.high)),
          avgPrice: formattedData.reduce((sum, d) => sum + d.close, 0) / formattedData.length
        });
        console.log('==========================================');
        setKlineDataState(formattedData);
        klineStatusRef.current = formattedData.length > 0 ? 'ready' : 'empty';

        // 发送全量数据到 WebView
        if (webViewRef.current) {
          sendDataToWebView(formattedData, klineInterval, false);
          // 隐藏loading
          setIsDataLoading(false);
        }
        isFirstLoadRef.current = false; // 标记已完成首次加载
      } else {
        // 增量更新：只发送最新一根蜡烛
        if (formattedData.length > 0 && webViewRef.current) {
          const latestCandle = formattedData[formattedData.length - 1];
          console.log('[增量] 最新蜡烛:', latestCandle);
          sendDataToWebView([latestCandle], klineInterval, true);
        }
      }

      // 计算下次调用时间
      lastCallTimeRef.current = callEndTime;
      const nextCallDelay = Math.max(0, 1000 - callDuration); // 如果调用超过1秒，立即调用

      // 设置下一次定时器（仅当组件未卸载时）
      if (isMountedRef.current) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
          fetchKlineDataRef.current?.();
        }, nextCallDelay);
      } else {
        console.log('[跳过] 组件已卸载，不设置新的定时器');
      }

    } catch (error) {
      console.error('[错误] 获取K线数据失败:', error);
      klineStatusRef.current = 'error';
      // 错误时也要继续轮询（仅当组件未卸载时）
      if (isMountedRef.current) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
          fetchKlineDataRef.current?.();
        }, 1000);
      } else {
        console.log('[跳过] 组件已卸载，不设置错误后的定时器');
      }
    } finally {
      isCallingRef.current = false;
    }
  };

  // 创建一个稳定的wrapper函数用于useEffect
  const fetchKlineData = useCallback(() => {
    fetchKlineDataRef.current?.();
  }, []);

  // WebView加载完成后发送数据
  const handleWebViewLoad = useCallback(() => {
    console.log('[加载完成] WebView 加载完成，当前数据:', klineDataState.length, '条');

    // 只有真实数据才发送，避免加载静态缓存数据
    if (klineDataState.length > 0) {
      sendDataToWebView(klineDataState, klineInterval, false);
    } else {
      const loadingText = klineStatusRef.current === 'empty'
        ? '暂无K线数据'
        : klineStatusRef.current === 'error'
          ? 'K线加载失败'
          : '加载中...';
      console.log('[WebView] 加载完成，发送状态:', loadingText);
      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          type: 'UPDATE_LOADING_TEXT',
          text: loadingText,
        }));
      }
    }
  }, [klineDataState, klineInterval, sendDataToWebView]);

  // 处理 WebView 消息
  const handleWebViewMessage = useCallback((event: any) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      console.log('[消息] WebView 消息:', message);

      if (message.type === 'CHANGE_INTERVAL') {
        const newInterval = message.interval;
        console.log(`[周期变更] 从 WebView 收到周期变更: ${newInterval}, 当前周期: ${klineInterval}`);

        // 立即停止当前的轮询
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
          console.log('[周期变更] 已停止当前轮询');
        }

        // 立即清空 WebView 的数据
        if (webViewRef.current) {
          const clearMessage = JSON.stringify({
            type: 'KLINE_DATA',
            data: [],
            interval: newInterval,
            isUpdate: false
          });
          webViewRef.current.postMessage(clearMessage);
          console.log('[周期变更] 已发送清空数据到 WebView');
        }

        // 显示loading
        setIsDataLoading(true);

        // 清空数据状态
        setKlineDataState([]);

        // 重置为全量加载
        isFirstLoadRef.current = true;

        // 设置新周期
        setKlineInterval(newInterval);
        console.log(`[周期变更] 已设置新周期: ${newInterval}`);
      } else if (message.type === 'HEIGHT_CHANGE') {
        // 接收WebView高度变化消息
        const newHeight = message.height;
        console.log(`[高度变更] WebView高度变为: ${newHeight}`);
        setWebViewHeight(newHeight);
      } else if (message.type === 'TOUCH_START') {
        // WebView开始触摸，禁用外部滚动
        console.log('[WebView] 触摸开始，禁用ScrollView滚动');
        setScrollEnabled(false);
      } else if (message.type === 'TOUCH_END') {
        // WebView触摸结束，启用外部滚动
        console.log('[WebView] 触摸结束，启用ScrollView滚动');
        setScrollEnabled(true);
      } else if (message.type === 'INTERACTION_START') {
        // 用户开始交互（拖动/缩放），禁用滚动
        console.log('[WebView] 交互开始，禁用ScrollView滚动');
        setScrollEnabled(false);
      } else if (message.type === 'INTERACTION_END') {
        // 交互结束，启用滚动
        console.log('[WebView] 交互结束，启用ScrollView滚动');
        setScrollEnabled(true);
      }
    } catch (error) {
      console.error('[错误] 解析WebView消息失败:', error);
    }
  }, []);

  // 组件加载时启动轮询并更新盘口交易对
  useEffect(() => {
    console.log('[启动] K线数据轮询');
    setIsDataLoading(true);
    klineStatusRef.current = 'loading';

    // 切换盘口交易对到当前 K 线的交易对
    const baseSymbol = marketItem.symbol.split('/')[0];
    const quoteSymbol = marketItem.symbol.split('/')[1];
    backgroundService.switchOrderBookTradingPair(baseSymbol, quoteSymbol);
    console.log(`[KLineScreen] 切换盘口交易对: ${baseSymbol}/${quoteSymbol}`);

    // 设置盘口刷新间隔为 1 秒
    backgroundService.setOrderBookInterval(1000);

    // 立即获取一次数据
    fetchKlineData();

    // 组件卸载时清理定时器并恢复刷新间隔
    return () => {
      console.log('[停止] K线数据轮询 - 清理定时器');
      isMountedRef.current = false; // 标记组件已卸载
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      isCallingRef.current = false;
      isFirstLoadRef.current = true; // 重置首次加载标记

      // 恢复盘口刷新间隔为 3 秒
      backgroundService.setOrderBookInterval(3000);
    };
  }, []); // 空依赖数组，只执行一次

  // 当 interval 改变时，重启轮询
  useEffect(() => {
    console.log(`[周期变化] interval 改变为: ${klineInterval}`);
    // 清理旧定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
        // 重置为全量加载
        isFirstLoadRef.current = true;
        klineStatusRef.current = 'loading';
    isCallingRef.current = false;
    // 立即获取新周期的数据
    fetchKlineData();
  }, [klineInterval]); // 只依赖klineInterval

  // 判断涨跌
  const isPositive = marketItem.change24h >= 0;
  const priceColor = isPositive ? '#00D094' : '#FF4757';

  // 格式化价格
  const formatPrice = (price: number) => {
    if (price < 0.0001) {
      return price.toFixed(6);
    } else if (price < 1) {
      return price.toFixed(6);
    } else if (price < 100) {
      return price.toFixed(2);
    } else {
      return price.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
  };

  // 渲染顶部导航栏
  const renderHeader = () => (
    <View style={styles.header}>
      {/* 返回按钮 */}
      <TouchableOpacity style={styles.headerButton} onPress={handleGoBack}>
        <Icon name="chevron-left" size={28} color="#FFFFFF" />
      </TouchableOpacity>

      {/* 交易对名称 */}
      <Text style={styles.headerTitle}>{marketItem.symbol}</Text>

      {/* 右侧按钮 */}
      <View style={styles.headerRight}>
        <TouchableOpacity style={styles.headerButton} onPress={handleToggleFavorite}>
          <Icon
            name={isFavorite ? 'star' : 'star-outline'}
            size={24}
            color={isFavorite ? '#FFD700' : '#FFFFFF'}
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  // 渲染内容 Tab
  const renderContentTabs = () => (
    <View style={styles.contentTabsContainer}>
      {contentTabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={[
            styles.contentTab,
            activeContentTab === tab.key && styles.contentTabActive,
          ]}
          onPress={() => setActiveContentTab(tab.key)}
        >
          <Text
            style={[
              styles.contentTabText,
              activeContentTab === tab.key && styles.contentTabTextActive,
            ]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // 渲染价格信息区域
  const renderPriceInfo = () => (
    <View style={styles.priceInfoContainer}>
      {/* 左侧：最新价格 */}
      <View style={styles.priceLeft}>
        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>最新价格</Text>
          <Icon name="menu-down" size={16} color="#666666" />
        </View>
        <Text style={[styles.priceValue, { color: priceColor }]}>
          {formatPrice(marketItem.price)}
        </Text>
        <View style={styles.priceSubRow}>
          <Text style={styles.priceUsd}>${formatPrice(marketItem.priceUsd)}</Text>
          <Text style={styles.priceChangePeriod}>24h</Text>
          <Text style={[styles.priceChange, { color: priceColor }]}>
            {isPositive ? '+' : ''}{marketItem.change24h.toFixed(2)}%
          </Text>
        </View>
      </View>

      {/* 右侧：24H数据 */}
      <View style={styles.priceRight}>
        <View style={styles.priceDataRow}>
          <Text style={styles.priceDataLabel}>24小时最高</Text>
          <Text style={styles.priceDataValue}>{formatPrice(marketItem.high24h)}</Text>
        </View>
        <View style={styles.priceDataRow}>
          <Text style={styles.priceDataLabel}>24小时最低</Text>
          <Text style={styles.priceDataValue}>{formatPrice(marketItem.low24h)}</Text>
        </View>
        <View style={styles.priceDataRow}>
          <Text style={styles.priceDataLabel}>24小时量({marketItem.baseAsset})</Text>
          <Text style={styles.priceDataValue}>
            {marketItem.amount24hDisplay.toFixed(2)}{marketItem.amountUnit}
          </Text>
        </View>
        <View style={styles.priceDataRow}>
          <Text style={styles.priceDataLabel}>24小时额({marketItem.quoteAsset})</Text>
          <Text style={styles.priceDataValue}>
            {marketItem.volume24hDisplay.toFixed(2)}{marketItem.volumeUnit}
          </Text>
        </View>
      </View>
    </View>
  );

  // 渲染时间周期选择器
  const renderTimeIntervals = () => (
    <View style={styles.intervalsContainer}>
      {timeIntervals.map((interval) => (
        <TouchableOpacity
          key={interval.key}
          style={[
            styles.intervalButton,
            selectedInterval === interval.key && styles.intervalButtonActive,
          ]}
          onPress={() => setSelectedInterval(interval.key)}
        >
          <Text
            style={[
              styles.intervalText,
              selectedInterval === interval.key && styles.intervalTextActive,
            ]}
          >
            {interval.label}
          </Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.intervalButton}>
        <Text style={styles.intervalText}>更多</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.intervalButton}>
        <Icon name="chart-line-variant" size={18} color="#666666" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.intervalButton}>
        <Icon name="refresh" size={18} color="#666666" />
      </TouchableOpacity>
    </View>
  );

  // 渲染 K 线图区域（TODO 预留）
  const renderKLineChart = () => (
    <View style={styles.chartContainer}>
      {/* MA 指标 */}
      <View style={styles.chartIndicators}>
        <Text style={styles.indicatorText}>MA60: {formatPrice(marketItem.price * 0.998)}</Text>
        <Text style={[styles.indicatorText, { color: priceColor }]}>
          {formatPrice(marketItem.high24h)}
        </Text>
      </View>

      {/* K线图占位区域 */}
      <View style={styles.chartPlaceholder}>
        <Text style={styles.chartYAxis}>{formatPrice(marketItem.high24h * 0.97)}</Text>
        <View style={styles.chartContent}>
          <Text style={styles.chartPlaceholderText}>K线图表区域</Text>
          <Text style={styles.chartPlaceholderSubText}>
            {formatPrice(marketItem.price)} · 24:31
          </Text>
        </View>
      </View>

      {/* X轴时间标签 */}
      <View style={styles.chartXAxis}>
        <Text style={styles.xAxisText}>11/28 20:00</Text>
        <Text style={styles.xAxisText}>11/29 19:30</Text>
        <Text style={styles.xAxisText}>11/30 19:00</Text>
        <Text style={styles.xAxisText}>12/01 18:30</Text>
      </View>

      {/* KDJ 指标 */}
      <View style={styles.kdjContainer}>
        <Text style={styles.kdjText}>KDJ(9,3) K: 57.68 D: 54.67 J: 63.70</Text>
      </View>

      {/* KDJ 图表区域 */}
      <View style={styles.kdjChart} />
    </View>
  );

  // 渲染 K线 WebView
  const renderKLineWebView = () => (
    <View
      style={[styles.webviewContainer, { height: webViewHeight }]}
      onLayout={(event) => {
        const { y, height } = event.nativeEvent.layout;
        webViewLayoutRef.current = { y, height };
        console.log('[WebView] 布局位置:', { y, height });
      }}
    >
      <WebView<unknown>
        ref={webViewRef}
        originWhitelist={['*']}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        allowFileAccessFromFileURLs={true}
        domStorageEnabled={true}
        javaScriptEnabled={true}
        mixedContentMode="always"
        source={htmlSource}
        style={styles.webview}
        startInLoadingState={false}
        androidLayerType="hardware"
        onLoad={handleWebViewLoad}
        onMessage={handleWebViewMessage}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.error('[错误] WebView error:', nativeEvent);
        }}
        onLoadEnd={() => {
          console.log('[完成] WebView 加载结束');
        }}
      />
    </View>
  );

  // 获取显示的买卖盘数据
  const displayAsks = [...orderBook.asks].reverse(); // 卖盘从低到高显示
  const displayBids = orderBook.bids; // 买盘从高到低显示

  // 计算买卖比例
  const totalBidAmount = displayBids.reduce((sum, bid) => sum + bid.base, 0);
  const totalAskAmount = displayAsks.reduce((sum, ask) => sum + ask.base, 0);
  const totalAmount = totalBidAmount + totalAskAmount;
  const buyRatio = totalAmount > 0 ? (totalBidAmount / totalAmount) * 100 : 50;
  const sellRatio = 100 - buyRatio;

  // 渲染底部 Tab 切换
  const renderBottomTabs = () => (
    <View style={styles.bottomTabsContainer}>
      {bottomTabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={[
            styles.bottomTab,
            activeBottomTab === tab.key && styles.bottomTabActive,
          ]}
          onPress={() => setActiveBottomTab(tab.key)}
        >
          <Text
            style={[
              styles.bottomTabText,
              activeBottomTab === tab.key && styles.bottomTabTextActive,
            ]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // 渲染买卖比例条
  const renderRatioBar = () => (
    <View style={styles.ratioBarContainer}>
      <Text style={styles.ratioText}>{buyRatio.toFixed(2)}%</Text>
      <View style={styles.ratioBarWrapper}>
        <View style={[styles.ratioBar, styles.ratioBarBuy, { flex: buyRatio }]} />
        <View style={[styles.ratioBar, styles.ratioBarSell, { flex: sellRatio }]} />
      </View>
      <Text style={styles.ratioText}>{sellRatio.toFixed(2)}%</Text>
    </View>
  );

  // 订单薄显示行数
  const ORDER_BOOK_ROWS = 20;

  // 渲染买盘单项（左侧：数量左对齐 | 价格右对齐靠中间）
  const renderBidItem = (order: OrderBookItem | null, index: number) => (
    <View key={`bid-${index}`} style={styles.orderBookRow}>
      <Text style={styles.orderBookBidAmount}>
        {order ? formatOrderBookAmount(order.base) : '--'}
      </Text>
      <Text style={styles.orderBookPriceBid}>
        {order ? formatOrderBookPrice(order.price) : '--'}
      </Text>
    </View>
  );

  // 渲染卖盘单项（右侧：价格左对齐靠中间 | 数量右对齐）
  const renderAskItem = (order: OrderBookItem | null, index: number) => (
    <View key={`ask-${index}`} style={styles.orderBookRow}>
      <Text style={styles.orderBookPriceAsk}>
        {order ? formatOrderBookPrice(order.price) : '--'}
      </Text>
      <Text style={styles.orderBookAskAmount}>
        {order ? formatOrderBookAmount(order.base) : '--'}
      </Text>
    </View>
  );

  // 渲染订单薄内容
  const renderOrderBookContent = () => {
    // 买盘：从高到低，取前20档
    const bidRows: (OrderBookItem | null)[] = [];
    for (let i = 0; i < ORDER_BOOK_ROWS; i++) {
      bidRows.push(displayBids[i] || null);
    }

    // 卖盘：从低到高显示，取最低的20档
    const sortedAsks = [...orderBook.asks].sort((a, b) => a.price - b.price); // 从低到高
    const askRows: (OrderBookItem | null)[] = [];
    for (let i = 0; i < ORDER_BOOK_ROWS; i++) {
      askRows.push(sortedAsks[i] || null);
    }

    return (
      <View style={styles.orderBookContent}>
        {/* 买卖比例条 */}
        {renderRatioBar()}

        {/* 精度选择器 TODO:TBD暂时去掉 */}
        {/* <View style={styles.precisionSelector}>
          <Text style={styles.precisionText}>0.000001</Text>
          <Icon name="menu-down" size={16} color="#888888" />
        </View> */}

        {/* 订单薄头部 */}
        <View style={styles.orderBookHeaderRow}>
          <View style={styles.orderBookHeaderLeft}>
            <Text style={styles.orderBookHeaderText}>买</Text>
          </View>
          <View style={styles.orderBookHeaderRight}>
            <Text style={styles.orderBookHeaderText}>卖</Text>
          </View>
        </View>

        {/* 订单薄列表：左右两栏 */}
        <View style={styles.orderBookColumns}>
          {/* 左侧买盘 */}
          <View style={styles.orderBookColumnLeft}>
            {bidRows.map((order, index) => renderBidItem(order, index))}
          </View>

          {/* 右侧卖盘 */}
          <View style={styles.orderBookColumnRight}>
            {askRows.map((order, index) => renderAskItem(order, index))}
          </View>
        </View>
      </View>
    );
  };

  // 格式化成交时间（显示 HH:mm:ss）
  const formatTradeTime = (timeStr: string): string => {
    try {
      const date = new Date(timeStr + 'Z');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    } catch {
      return timeStr;
    }
  };

  // 渲染成交记录单项
  const renderTradeItem = (
    record: { time: string; isSell: boolean; isCall: boolean; price: number; amount: number },
    index: number
  ) => {
    const priceColor = record.isSell ? '#FF4757' : '#00D094';
    return (
      <View key={`trade-${index}`} style={styles.tradeItem}>
        <Text style={styles.tradeTime}>{formatTradeTime(record.time)}</Text>
        <Text style={[styles.tradePrice, { color: priceColor }]}>
          {formatOrderBookPrice(record.price)}
        </Text>
        <Text style={styles.tradeAmount}>
          {formatOrderBookAmount(record.amount)}
        </Text>
      </View>
    );
  };

  // 渲染最新成交内容
  const renderTradesContent = () => {
    // 显示加载中
    if (isLoadingFillOrders && fillOrders.length === 0) {
      return (
        <View style={styles.tradesContent}>
          <View style={styles.todoContainer}>
            <ActivityIndicator size="large" color="#666666" />
            <Text style={styles.todoSubText}>加载中...</Text>
          </View>
        </View>
      );
    }

    // 显示空状态
    if (fillOrders.length === 0) {
      return (
        <View style={styles.tradesContent}>
          <View style={styles.todoContainer}>
            <Icon name="clock-outline" size={48} color="#444444" />
            <Text style={styles.todoText}>最新成交</Text>
            <Text style={styles.todoSubText}>暂无成交记录</Text>
          </View>
        </View>
      );
    }

    // 显示成交记录列表（不使用单独滚动，和整个页面一起滚动）
    return (
      <View style={styles.tradesContent}>
        {/* 表头 */}
        <View style={styles.tradeHeader}>
          <Text style={styles.tradeHeaderText}>时间</Text>
          <Text style={styles.tradeHeaderText}>价格({marketItem.quoteAsset})</Text>
          <Text style={styles.tradeHeaderTextRight}>数量({marketItem.baseAsset})</Text>
        </View>
        {/* 成交记录列表 */}
        <View style={styles.tradeList}>
          {fillOrders.map((record, index) => renderTradeItem(record, index))}
        </View>
      </View>
    );
  };

  // 渲染网络内容
  // const renderNetworkContent = () => (
  //   <View style={styles.networkContent}>
  //     <View style={styles.todoContainer}>
  //       <Icon name="lan" size={48} color="#444444" />
  //       <Text style={styles.todoText}>网络</Text>
  //       <Text style={styles.todoSubText}>网络状态功能开发中</Text>
  //     </View>
  //   </View>
  // );

  // 渲染底部内容区域
  const renderBottomContent = () => (
    <View style={styles.bottomContentContainer}>
      {renderBottomTabs()}
      {activeBottomTab === 'orderbook' && renderOrderBookContent()}
      {activeBottomTab === 'trades' && renderTradesContent()}
      {/* {activeBottomTab === 'network' && renderNetworkContent()} */}
    </View>
  );

  // 渲染底部交易按钮
  const renderBottomBar = () => (
    <View style={styles.bottomBar}>
      <TouchableOpacity style={styles.tradeButton} onPress={handleTrade}>
        <Text style={styles.tradeButtonText}>交易</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.gridButton} onPress={() => Toast.show('敬请期待')}>
        <Icon name="view-grid-outline" size={24} color="#FFFFFF" />
        <Text style={styles.gridButtonText}>网格</Text>
      </TouchableOpacity>
    </View>
  );

  // 读取本地HTML文件的路径
  // Android: 使用 assets 目录，iOS: 使用 require()
  const htmlSource = Platform.select({
    android: { uri: 'file:///android_asset/kline.html' },
    ios: require('../assets/kline.html'),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      {/* 顶部导航 */}
      {renderHeader()}

      {/* 内容区域 */}
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
      >
        {/* 内容 Tab */}
        {renderContentTabs()}

        {/* 价格信息 */}
        {renderPriceInfo()}

        {/* 时间周期选择 */}
        {/* {renderTimeIntervals()} */}

        {/* K线图区域 */}
        {/* {renderKLineChart()} */}
        {renderKLineWebView()}

        {/* 底部订单薄/最新成交区域 */}
        {renderBottomContent()}
      </ScrollView>

      {/* 底部交易按钮 */}
      {renderBottomBar()}
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

  // 顶部导航样式
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  headerButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // 内容 Tab 样式
  contentTabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  contentTab: {
    marginRight: 24,
    paddingBottom: 8,
  },
  contentTabActive: {},
  contentTabText: {
    fontSize: 15,
    color: '#666666',
  },
  contentTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // 价格信息样式
  priceInfoContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 0,
  },
  priceLeft: {
    flex: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  priceLabel: {
    fontSize: 12,
    color: '#666666',
  },
  priceValue: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  priceSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceUsd: {
    fontSize: 13,
    color: '#888888',
    marginRight: 8,
  },
  priceChange: {
    fontSize: 13,
    fontWeight: '500',
  },
  priceChangePeriod: {
    fontSize: 11,
    color: '#666666',
    marginRight: 4,
  },
  priceRight: {
    flex: 1,
    paddingLeft: 16,
  },
  priceDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  priceDataLabel: {
    fontSize: 12,
    color: '#666666',
  },
  priceDataValue: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
  },

  // 时间周期样式
  intervalsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  intervalButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 4,
  },
  intervalButtonActive: {
    backgroundColor: '#2A2A2A',
  },
  intervalText: {
    fontSize: 13,
    color: '#888888',
  },
  intervalTextActive: {
    color: '#FFFFFF',
  },

  // K线图样式
  chartContainer: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  chartIndicators: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  indicatorText: {
    fontSize: 12,
    color: '#666666',
  },
  chartPlaceholder: {
    height: 250,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#FF4757',
    borderRadius: 4,
    flexDirection: 'row',
  },
  chartYAxis: {
    fontSize: 10,
    color: '#666666',
    padding: 8,
  },
  chartContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartPlaceholderText: {
    fontSize: 14,
    color: '#444444',
    marginBottom: 8,
  },
  chartPlaceholderSubText: {
    fontSize: 12,
    color: '#555555',
  },
  chartXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 12,
  },
  xAxisText: {
    fontSize: 10,
    color: '#666666',
  },
  kdjContainer: {
    marginBottom: 8,
  },
  kdjText: {
    fontSize: 11,
    color: '#666666',
  },
  kdjChart: {
    height: 60,
    backgroundColor: '#0D0D0D',
  },

  // 底部交易栏样式
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
    backgroundColor: '#0D0D0D',
  },
  tradeButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    marginRight: 16,
  },
  tradeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  gridButton: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  gridButtonText: {
    fontSize: 11,
    color: '#888888',
    marginTop: 2,
  },
  webviewContainer: {
    height: 500,
    marginHorizontal: 16,
    marginBottom: 0,
    backgroundColor: '#0B0E11',
    borderRadius: 8,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loading: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -20,
    marginTop: -20,
  },

  // 底部内容区域样式
  bottomContentContainer: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: '#0D0D0D',
    borderRadius: 8,
    overflow: 'hidden',
  },

  // 底部 Tab 样式（和内容 Tab 风格一致）
  bottomTabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  bottomTab: {
    marginRight: 24,
    paddingBottom: 8,
  },
  bottomTabActive: {},
  bottomTabText: {
    fontSize: 15,
    color: '#666666',
  },
  bottomTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // 买卖比例条样式
  ratioBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ratioBarWrapper: {
    flex: 1,
    flexDirection: 'row',
    height: 4,
    marginHorizontal: 8,
    borderRadius: 2,
    overflow: 'hidden',
  },
  ratioBar: {
    height: '100%',
  },
  ratioBarBuy: {
    backgroundColor: '#00D094',
  },
  ratioBarSell: {
    backgroundColor: '#FF4757',
  },
  ratioText: {
    fontSize: 12,
    color: '#888888',
    minWidth: 50,
  },

  // 精度选择器样式
  precisionSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  precisionText: {
    fontSize: 12,
    color: '#888888',
    marginRight: 4,
  },

  // 订单薄样式
  orderBookContent: {
    paddingBottom: 12,
  },
  orderBookHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  orderBookHeaderLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  orderBookHeaderRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  orderBookHeaderText: {
    fontSize: 12,
    color: '#666666',
  },
  orderBookColumns: {
    flexDirection: 'row',
    paddingHorizontal: 8,
  },
  orderBookColumnLeft: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#1A1A1A',
    paddingRight: 4,
  },
  orderBookColumnRight: {
    flex: 1,
    paddingLeft: 4,
  },
  orderBookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  // 买盘：数量在左（左对齐），价格在右（右对齐靠中间）
  orderBookBidAmount: {
    flex: 1,
    fontSize: 12,
    color: '#FFFFFF',
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  orderBookPriceBid: {
    flex: 1,
    fontSize: 12,
    color: '#00D094',
    fontFamily: 'monospace',
    textAlign: 'right',
  },
  // 卖盘：价格在左（左对齐靠中间），数量在右（右对齐）
  orderBookPriceAsk: {
    flex: 1,
    fontSize: 12,
    color: '#FF4757',
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  orderBookAskAmount: {
    flex: 1,
    fontSize: 12,
    color: '#FFFFFF',
    fontFamily: 'monospace',
    textAlign: 'right',
  },

  // 最新成交样式
  tradesContent: {
    minHeight: 200,
    paddingBottom: 12,
  },
  tradeHeader: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  tradeHeaderText: {
    flex: 1,
    fontSize: 12,
    color: '#666666',
  },
  tradeHeaderTextRight: {
    flex: 1,
    fontSize: 12,
    color: '#666666',
    textAlign: 'right',
  },
  tradeList: {
    // 不限制高度，和整个页面一起滚动
  },
  tradeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  tradeTime: {
    flex: 1,
    fontSize: 12,
    color: '#888888',
    fontFamily: 'monospace',
  },
  tradePrice: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  tradeAmount: {
    flex: 1,
    fontSize: 12,
    color: '#FFFFFF',
    fontFamily: 'monospace',
    textAlign: 'right',
  },

  // 网络样式
  networkContent: {
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  // TODO 占位样式
  todoContainer: {
    alignItems: 'center',
    padding: 20,
  },
  todoText: {
    fontSize: 16,
    color: '#666666',
    marginTop: 12,
  },
  todoSubText: {
    fontSize: 13,
    color: '#444444',
    marginTop: 4,
  },
});

export default KLineScreen;
