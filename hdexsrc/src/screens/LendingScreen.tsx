/**
 * DFS 抵押借贷
 *
 * 抵押物固定为 DFS，借款资产可按仓位选择多种资产。交易签名复用全局
 * PIN/生物解锁，不在页面保存或展示私钥。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAccountStore } from '../store/useAccountStore';
import { useBalanceStore } from '../store/useBalanceStore';
import { backgroundService } from '../services/background_service';
import {
  chainServiceMgr,
  formatGrapheneError,
} from '../services/chainservice_mgr';
import { BlockView } from '../components/BlockView';
import { RatioSlider } from '../components/RatioSlider';
import { Toast } from '../components/Toast';
import { UnlockModal, type UnlockedKeys } from '../components/UnlockModal';
import type {
  AssetObject,
  CallOrder,
  FullAccountData,
  PriceType,
} from '../types';
import { filterNumericInput } from '../utils';
import { CURRENT_NETWORK } from '../config';

const DFS_SYMBOL = 'DFS';
const FALLBACK_BORROW_SYMBOLS = ['USDT', 'CNY', 'GOLD', 'USD', 'BTC', 'ETH'];

interface BitAssetData {
  id: string;
  asset_id: string;
  options: { short_backing_asset: string };
  current_feed: {
    settlement_price: PriceType;
    maintenance_collateral_ratio: number;
    initial_collateral_ratio?: number;
  };
}

const formatAmount = (value: number, precision = 6) =>
  value === 0
    ? '0'
    : value.toLocaleString(undefined, {
        maximumFractionDigits: Math.min(precision, 8),
      });

const toReal = (amount: string | number, precision: number) =>
  Number(amount) / Math.pow(10, precision);

const formatDown = (value: number, precision: number) => {
  const decimals = Math.min(Math.max(precision, 0), 8);
  const factor = Math.pow(10, decimals);
  return (Math.floor(value * factor) / factor).toFixed(decimals);
};

const negateRawAmount = (value: string | number) => {
  const raw = String(value);
  return raw.startsWith('-') ? raw.slice(1) : `-${raw}`;
};

const isPositivePrice = (price?: PriceType) =>
  !!price && Number(price.base.amount) > 0 && Number(price.quote.amount) > 0;

const getDebtPerDfs = (
  bitAsset: BitAssetData | null,
  debtAsset: AssetObject | null,
  dfsAsset: AssetObject | null,
) => {
  const price = bitAsset?.current_feed?.settlement_price;
  if (!price || !debtAsset || !dfsAsset || !isPositivePrice(price)) return 0;
  const baseAmount = toReal(
    price.base.amount,
    price.base.asset_id === debtAsset.id
      ? debtAsset.precision
      : dfsAsset.precision,
  );
  const quoteAmount = toReal(
    price.quote.amount,
    price.quote.asset_id === debtAsset.id
      ? debtAsset.precision
      : dfsAsset.precision,
  );
  if (baseAmount <= 0 || quoteAmount <= 0) return 0;
  if (
    price.base.asset_id === debtAsset.id &&
    price.quote.asset_id === dfsAsset.id
  ) {
    return baseAmount / quoteAmount;
  }
  if (
    price.base.asset_id === dfsAsset.id &&
    price.quote.asset_id === debtAsset.id
  ) {
    return quoteAmount / baseAmount;
  }
  return 0;
};

const LendingScreen: React.FC = () => {
  const { currentAccount } = useAccountStore();
  const balanceItems = useBalanceStore(state => state.balanceItems);
  const [dfsAsset, setDfsAsset] = useState<AssetObject | null>(null);
  const [borrowAssets, setBorrowAssets] = useState<AssetObject[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [fullAccount, setFullAccount] = useState<FullAccountData | null>(null);
  const [collateral, setCollateral] = useState('');
  const [borrowAmount, setBorrowAmount] = useState('');
  const [bitAssetDataMap, setBitAssetDataMap] = useState<
    Map<string, BitAssetData>
  >(new Map());
  const [sliderRatio, setSliderRatio] = useState(3);
  const [, setIsSliding] = useState(false);
  const sliderCalculation = React.useRef('');
  const pageScrollRef = React.useRef<ScrollView>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closingOrderId, setClosingOrderId] = useState<string | null>(null);
  const [targetRatioEnabled, setTargetRatioEnabled] = useState(false);
  const [targetRatio, setTargetRatio] = useState(3);
  const [assetPickerVisible, setAssetPickerVisible] = useState(false);

  const selectedAsset = useMemo(
    () =>
      borrowAssets.find(asset => asset.id === selectedAssetId) ||
      borrowAssets[0] ||
      null,
    [borrowAssets, selectedAssetId],
  );

  const dfsBalance = useMemo(() => {
    if (!dfsAsset) return null;
    return (
      balanceItems.find(
        item => item.assetId === dfsAsset.id || item.symbol === DFS_SYMBOL,
      ) || null
    );
  }, [balanceItems, dfsAsset]);

  const callOrders = useMemo<CallOrder[]>(
    () =>
      (fullAccount?.call_orders || []).filter(
        order => order.call_price?.base?.asset_id === dfsAsset?.id,
      ),
    [fullAccount, dfsAsset],
  );

  const selectedBitAsset = selectedAsset
    ? bitAssetDataMap.get(selectedAsset.id) || null
    : null;
  const selectedCallOrder = useMemo(
    () =>
      callOrders.find(
        order => order.call_price?.quote?.asset_id === selectedAsset?.id,
      ) || null,
    [callOrders, selectedAsset],
  );
  const feedPrice = useMemo(
    () => getDebtPerDfs(selectedBitAsset, selectedAsset, dfsAsset),
    [selectedBitAsset, selectedAsset, dfsAsset],
  );
  const initialCollateralRatio =
    (selectedBitAsset?.current_feed.initial_collateral_ratio || 2000) / 10;
  const currentPositionCollateral = selectedCallOrder
    ? toReal(selectedCallOrder.collateral, dfsAsset?.precision ?? 5)
    : 0;
  const currentPositionDebt = selectedCallOrder
    ? toReal(selectedCallOrder.debt, selectedAsset?.precision ?? 5)
    : 0;
  // 与官方钱包一致：输入框表示调整后的仓位总额，链上提交总额与当前值的差额。
  const proposedTotalCollateral = Math.max(0, Number(collateral) || 0);
  const proposedTotalDebt = Math.max(0, Number(borrowAmount) || 0);
  const collateralDelta = proposedTotalCollateral - currentPositionCollateral;
  const debtDelta = proposedTotalDebt - currentPositionDebt;

  const currentCollateralRatio = useMemo(() => {
    if (feedPrice <= 0 || proposedTotalDebt <= 0) return 0;
    return ((proposedTotalCollateral * feedPrice) / proposedTotalDebt) * 100;
  }, [feedPrice, proposedTotalCollateral, proposedTotalDebt]);

  const updateBorrowFromSlider = useCallback(
    (ratio: number) => {
      setSliderRatio(ratio);
      // An empty form still allows choosing a ratio, without clearing user input.
      if (feedPrice <= 0 || proposedTotalCollateral <= 0) return;
      const precision = selectedAsset?.precision ?? 6;
      const nextDebt = formatDown((proposedTotalCollateral * feedPrice) / ratio, precision);
      sliderCalculation.current = `${proposedTotalCollateral}|${feedPrice}|${nextDebt}`;
      setBorrowAmount(nextDebt);
    },
    [feedPrice, proposedTotalCollateral, selectedAsset?.precision],
  );

  const handleBorrowChange = useCallback(
    (value: string) => {
      sliderCalculation.current = '';
      setBorrowAmount(
        filterNumericInput(value, selectedAsset?.precision ?? 8),
      );
    },
    [selectedAsset?.precision],
  );

  useEffect(() => {
    if (selectedCallOrder && selectedAsset && dfsAsset) {
      setCollateral(
        formatDown(
          toReal(selectedCallOrder.collateral, dfsAsset.precision),
          dfsAsset.precision,
        ),
      );
      setBorrowAmount(
        formatDown(
          toReal(selectedCallOrder.debt, selectedAsset.precision),
          selectedAsset.precision,
        ),
      );
    } else {
      setCollateral('');
      setBorrowAmount('');
    }
    sliderCalculation.current = '';
    setSliderRatio(3);
    setTargetRatioEnabled(false);
    setTargetRatio(3);
  }, [
    dfsAsset,
    selectedAsset,
    selectedCallOrder?.id,
    selectedCallOrder?.collateral,
    selectedCallOrder?.debt,
    selectedCallOrder,
  ]);

  useEffect(() => {
    // Do not round-trip slider-generated debt through asset precision: it moves the thumb.
    if (sliderCalculation.current === `${proposedTotalCollateral}|${feedPrice}|${borrowAmount}`) return;
    if (currentCollateralRatio > 0) setSliderRatio(currentCollateralRatio / 100);
  }, [borrowAmount, proposedTotalCollateral, feedPrice, currentCollateralRatio]);

  const loadData = useCallback(async () => {
    if (!currentAccount) return;
    setLoading(true);
    try {
      const account = await chainServiceMgr.queryFullAccountInfo(
        currentAccount.id,
      );
      setFullAccount(account);
      const debtSymbols = (account?.call_orders || [])
        .map(order => order.call_price?.quote?.asset_id)
        .filter(Boolean);
      const assets = await chainServiceMgr.queryAssetsBySymbols([
        ...FALLBACK_BORROW_SYMBOLS,
        DFS_SYMBOL,
      ]);
      const debtAssets = debtSymbols.length
        ? await chainServiceMgr.getAssets(debtSymbols)
        : [];
      let listedAssets: AssetObject[] = [];
      try {
        listedAssets = await chainServiceMgr.listAssets('', 100);
      } catch {
        // 某些旧节点不支持空起始符号，使用下方的常用资产兜底。
      }
      const allAssets = new Map<string, AssetObject>();
      [...assets.values(), ...debtAssets, ...listedAssets].forEach(
        asset => asset && allAssets.set(asset.id, asset),
      );
      const dfs =
        [...allAssets.values()].find(asset => asset.symbol === DFS_SYMBOL) ||
        null;
      setDfsAsset(dfs);
      const candidates = [...allAssets.values()].filter(
        asset => asset.symbol !== DFS_SYMBOL && asset.bitasset_data_id,
      );
      const bitAssetObjects = candidates.length
        ? ((await chainServiceMgr.getObjects(
            candidates.map(asset => asset.bitasset_data_id!),
          )) as Array<BitAssetData | null>)
        : [];
      const nextBitAssetDataMap = new Map<string, BitAssetData>();
      bitAssetObjects.forEach(bitAsset => {
        if (bitAsset) nextBitAssetDataMap.set(bitAsset.asset_id, bitAsset);
      });
      setBitAssetDataMap(nextBitAssetDataMap);
      // 只有以 DFS 为抵押物、且当前有有效链上喂价的智能资产才能借出。
      const options = candidates.filter(asset => {
        const bitAsset = nextBitAssetDataMap.get(asset.id);
        const settlementPrice = bitAsset?.current_feed?.settlement_price;
        if (
          !dfs ||
          !bitAsset ||
          bitAsset.options.short_backing_asset !== dfs.id ||
          !isPositivePrice(settlementPrice)
        ) {
          return false;
        }
        const priceAssetIds = new Set([
          settlementPrice!.base.asset_id,
          settlementPrice!.quote.asset_id,
        ]);
        return priceAssetIds.has(dfs.id) && priceAssetIds.has(asset.id);
      });
      setBorrowAssets(options);
      setSelectedAssetId(current =>
        options.some(asset => asset.id === current)
          ? current
          : options[0]?.id || '',
      );
    } catch (error) {
      Toast.error(formatGrapheneError(error));
    } finally {
      setLoading(false);
    }
  }, [currentAccount]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const validate = () => {
    const collateralValue = Number(collateral) || 0;
    const borrowValue = Number(borrowAmount);
    if (!currentAccount) return '请先登录钱包';
    if (!dfsAsset) return '暂未找到 DFS 资产，请检查节点连接';
    if (!selectedAsset) return '暂无可借资产';
    if (!selectedBitAsset || feedPrice <= 0)
      return `${selectedAsset.symbol} 当前没有有效链上喂价，暂时不能借款`;
    if (!Number.isFinite(collateralValue) || collateralValue <= 0)
      return '请输入调整后的 DFS 抵押数量';
    if (!Number.isFinite(borrowValue) || borrowValue <= 0)
      return selectedCallOrder
        ? '请输入调整后的债务；如需全部归还，请使用平仓功能'
        : '请输入借款数量';
    const collateralUnit = Math.pow(10, -(dfsAsset?.precision ?? 5));
    const debtUnit = Math.pow(10, -(selectedAsset?.precision ?? 5));
    if (
      Math.abs(collateralDelta) < collateralUnit &&
      Math.abs(debtDelta) < debtUnit
    )
      return '仓位没有变化';
    const increasesRisk = debtDelta > 0 || collateralDelta < 0;
    if (
      increasesRisk &&
      currentCollateralRatio > 0 &&
      currentCollateralRatio < initialCollateralRatio
    )
      return `抵押率仅 ${currentCollateralRatio.toFixed(
        1,
      )}%，必须达到开仓线 ${initialCollateralRatio.toFixed(0)}%`;
    if (dfsBalance && collateralDelta > dfsBalance.available)
      return `DFS 可用余额不足（可用 ${formatAmount(
        dfsBalance.available,
        dfsBalance.precision,
      )}）`;
    if (debtDelta < 0) {
      const debtBalance = balanceItems.find(
        item =>
          item.assetId === selectedAsset.id ||
          item.symbol === selectedAsset.symbol,
      );
      if (!debtBalance || debtBalance.available + debtUnit < -debtDelta) {
        return `${selectedAsset.symbol} 可用余额不足，无法偿还 ${formatAmount(
          -debtDelta,
          selectedAsset.precision,
        )} ${selectedAsset.symbol}`;
      }
    }
    return null;
  };

  const submitBorrow = () => {
    const error = validate();
    if (error) {
      Toast.warning(error);
      return;
    }
    UnlockModal.show({
      accountId: currentAccount!.id,
      accountName: currentAccount!.name,
      onSuccess: (keys: UnlockedKeys) => executeBorrow(keys),
    });
  };

  const executeBorrow = async (keys: UnlockedKeys) => {
    if (!currentAccount || !dfsAsset || !selectedAsset) return;
    const activeKey = keys.active;
    if (!activeKey) {
      Toast.error('缺少资金私钥');
      return;
    }
    setSubmitting(true);
    BlockView.show('正在提交仓位调整...');
    try {
      const collateralInt = Math.round(
        collateralDelta * Math.pow(10, dfsAsset.precision),
      );
      const debtInt = Math.round(
        debtDelta * Math.pow(10, selectedAsset.precision),
      );
      await chainServiceMgr.updateCallOrder(
        {
          accountId: currentAccount.id,
          collateralAssetId: dfsAsset.id,
          collateralDelta: collateralInt,
          debtAssetId: selectedAsset.id,
          debtDelta: debtInt,
          feeAssetId: CURRENT_NETWORK.coreAssetId,
        },
        activeKey,
      );
      Toast.success(
        `已提交：仓位调整为 ${formatAmount(
          proposedTotalCollateral,
          dfsAsset.precision,
        )} DFS / ${formatAmount(proposedTotalDebt, selectedAsset.precision)} ${
          selectedAsset.symbol
        }`,
      );
      setCollateral('');
      setBorrowAmount('');
      setSliderRatio(3);
      await backgroundService.refreshAccountBalance();
      await loadData();
    } catch (error) {
      Toast.error(formatGrapheneError(error));
    } finally {
      BlockView.hide();
      setSubmitting(false);
    }
  };

  const executeClosePosition = async (
    order: CallOrder,
    debtAsset: AssetObject,
    keys: UnlockedKeys,
  ) => {
    if (!currentAccount || !dfsAsset) return;
    const activeKey = keys.active;
    if (!activeKey) {
      Toast.error('缺少资金私钥');
      return;
    }
    setClosingOrderId(order.id);
    BlockView.show(`正在关闭 ${debtAsset.symbol} 借仓...`);
    try {
      await chainServiceMgr.updateCallOrder(
        {
          accountId: currentAccount.id,
          collateralAssetId: dfsAsset.id,
          collateralDelta: negateRawAmount(order.collateral),
          debtAssetId: debtAsset.id,
          debtDelta: negateRawAmount(order.debt),
          feeAssetId: CURRENT_NETWORK.coreAssetId,
        },
        activeKey,
      );
      Toast.success(
        `已平仓：全部偿还 ${formatAmount(
          toReal(order.debt, debtAsset.precision),
          debtAsset.precision,
        )} ${debtAsset.symbol}，DFS 抵押物已解锁`,
      );
      await backgroundService.refreshAccountBalance();
      await loadData();
    } catch (error) {
      Toast.error(formatGrapheneError(error));
    } finally {
      BlockView.hide();
      setClosingOrderId(null);
    }
  };

  const requestClosePosition = (order: CallOrder, debtAsset: AssetObject) => {
    if (!currentAccount || !dfsAsset) return;
    const collateralAmount = toReal(order.collateral, dfsAsset.precision);
    const debtAmount = toReal(order.debt, debtAsset.precision);
    const debtUnit = Math.pow(10, -debtAsset.precision);
    const debtBalance = balanceItems.find(
      item => item.assetId === debtAsset.id || item.symbol === debtAsset.symbol,
    );
    if (!debtBalance || debtBalance.available + debtUnit < debtAmount) {
      Toast.warning(
        `平仓需要 ${formatAmount(debtAmount, debtAsset.precision)} ${
          debtAsset.symbol
        }，当前可用 ${formatAmount(
          debtBalance?.available || 0,
          debtAsset.precision,
        )}`,
      );
      return;
    }
    Alert.alert(
      `确认关闭 ${debtAsset.symbol} 借仓`,
      `将偿还全部 ${formatAmount(debtAmount, debtAsset.precision)} ${
        debtAsset.symbol
      }，并解锁 ${formatAmount(
        collateralAmount,
        dfsAsset.precision,
      )} DFS。链上手续费另行扣除。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认平仓',
          style: 'destructive',
          onPress: () =>
            UnlockModal.show({
              accountId: currentAccount.id,
              accountName: currentAccount.name,
              onSuccess: keys => executeClosePosition(order, debtAsset, keys),
            }),
        },
      ],
    );
  };

  const handleReset = () => {
    setCollateral('');
    setBorrowAmount('');
    setSliderRatio(3);
    setTargetRatioEnabled(false);
    setTargetRatio(3);
  };

  const renderPosition = (order: CallOrder) => {
    const debtAsset = borrowAssets.find(
      asset => asset.id === order.call_price.quote.asset_id,
    );
    const collateralAmount = toReal(order.collateral, dfsAsset?.precision ?? 5);
    const debtAmount = toReal(order.debt, debtAsset?.precision ?? 5);
    const bitAsset = debtAsset
      ? bitAssetDataMap.get(debtAsset.id) || null
      : null;
    const positionFeedPrice = getDebtPerDfs(
      bitAsset,
      debtAsset || null,
      dfsAsset,
    );
    const positionRatio =
      positionFeedPrice > 0 && debtAmount > 0
        ? (collateralAmount * positionFeedPrice * 100) / debtAmount
        : 0;
    const positionMcr =
      (bitAsset?.current_feed.maintenance_collateral_ratio || 1750) / 10;
    return (
      <View key={order.id} style={styles.positionCard}>
        <View style={styles.positionHeader}>
          <View style={styles.positionTitleRow}>
            <Icon name="shield-check-outline" size={20} color="#00D094" />
            <Text style={styles.positionTitle}>
              {debtAsset?.symbol || order.call_price.quote.asset_id} 借仓
            </Text>
          </View>
          <Text style={styles.positionId}>{order.id}</Text>
        </View>
        <View style={styles.positionGrid}>
          <View style={styles.positionMetric}>
            <Text style={styles.metaLabel}>DFS 抵押</Text>
            <Text style={styles.metaValue}>
              {formatAmount(collateralAmount)} DFS
            </Text>
          </View>
          <View style={styles.positionMetric}>
            <Text style={styles.metaLabel}>当前债务</Text>
            <Text style={styles.metaValue}>
              {formatAmount(debtAmount)} {debtAsset?.symbol || ''}
            </Text>
          </View>
          <View style={styles.positionMetric}>
            <Text style={styles.metaLabel}>当前抵押率</Text>
            <Text
              style={[
                styles.metaValue,
                positionRatio > 0 && {
                  color: positionRatio >= positionMcr ? '#00D094' : '#FF4757',
                },
              ]}
            >
              {positionRatio > 0 ? `${positionRatio.toFixed(1)}%` : '--'}
            </Text>
          </View>
        </View>
        <Text style={styles.positionHint}>
          抵押率按当前链上喂价计算，清算线 {positionMcr.toFixed(0)}%
        </Text>
        {debtAsset && (
          <View style={styles.positionActions}>
            <TouchableOpacity
              style={styles.adjustButton}
              onPress={() => {
                setSelectedAssetId(debtAsset.id);
                pageScrollRef.current?.scrollTo({ y: 120, animated: true });
              }}
            >
              <Icon name="tune-variant" size={17} color="#00D094" />
              <Text style={styles.adjustButtonText}>调整仓位</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.closeButton,
                closingOrderId === order.id && styles.buttonDisabled,
              ]}
              onPress={() => requestClosePosition(order, debtAsset)}
              disabled={closingOrderId === order.id || submitting}
            >
              {closingOrderId === order.id ? (
                <ActivityIndicator size="small" color="#FF6673" />
              ) : (
                <Icon name="close-circle-outline" size={17} color="#FF6673" />
              )}
              <Text style={styles.closeButtonText}>全部平仓</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const selectedSymbol = selectedAsset?.symbol || 'CNY';
  const availableBorrow = selectedAsset
    ? balanceItems.find(
        item => item.assetId === selectedAsset.id || item.symbol === selectedSymbol,
      )?.available || 0
    : 0;
  const availableCollateral = dfsBalance?.available || 0;
  const quoteLabel = feedPrice > 0 ? formatAmount(feedPrice, 4) : '--';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#070A09" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={pageScrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.shell}>
            <View style={styles.headerRow}>
              <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
                <Icon name="reload" size={18} color="#A1ABA6" />
                <Text style={styles.resetText}>重置</Text>
              </TouchableOpacity>
              <View style={styles.pageTitleWrap}>
                <View style={styles.pageTitleIcon}>
                  <Icon name="hand-coin-outline" size={20} color="#00D5A3" />
                </View>
                <Text style={styles.title} numberOfLines={1}>抵押借贷</Text>
              </View>
              <TouchableOpacity style={styles.assetSelector} onPress={() => setAssetPickerVisible(true)}>
                <Text style={styles.assetSelectorText} numberOfLines={1}>选择资产</Text>
                <Icon name="chevron-down" size={18} color="#F0F4F2" />
              </TouchableOpacity>
            </View>

            <View style={styles.marketCard}>
              <View style={styles.marketTopRow}>
                <View style={styles.coinBadge}><Text style={styles.coinBadgeText}>B</Text></View>
                <View style={styles.marketTitleWrap}>
                  <Text style={styles.marketTitle}>DFS / {selectedSymbol}</Text>
                  <Text style={styles.marketHint}>链上抵押市场</Text>
                </View>
              </View>
              <View style={styles.marketDivider} />
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>当前喂价</Text>
                <Text style={styles.quoteValue} numberOfLines={1} adjustsFontSizeToFit>{quoteLabel}</Text>
                <Text style={styles.quoteUnit} numberOfLines={1} adjustsFontSizeToFit>{selectedSymbol} / DFS</Text>
                <Icon name="help-circle-outline" size={18} color="#6A7771" style={styles.quoteHelp} />
              </View>
            </View>

            <View style={styles.formCard}>
              <View style={styles.formTitleRow}>
                <Icon name="lock-outline" size={22} color="#00D5A3" />
                <Text style={styles.formTitle}>{selectedCallOrder ? '调整抵押借贷' : '创建抵押借贷'}</Text>
                <Icon name="help-circle-outline" size={22} color="#00D5A3" style={styles.formHelp} />
              </View>

              <View style={styles.fieldHeader}>
                <Text style={styles.fieldTitle}>借款金额</Text>
                <Text style={styles.balanceText}>可用余额 {formatAmount(availableBorrow, selectedAsset?.precision || 2)} {selectedSymbol}</Text>
              </View>
              <View style={styles.amountBox}>
                <TextInput
                  value={borrowAmount}
                  onChangeText={handleBorrowChange}
                  keyboardType="decimal-pad"
                  placeholder="请输入借款金额"
                  placeholderTextColor="#66706B"
                  style={styles.amountInput}
                />
                <TouchableOpacity style={styles.currencyPicker} onPress={() => setAssetPickerVisible(true)}>
                  <Text style={styles.currencyText}>{selectedSymbol}</Text>
                  <Icon name="chevron-down" size={23} color="#00D5A3" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleBorrowChange(String(Math.max(0, availableBorrow)))}>
                  <Text style={styles.actionText}>还款</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.fieldDivider} />
              <View style={styles.fieldHeader}>
                <Text style={styles.fieldTitle}>抵押物</Text>
                <Text style={styles.balanceText}>可用余额 {formatAmount(availableCollateral, dfsBalance?.precision || 2)} DFS</Text>
              </View>
              <View style={styles.amountBox}>
                <TextInput
                  value={collateral}
                  onChangeText={value => setCollateral(filterNumericInput(value, 8))}
                  keyboardType="decimal-pad"
                  placeholder="请输入抵押物数量"
                  placeholderTextColor="#66706B"
                  style={styles.amountInput}
                />
                <Text style={styles.currencyText}>DFS</Text>
                <TouchableOpacity onPress={() => setCollateral(String(Math.max(0, availableCollateral)))}>
                  <Text style={styles.actionText}>全部</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.fieldDivider} />
              <View style={styles.sliderTitleRow}>
                <View style={styles.sliderHeadingLeft}>
                  <Icon name="shield-check-outline" size={27} color="#00D5A3" />
                  <Text style={styles.sliderTitle}>抵押率</Text>
                  <Text style={styles.sliderNumber}>{sliderRatio.toFixed(2)}</Text>
                </View>
                <Icon name="help-circle-outline" size={27} color="#6A7771" />
              </View>
              <RatioSlider value={sliderRatio} minimum={1} maximum={6} label="抵押率" onChange={updateBorrowFromSlider} onSlidingChange={setIsSliding} />
              <View style={styles.ratioScale}><Text style={styles.scaleText}>1.00</Text><Text style={styles.scaleText}>3.50</Text><Text style={styles.scaleText}>6.00</Text></View>

              <View style={styles.sliderTitleRowTarget}>
                <View style={styles.sliderHeadingLeft}>
                  <Icon name="creation" size={22} color="#00D5A3" />
                  <Text style={styles.sliderTitle}>目标抵押率</Text>
                  <Text style={styles.sliderNumber}>{targetRatioEnabled ? targetRatio.toFixed(2) : '未设置'}</Text>
                </View>
                <Icon name="help-circle-outline" size={27} color="#6A7771" />
              </View>
              <RatioSlider value={targetRatioEnabled ? targetRatio : 0} minimum={0} maximum={6} label="目标抵押率" onChange={value => { setTargetRatioEnabled(value > 0); setTargetRatio(value); }} onSlidingChange={setIsSliding} />
              <View style={styles.ratioScale}><Text style={styles.scaleText}>关闭</Text><Text style={styles.scaleText}>3.00</Text><Text style={styles.scaleText}>6.00</Text></View>

              <View style={styles.estimateCard}>
                <View style={styles.estimateItem}><Text style={styles.estimateLabel}>预计借款</Text><Text style={styles.estimateValue} numberOfLines={1} adjustsFontSizeToFit>{borrowAmount ? formatAmount(Number(borrowAmount), 4) : '--'}</Text></View>
                <View style={styles.estimateDivider} />
                <View style={styles.estimateItem}><Text style={styles.estimateLabel}>预计抵押</Text><Text style={styles.estimateValue} numberOfLines={1} adjustsFontSizeToFit>{collateral ? formatAmount(Number(collateral), 4) : '--'}</Text></View>
              </View>

              <TouchableOpacity style={[styles.primaryButton, (submitting || loading) && styles.buttonDisabled]} onPress={submitBorrow} disabled={submitting || loading}>
                {submitting ? <ActivityIndicator color="#06211A" /> : <><Icon name="briefcase-outline" size={24} color="#06211A" /><Text style={styles.primaryButtonText}>抵押</Text></>}
              </TouchableOpacity>
            </View>

            <Modal visible={assetPickerVisible} transparent animationType="fade" onRequestClose={() => setAssetPickerVisible(false)}>
              <TouchableOpacity style={styles.assetModalBackdrop} activeOpacity={1} onPress={() => setAssetPickerVisible(false)}>
                <View style={styles.assetModalCard}>
                  <Text style={styles.assetModalTitle}>选择借款资产</Text>
                  {borrowAssets.map(asset => (
                    <TouchableOpacity key={asset.id} style={styles.assetOption} onPress={() => { setSelectedAssetId(asset.id); setAssetPickerVisible(false); }}>
                      <Text style={styles.assetOptionSymbol}>{asset.symbol}</Text>
                      <Icon name={asset.id === selectedAsset?.id ? 'check-circle' : 'chevron-right'} size={20} color={asset.id === selectedAsset?.id ? '#00D5A3' : '#718078'} />
                    </TouchableOpacity>
                  ))}
                </View>
              </TouchableOpacity>
            </Modal>

            <View style={styles.notice}>
              <Icon name="information-outline" size={28} color="#E6BD4A" />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>温馨提示</Text>
                <Text style={styles.noticeText}>当喂价下降到强平触发价时，系统将自动出售您的抵押资产用于归还借款，请注意调整抵押率控制风险。</Text>
                <Text style={styles.noticeText}>当锁定借款金额时，抵押率会随抵押物数量变化而变化。</Text>
                <Text style={styles.noticeText}>当锁定抵押率时，借款金额会随抵押物数量变化而变化。</Text>
              </View>
            </View>

            <View style={styles.positionsHeader}><Text style={styles.sectionTitle}>我的借仓</Text><Text style={styles.countText}>{callOrders.length} 个仓位</Text></View>
            {loading ? <ActivityIndicator color="#00D5A3" style={styles.loader} /> : callOrders.length > 0 ? callOrders.map(renderPosition) : <View style={styles.emptyCard}><Icon name="file-outline" size={32} color="#555555" /><Text style={styles.emptyText}>暂无 DFS 借仓</Text><Text style={styles.emptyHint}>抵押 DFS 后，借款仓位会显示在这里</Text></View>}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070A09' },
  flex: { flex: 1 },
  content: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 16 },
  shell: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#27332E',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 14,
    backgroundColor: '#080B0A',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    marginBottom: 10,
    position: 'relative',
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 5,
    paddingRight: 8,
    zIndex: 2,
  },
  resetText: { color: '#A1ABA6', fontSize: 10, fontWeight: '500' },
  pageTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
    pointerEvents: 'none',
  },
  pageTitleIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#07372D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#F4F8F6',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  assetSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    zIndex: 2,
  },
  assetSelectorText: { color: '#F4F8F6', fontSize: 12, fontWeight: '600' },
  marketCard: {
    backgroundColor: '#0C1E18',
    borderWidth: 1,
    borderColor: '#0A6D50',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
  },
  marketTopRow: { flexDirection: 'row', alignItems: 'center' },
  coinBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#06D5A0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  coinBadgeText: { color: '#05261E', fontSize: 22, fontWeight: '900' },
  marketTitleWrap: { flex: 1 },
  marketTitle: { color: '#F2F6F4', fontSize: 13, fontWeight: '800' },
  marketHint: { color: '#72857D', fontSize: 12, marginTop: 4 },
  marketDivider: {
    height: 1,
    backgroundColor: '#174637',
    marginTop: 12,
    marginBottom: 6,
  },
  quoteRow: { flexDirection: 'row', alignItems: 'center' },
  quoteLabel: { color: '#94A29C', fontSize: 12, fontWeight: '600' },
  quoteValue: {
    color: '#00D6A4',
    fontSize: 24,
    fontWeight: '800',
    marginLeft: 8,
  },
  quoteUnit: { flex: 1, color: '#8A9791', fontSize: 11, marginLeft: 6 },
  quoteHelp: { marginLeft: 4 },
  formCard: {
    backgroundColor: '#111513',
    borderWidth: 1,
    borderColor: '#2A3430',
    borderRadius: 20,
    padding: 14,
  },
  formTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
  },
  formTitle: {
    color: '#F1F5F3',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  formHelp: { marginLeft: 'auto' },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  fieldTitle: { color: '#E7ECE9', fontSize: 13, fontWeight: '700' },
  balanceText: { color: '#7A8882', fontSize: 11, flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#19201D',
    borderRadius: 12,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  amountInput: {
    flex: 1,
    color: '#F2F6F4',
    fontSize: 12,
    minWidth: 0,
    paddingVertical: 4,
  },
  currencyPicker: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  currencyText: { color: '#00D5A3', fontSize: 12, fontWeight: '800' },
  actionText: {
    color: '#00D5A3',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 12,
  },
  fieldDivider: { height: 1, backgroundColor: '#2B332F', marginVertical: 9 },
  sliderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sliderTitleRowTarget: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  sliderHeadingLeft: { flexDirection: 'row', alignItems: 'center' },
  sliderTitle: { color: '#E7ECE9', fontSize: 13, fontWeight: '700', marginLeft: 6 },
  sliderNumber: {
    color: '#00D5A3',
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 10,
  },
  ratioSliderTouch: { height: 30, justifyContent: 'center', marginTop: 5 },
  targetSliderTouch: { height: 30, justifyContent: 'center', marginTop: 5 },
  ratioSliderTrack: {
    height: 10,
    borderRadius: 6,
    position: 'relative',
    justifyContent: 'center',
  },
  ratioSliderBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#3A423E',
    borderRadius: 6,
  },
  ratioSliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#00D5A3',
    borderRadius: 6,
  },
  ratioSliderThumb: {
    position: 'absolute',
    width: 30,
    height: 30,
    marginLeft: -15,
    borderRadius: 15,
    backgroundColor: '#111513',
    borderWidth: 7,
    borderColor: '#00D5A3',
  },
  ratioScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 0,
  },
  scaleText: { color: '#68736E', fontSize: 12 },
  estimateCard: {
    flexDirection: 'row',
    backgroundColor: '#0D1D17',
    borderWidth: 1,
    borderColor: '#21473A',
    borderRadius: 20,
    minHeight: 48,
    marginTop: 8,
  },
  estimateItem: { flex: 1, minWidth: 0, justifyContent: 'center', paddingHorizontal: 10 },
  estimateDivider: { width: 1, backgroundColor: '#21473A', marginVertical: 12 },
  estimateLabel: { color: '#86958E', fontSize: 12, fontWeight: '600' },
  estimateValue: { color: '#EAF1ED', fontSize: 12, fontWeight: '700', marginTop: 6 },
  primaryButton: {
    marginTop: 12,
    backgroundColor: '#00D5A3',
    borderRadius: 18,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  primaryButtonText: { color: '#06211A', fontSize: 13, fontWeight: '800' },
  buttonDisabled: { opacity: 0.5 },
  assetModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  assetModalCard: {
    backgroundColor: '#111A16',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#245947',
    padding: 14,
  },
  assetModalTitle: { color: '#F1F5F3', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  assetOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#26352F' },
  assetOptionSymbol: { color: '#00D5A3', fontSize: 14, fontWeight: '700' },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#241F14',
    borderWidth: 1,
    borderColor: '#59491F',
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 7,
  },
  noticeCopy: { flex: 1, marginLeft: 8 },
  noticeTitle: {
    color: '#E6BD4A',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 5,
  },
  noticeText: { color: '#B3A477', fontSize: 10, lineHeight: 14, marginTop: 2 },
  positionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 5,
  },
  sectionTitle: { color: '#F1F5F3', fontSize: 15, fontWeight: '700' },
  countText: { color: '#777', fontSize: 12 },
  positionCard: {
    backgroundColor: '#161B19',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#29332F',
    padding: 18,
    marginBottom: 12,
  },
  positionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  positionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  positionTitle: { color: '#F0F4F2', fontSize: 13, fontWeight: '600' },
  positionId: { color: '#65706B', fontSize: 11 },
  positionGrid: { flexDirection: 'row', gap: 6, marginTop: 8 },
  positionMetric: { flex: 1 },
  metaLabel: { color: '#7C8882', fontSize: 12 },
  metaValue: { color: '#FFF', fontSize: 13, fontWeight: '600', marginTop: 4 },
  positionHint: { color: '#6E7974', fontSize: 10, marginTop: 7 },
  positionActions: { flexDirection: 'row', gap: 6, marginTop: 8 },
  adjustButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#17684F',
    backgroundColor: '#12231D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  adjustButtonText: { color: '#00D094', fontSize: 13, fontWeight: '600' },
  closeButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#67303A',
    backgroundColor: '#26171A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  closeButtonText: { color: '#FF6673', fontSize: 13, fontWeight: '600' },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: '#161B19',
    borderRadius: 18,
  },
  emptyText: { color: '#777', fontSize: 12, marginTop: 8 },
  emptyHint: { color: '#58615D', fontSize: 12, marginTop: 5 },
  loader: { marginTop: 30 },
});

export default LendingScreen;

