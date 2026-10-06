import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Text } from '@rneui/themed';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { localCacheManager } from '../services/local_cache_mgr';
import { useAccountStore } from '../store/useAccountStore';
import { chainServiceMgr, formatGrapheneError } from '../services/chainservice_mgr';
import { Toast } from '../components/Toast';
import { BlockView } from '../components/BlockView';
import { UnlockModal, type UnlockedKeys } from '../components/UnlockModal';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { minimumReceiveWithSlippage } from '@defishares/core';
import { collectLiquidityHistoryReferences, parseLiquidityHistory, type HistoryAsset, type LiquidityHistoryEntry } from '../utils/liquidityPoolHistory';
import { getLiquidityPoolMetrics, type LiquidityPoolStatistics } from '../utils/liquidityPoolStats';

type Pool = { id: string; assetAId: string; assetBId: string; shareAssetId: string; assetA: string; assetB: string; shareAsset: string; precisionA: number; precisionB: number; precisionShare: number; balanceA: number; balanceB: number; fee: number; withdrawalFee: number; change24h: number | null; volume24h: number | null; source?: string };
type Page = 'list' | 'swap' | 'liquidity' | 'history' | 'add' | 'create' | 'withdraw';
type Tab = 'favorites' | 'pools';

const DFS_FALLBACK_POOLS: Pool[] = [
  { id: 'dfs-cny', assetAId: '1.3.0', assetBId: '', shareAssetId: '', assetA: 'DFS', assetB: 'CNY', shareAsset: 'DFS-CNY-LP', precisionA: 5, precisionB: 4, precisionShare: 5, balanceA: 0, balanceB: 0, fee: 0.1, withdrawalFee: 0, change24h: null, volume24h: null },
  { id: 'dfs-gold', assetAId: '1.3.0', assetBId: '', shareAssetId: '', assetA: 'DFS', assetB: 'GOLD', shareAsset: 'DFS-GOLD-LP', precisionA: 5, precisionB: 4, precisionShare: 5, balanceA: 0, balanceB: 0, fee: 0.1, withdrawalFee: 0, change24h: null, volume24h: null },
];
const chainAmount = (value: string, precision: number) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n * 10 ** precision) : null; };
const displayAmount = (n: number) => n > 0 ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '--';
const objectIdNumber = (id: string) => Number(id.split('.').pop() || Number.MAX_SAFE_INTEGER);
const getPoolQuote = (pool: Pool) => {
  const quoteIsA = pool.assetB === 'DFS' && pool.assetA !== 'DFS';
  const quoteAmount = quoteIsA ? pool.balanceA : pool.balanceB;
  const baseAmount = quoteIsA ? pool.balanceB : pool.balanceA;
  const quoteSymbol = quoteIsA ? pool.assetA : pool.assetB;
  const baseSymbol = quoteIsA ? pool.assetB : pool.assetA;
  return { quoteAmount, baseAmount, quoteSymbol, baseSymbol };
};
const getPoolTotalValue = (pool: Pool): { amount: number; symbol: string } => {
  // DFS 池统一用另一侧资产计价，把两边储备折算后相加。
  const { quoteAmount, baseAmount, quoteSymbol } = getPoolQuote(pool);
  if (!(quoteAmount > 0) || !(baseAmount > 0)) {
    return { amount: 0, symbol: quoteSymbol };
  }
  return {
    amount: quoteAmount + baseAmount * (quoteAmount / baseAmount),
    symbol: quoteSymbol,
  };
};
const getPoolPrice = (pool: Pool) => {
  const { quoteAmount, baseAmount } = getPoolQuote(pool);
  return quoteAmount > 0 && baseAmount > 0 ? quoteAmount / baseAmount : 0;
};
const estimateSwap = (p: Pool, side: 'a' | 'b', amount: number) => {
  const reserveIn = side === 'a' ? p.balanceA : p.balanceB;
  const reserveOut = side === 'a' ? p.balanceB : p.balanceA;
  if (!(reserveIn > 0 && reserveOut > 0 && amount > 0)) return 0;
  const fee = Math.max(0, Math.min(1, p.fee / 100));
  const netIn = amount * (1 - fee);
  return reserveOut * netIn / (reserveIn + netIn);
};

const FlashSwapScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [page, setPage] = useState<Page>('list');
  // 进入闪兑时默认展示流动性池，方便直接选择池子进行闪兑。
  const [tab, setTab] = useState<Tab>('pools');
  const [pool, setPool] = useState<Pool | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sellSide, setSellSide] = useState<'a' | 'b'>('a');
  const [sellAmount, setSellAmount] = useState('');
  const [minReceive, setMinReceive] = useState('');
  const [depositA, setDepositA] = useState('');
  const [depositB, setDepositB] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [createAssetA, setCreateAssetA] = useState('DFS');
  const [createAssetB, setCreateAssetB] = useState('CNY');
  const [createShareAsset, setCreateShareAsset] = useState('');
  const [createFee, setCreateFee] = useState('0.10');
  const [createWithdrawalFee, setCreateWithdrawalFee] = useState('0');
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<LiquidityHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyReload, setHistoryReload] = useState(0);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(new Set());
  const [favoritePoolIds, setFavoritePoolIds] = useState(() => localCacheManager.loadPoolFavorites());
  const account = useAccountStore(s => s.currentAccount);

  const loadPools = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const rows = await chainServiceMgr.listLiquidityPools(100, undefined, true);
      if (!rows?.length) { setPools(DFS_FALLBACK_POOLS); return; }
      const ids = Array.from(new Set(rows.flatMap((r: any) => [r.asset_a, r.asset_b, r.share_asset]).filter(Boolean)));
      const assets = await chainServiceMgr.getAssets(ids);
      const byId = new Map((assets || []).filter((asset): asset is NonNullable<typeof asset> => !!asset && !!asset.id).map(a => [a.id, a]));
      const mapped = rows.map((r: any): Pool => {
        const a = byId.get(r.asset_a) || { symbol: 'DFS', precision: 0 };
        const b = byId.get(r.asset_b) || { symbol: '', precision: 0 };
        const s = byId.get(r.share_asset) || { symbol: '', precision: 0 };
        const balanceA = Number(r.balance_a || 0) / 10 ** a.precision;
        const balanceB = Number(r.balance_b || 0) / 10 ** b.precision;
        const metrics = getLiquidityPoolMetrics({
          assetA: a.symbol,
          assetB: b.symbol,
          balanceA,
          balanceB,
          precisionA: a.precision,
          precisionB: b.precision,
          statistics: r.statistics as LiquidityPoolStatistics | undefined,
        });
        return { id: r.id, assetAId: r.asset_a, assetBId: r.asset_b, shareAssetId: r.share_asset, assetA: a.symbol, assetB: b.symbol, shareAsset: s.symbol, precisionA: a.precision, precisionB: b.precision, precisionShare: s.precision, balanceA, balanceB, fee: Number(r.taker_fee_percent || 0) / 100, withdrawalFee: Number(r.withdrawal_fee_percent || 0) / 100, change24h: metrics.change24h, volume24h: metrics.volume24h, source: r.owner || 'DFS' };
      }).filter((p: Pool) => p.assetA === 'DFS' || p.assetB === 'DFS');
      setPools(mapped.length ? mapped : DFS_FALLBACK_POOLS);
    } catch { setPools(DFS_FALLBACK_POOLS); } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { loadPools(); }, [loadPools]);

  useEffect(() => {
    if (page !== 'history' || !pool || pool.id.indexOf('1.') !== 0) return;
    let active = true;
    setHistoryLoading(true);
    setHistoryError(false);
    chainServiceMgr.getLiquidityPoolHistory(pool.id, undefined, undefined, 50).then(async rows => {
      if (!active) return;
      const rawRows = rows || [];
      const refs = collectLiquidityHistoryReferences(rawRows);
      const [assetRows, accountRows] = await Promise.all([
        refs.assetIds.length ? chainServiceMgr.getAssets(refs.assetIds) : Promise.resolve([]),
        refs.accountIds.length ? chainServiceMgr.getAccounts(refs.accountIds) : Promise.resolve([]),
      ]);
      if (!active) return;
      const assets = new Map<string, HistoryAsset>((assetRows || []).filter(Boolean).map((asset: any) => [asset.id, { id: asset.id, symbol: asset.symbol, precision: Number(asset.precision || 0) }]));
      const accounts = new Map<string, string>((accountRows || []).filter(Boolean).map((account: any) => [account.id, account.name]));
      setHistory(rawRows.map(row => parseLiquidityHistory(row, assets, accounts)));
    }).catch(() => { if (active) { setHistory([]); setHistoryError(true); } }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [page, pool, historyReload]);

  const refreshBalances = useCallback(async () => {
    if (!account || !pool) return;
    const ids = [pool.assetAId, pool.assetBId, pool.shareAssetId].filter(Boolean);
    if (!ids.length) return;
    try {
      const rows = await chainServiceMgr.getAccountBalances(account.id, ids);
      const next: Record<string, number> = {};
      (rows || []).forEach((row: any) => { next[row.asset_id] = Number(row.amount || 0); });
      setBalances(next);
    } catch {
      setBalances({});
    }
  }, [account, pool]);

  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  // 输入卖出数量后，按链上池子储备实时刷新预估获得数量（默认预留 0.5% 滑点）。
  useEffect(() => {
    if (!pool || !sellAmount || !Number.isFinite(Number(sellAmount)) || Number(sellAmount) <= 0) {
      setMinReceive('');
      return;
    }
    const estimated = estimateSwap(pool, sellSide, Number(sellAmount));
    const precision = sellSide === 'a' ? pool.precisionB : pool.precisionA;
    setMinReceive(minimumReceiveWithSlippage(estimated, precision));
  }, [pool, sellAmount, sellSide]);

  const available = (assetId: string, precision: number) => displayAmount((balances[assetId] || 0) / 10 ** precision);

  const openPool = (selected: Pool) => { setPool(selected); setPage('swap'); setSellSide('a'); setSellAmount(''); setMinReceive(''); };
  const requireAccount = () => { if (!account) Toast.warning('请先登录账户'); return !!account; };
  const helpButton = (message: string) => <TouchableOpacity accessibilityRole="button" accessibilityLabel="查看说明" onPress={() => Toast.info(message, 3500)} style={styles.helpButton}><Icon name="help-circle" size={23} color="#5889d4" /></TouchableOpacity>;
  const fillBalance = (assetId: string, precision: number, setter: (value: string) => void) => setter(String((balances[assetId] || 0) / 10 ** precision));

  const submitSwap = () => {
    if (!pool || !requireAccount()) return;
    if (!pool.assetBId) { Toast.warning('该 DFS 池暂未同步链上资产信息'); return; }
    const sellPrecision = sellSide === 'a' ? pool.precisionA : pool.precisionB; const receivePrecision = sellSide === 'a' ? pool.precisionB : pool.precisionA;
    const sell = chainAmount(sellAmount, sellPrecision);
    const estimated = sell ? estimateSwap(pool, sellSide, Number(sellAmount)) : 0;
    const safeMinimum = minimumReceiveWithSlippage(estimated, receivePrecision);
    const min = chainAmount(minReceive, receivePrecision) || chainAmount(safeMinimum, receivePrecision) || 0;
    if (!sell) { Toast.warning('请输入兑换数量'); return; }
    if (!min) { Toast.warning('请输入最小获得数量，或等待池子储备数据同步'); return; }
    UnlockModal.show({ accountId: account!.id, accountName: account!.name, onSuccess: (keys: UnlockedKeys) => { if (!keys.active) return Toast.error('缺少资金私钥。'); BlockView.show('正在兑换...'); chainServiceMgr.exchangeLiquidity({ accountId: account!.id, poolId: pool.id, amountToSell: sell, sellAssetId: sellSide === 'a' ? pool.assetAId : pool.assetBId, minToReceive: min, receiveAssetId: sellSide === 'a' ? pool.assetBId : pool.assetAId }, keys.active).then(() => { setHistoryReload(v => v + 1); Toast.success('兑换已提交'); setSellAmount(''); setMinReceive(''); }).catch(e => Toast.error(formatGrapheneError(e))).finally(() => BlockView.hide()); } });
  };

  const submitDeposit = () => {
    if (!pool || !requireAccount()) return;
    if (!pool.assetBId) { Toast.warning('该 DFS 池暂未同步链上资产信息'); return; }
    const a = chainAmount(depositA, pool.precisionA); const b = chainAmount(depositB, pool.precisionB);
    if (!a || !b) { Toast.warning('请输入两种资产数量'); return; }
    UnlockModal.show({ accountId: account!.id, accountName: account!.name, onSuccess: (keys: UnlockedKeys) => { if (!keys.active) return Toast.error('缺少资金私钥。'); BlockView.show('正在增加流动性...'); chainServiceMgr.depositLiquidity({ accountId: account!.id, poolId: pool.id, amountA: a, assetAId: pool.assetAId, amountB: b, assetBId: pool.assetBId }, keys.active).then(() => { setHistoryReload(v => v + 1); Toast.success('增加流动性已提交，正在同步 LP 余额'); refreshBalances(); setTimeout(refreshBalances, 1500); setTimeout(refreshBalances, 4000); }).catch(e => Toast.error(formatGrapheneError(e))).finally(() => BlockView.hide()); } });
  };

  const submitWithdraw = () => {
    if (!pool || !requireAccount()) return;
    if (!pool.shareAssetId) { Toast.warning('该池暂未同步 LP 资产信息'); return; }
    const amount = chainAmount(withdrawAmount, pool.precisionShare);
    if (!amount) { Toast.warning('请输入 LP 数量'); return; }
    UnlockModal.show({ accountId: account!.id, accountName: account!.name, onSuccess: (keys: UnlockedKeys) => {
      if (!keys.active) return Toast.error('缺少资金私钥。');
      BlockView.show('正在提取流动性...');
      chainServiceMgr.withdrawLiquidity({ accountId: account!.id, poolId: pool.id, shareAmount: amount, shareAssetId: pool.shareAssetId }, keys.active)
        .then(() => { setHistoryReload(v => v + 1); Toast.success('提取流动性已提交'); setWithdrawAmount(''); refreshBalances(); setTimeout(refreshBalances, 1500); setTimeout(refreshBalances, 4000); })
        .catch(e => Toast.error(formatGrapheneError(e))).finally(() => BlockView.hide());
    }});
  };

  const submitCreate = async () => {
    if (!requireAccount()) return;
    const symbols = [createAssetA.trim().toUpperCase(), createAssetB.trim().toUpperCase(), createShareAsset.trim().toUpperCase()];
    if (symbols.some(s => !s)) { Toast.warning('请输入资产 A、资产 B 和 LP 资产'); return; }
    try {
      const assets = await chainServiceMgr.lookupAssetSymbols(symbols);
      // Graphene 的 lookup_asset_symbols 对不存在的符号会返回 null，占位结果不能直接读取 symbol。
      const validAssets = (assets || []).filter((asset): asset is NonNullable<typeof asset> => !!asset && !!asset.symbol);
      const bySymbol = new Map(validAssets.map(a => [a.symbol.toUpperCase(), a]));
      const a = bySymbol.get(symbols[0]); const b = bySymbol.get(symbols[1]); const share = bySymbol.get(symbols[2]);
      if (!a || !b || !share) { Toast.warning('资产符号不存在，请先确认链上资产'); return; }
      if (a.id === b.id || a.id === share.id || b.id === share.id) { Toast.warning('交易资产和 LP 资产不能重复'); return; }
      const first = objectIdNumber(a.id) < objectIdNumber(b.id) ? a : b; const second = objectIdNumber(a.id) < objectIdNumber(b.id) ? b : a;
      UnlockModal.show({ accountId: account!.id, accountName: account!.name, onSuccess: (keys: UnlockedKeys) => {
        if (!keys.active) return Toast.error('缺少资金私钥。');
        BlockView.show('正在创建流动性池...');
        chainServiceMgr.createLiquidityPool({ accountId: account!.id, assetAId: first.id, assetBId: second.id, shareAssetId: share.id, takerFeePercent: Math.round(Number(createFee || 0) * 100), withdrawalFeePercent: Math.round(Number(createWithdrawalFee || 0) * 100) }, keys.active)
          .then(() => { Toast.success('流动性池创建已提交'); setPage('list'); setTab('pools'); loadPools(true); })
          .catch(e => Toast.error(formatGrapheneError(e))).finally(() => BlockView.hide());
      }});
    } catch (e) { Toast.error(formatGrapheneError(e)); }
  };

  const togglePoolFavorite = (poolId: string) => {
    const current = localCacheManager.loadPoolFavorites();
    const next = current.includes(poolId) ? current.filter(id => id !== poolId) : [...current, poolId];
    if (localCacheManager.savePoolFavorites(next)) {
      setFavoritePoolIds(next);
    } else {
      Toast.error('保存自选失败，请重试');
    }
  };
  const searchKeyword = search.trim().toUpperCase();
  const searchingPools = searchOpen && searchKeyword.length > 0;
  const poolSearchResults = useMemo(() => {
    const visiblePools = tab === 'favorites' ? pools.filter(item => favoritePoolIds.includes(item.id)) : pools;
    if (!searchingPools) return visiblePools;
    return visiblePools.filter(item => [item.assetA, item.assetB, `${item.assetA}/${item.assetB}`, `${item.assetA} / ${item.assetB}`, item.shareAsset, item.id]
      .some(value => value.toUpperCase().includes(searchKeyword)));
  }, [pools, tab, favoritePoolIds, searchKeyword, searchingPools]);

  const renderPool = ({ item }: { item: Pool }) => {
    const isFavorite = favoritePoolIds.includes(item.id);
    const totalValue = getPoolTotalValue(item);
    const price = getPoolPrice(item);
    const change = item.change24h;
    const changeText = change === null ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    return (
      <TouchableOpacity style={styles.poolRow} onPress={() => openPool(item)}>
        <View style={styles.poolHeader}>
          <View style={styles.poolName}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.poolPair}>{item.assetA} / {item.assetB}</Text>
            <Text style={styles.fee}>{item.fee.toFixed(2)}%</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isFavorite ? '取消自选流动性池' : '收藏流动性池'}
              accessibilityState={{ selected: isFavorite }}
              style={styles.poolFavoriteButton}
              hitSlop={6}
              onPress={event => { event.stopPropagation(); togglePoolFavorite(item.id); }}>
              <Icon name={isFavorite ? 'star' : 'star-outline'} size={22} color={isFavorite ? '#ffd166' : '#718096'} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.zeroText, change === null ? styles.changeUnavailable : change >= 0 ? styles.changePositive : styles.changeNegative]}>{changeText}</Text>
        </View>
        <View style={styles.poolBody}>
          <View style={styles.poolMain}>
            <Text style={styles.metricLabel}>总流动性</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.metricValue}>
              {displayAmount(totalValue.amount)} <Text style={styles.metricUnit}>{totalValue.symbol}</Text>
            </Text>
          </View>
          <View style={styles.poolRight}>
            <Text style={styles.priceLabel}>池价</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.poolPrice}>{price > 0 ? price.toFixed(6) : '--'}</Text>
          </View>
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.metricSecondary}>
          24h 交易量 <Text style={styles.metricSecondaryValue}>{item.volume24h === null ? '--' : item.volume24h.toLocaleString(undefined, { maximumFractionDigits: 6 })} {item.volume24h === null ? '' : item.assetA}</Text>
        </Text>
      </TouchableOpacity>
    );
  };

  const listPage = <>
    <View style={styles.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="返回" onPress={() => navigation.goBack()} style={styles.headerButton}>
        <Icon name="arrow-left" size={30} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.title}>{tab === 'pools' ? '流动性池' : '自选'}</Text>
      {tab === 'pools' ? (
        <View style={styles.headerActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="搜索流动性池" onPress={() => { setSearchOpen(v => !v); setSearch(''); }} style={styles.headerButton}>
            <Icon name="magnify" size={30} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="创建流动性池" onPress={() => setPage('create')} style={styles.headerButton}>
            <Icon name="plus" size={34} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : <TouchableOpacity accessibilityRole="button" accessibilityLabel="搜索自选流动性池" onPress={() => { setSearchOpen(v => !v); setSearch(''); }} style={styles.headerButton}>
        <Icon name="magnify" size={30} color="#fff" />
      </TouchableOpacity>}
    </View>
    {searchOpen && <View style={styles.search}>
      <TextInput value={search} onChangeText={setSearch} autoFocus placeholder={tab === 'pools' ? '搜索 DFS 流动性池' : '搜索自选流动性池'} placeholderTextColor="#7890af" style={styles.searchInput} />
    </View>}
    <View style={styles.tabs}>
      <TouchableOpacity style={[styles.tab, tab === 'favorites' && styles.active]} onPress={() => setTab('favorites')}><Text style={styles.tabText}>自选</Text></TouchableOpacity>
      <TouchableOpacity style={[styles.tab, tab === 'pools' && styles.active]} onPress={() => setTab('pools')}><Text style={styles.tabText}>流动性池</Text></TouchableOpacity>
    </View>
    {loading ? <ActivityIndicator color="#ff4652" style={styles.loading} /> : <FlatList
      data={poolSearchResults}
      extraData={favoritePoolIds}
      renderItem={renderPool}
      keyExtractor={i => i.id}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadPools(true)} tintColor="#ff4652" />}
      contentContainerStyle={styles.content}
      ListHeaderComponent={searchingPools ? <Text style={styles.metric}>搜索结果 · 输入资产名或交易对</Text> : null}
      ListEmptyComponent={<Text style={styles.empty}>{searchingPools ? '没有匹配的流动性池' : tab === 'favorites' ? '暂无自选流动性池，点击池子旁的星标添加' : '没有可用的流动性池'}</Text>}
    />}
  </>;

  const detailHeader = (title: string) => <View style={styles.detailHeader}><TouchableOpacity onPress={() => setPage('list')}><Icon name="arrow-left" size={34} color="#fff" /></TouchableOpacity><Text style={styles.detailTitle}>{title}</Text><View style={{ width: 34 }} /></View>;
  const detailTabs = <View style={styles.detailTabs}><TouchableOpacity style={[styles.detailTab, page === 'swap' && styles.active]} onPress={() => setPage('swap')}><Text style={styles.tabText}>闪兑</Text></TouchableOpacity><TouchableOpacity style={[styles.detailTab, page === 'liquidity' && styles.active]} onPress={() => setPage('liquidity')}><Text style={styles.tabText}>流动性池</Text></TouchableOpacity><TouchableOpacity style={[styles.detailTab, page === 'history' && styles.active]} onPress={() => setPage('history')}><Text style={styles.tabText}>历史记录</Text></TouchableOpacity></View>;

  const lpBalance = pool ? (balances[pool.shareAssetId] || 0) / 10 ** pool.precisionShare : 0;
  const activeQuote = pool ? getPoolQuote(pool) : null;
  const activePrice = pool ? getPoolPrice(pool) : 0;
  const activeTotal = pool ? getPoolTotalValue(pool) : null;

  const swapPage = pool ? (
    <ScrollView contentContainerStyle={styles.detailContent}>
      {detailHeader(`${pool.assetA} / ${pool.assetB}`)}
      {detailTabs}
      <View style={styles.poolHero}>
        <View>
          <Text style={styles.heroEyebrow}>当前池价</Text>
          <Text style={styles.heroPrice}>{activePrice > 0 ? activePrice.toFixed(6) : '--'}</Text>
          <Text style={styles.heroUnit}>{activeQuote?.quoteSymbol} / {activeQuote?.baseSymbol}</Text>
        </View>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeLabel}>兑换费率</Text>
          <Text style={styles.heroBadgeValue}>{pool.fee.toFixed(2)}%</Text>
        </View>
      </View>
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>兑换资产</Text>
        <Text style={styles.formLabel}>支出 <Text style={styles.available}>可用 {available(sellSide === 'a' ? pool.assetAId : pool.assetBId, sellSide === 'a' ? pool.precisionA : pool.precisionB)} {sellSide === 'a' ? pool.assetA : pool.assetB}</Text></Text>
        <View style={styles.inputLine}>
          <TextInput value={sellAmount} onChangeText={setSellAmount} keyboardType="decimal-pad" placeholder="请输入数量" placeholderTextColor="#63718a" style={styles.amountInput} />
          <View style={styles.unitActions}><Text style={styles.unit}>{sellSide === 'a' ? pool.assetA : pool.assetB}</Text><TouchableOpacity onPress={() => fillBalance(sellSide === 'a' ? pool.assetAId : pool.assetBId, sellSide === 'a' ? pool.precisionA : pool.precisionB, setSellAmount)}><Text style={styles.link}>全部</Text></TouchableOpacity></View>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="切换兑换方向" style={styles.switch} onPress={() => { setSellSide(v => v === 'a' ? 'b' : 'a'); setSellAmount(''); }}>
          <View style={styles.switchCircle}><Icon name="swap-vertical" size={22} color="#fff" /></View>
        </TouchableOpacity>
        <Text style={styles.formLabel}>获得（预估）</Text>
        <View style={styles.inputLine}>
          <TextInput value={minReceive} onChangeText={setMinReceive} keyboardType="decimal-pad" placeholder="输入数量后自动估算" placeholderTextColor="#63718a" style={styles.amountInput} />
          <Text style={styles.unit}>{sellSide === 'a' ? pool.assetB : pool.assetA}</Text>
        </View>
        <View style={styles.statsCard}>
          <View style={styles.statRow}><Text style={styles.statLabel}>池子储备</Text><Text style={styles.statValue}>{displayAmount(pool.balanceA)} {pool.assetA} / {displayAmount(pool.balanceB)} {pool.assetB}</Text></View>
          <View style={styles.statRow}><Text style={styles.statLabel}>兑换费率</Text><Text style={styles.statValue}>{pool.fee.toFixed(2)}%</Text>{helpButton('兑换手续费由当前链上流动性池配置。')}</View>
        </View>
        <TouchableOpacity style={styles.orange} onPress={submitSwap}><Text style={styles.orangeText}>兑换 {sellSide === 'a' ? pool.assetA : pool.assetB} 为 {sellSide === 'a' ? pool.assetB : pool.assetA}</Text></TouchableOpacity>
      </View>
      <View style={styles.tip}><Text style={styles.tipTitle}>交易提示</Text><Text style={styles.tipText}>兑换数量和最小获得数量会按链上池子储备计算，提交前请确认滑点。</Text></View>
    </ScrollView>
  ) : null;

  const liquidityPage = pool ? (
    <ScrollView contentContainerStyle={styles.detailContent}>
      {detailHeader(`${pool.assetA} / ${pool.assetB}`)}
      {detailTabs}
      <View style={styles.poolHero}>
        <View><Text style={styles.heroEyebrow}>我的流动性</Text><Text style={styles.heroPrice}>{lpBalance > 0 ? displayAmount(lpBalance) : '0'}</Text><Text style={styles.heroUnit}>{pool.shareAsset}</Text></View>
        <View style={styles.heroBadge}><Text style={styles.heroBadgeLabel}>总流动性</Text><Text style={styles.heroBadgeValue}>{activeTotal ? `${displayAmount(activeTotal.amount)} ${activeTotal.symbol}` : '--'}</Text></View>
      </View>
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>管理流动性</Text>
        <TouchableOpacity style={styles.orange} onPress={() => setPage('add')}><Icon name="plus" size={20} color="#fff" /><Text style={styles.orangeText}>增加流动性</Text></TouchableOpacity>
        <TouchableOpacity style={styles.outlineButton} onPress={() => setPage('withdraw')}><Icon name="arrow-up-bold" size={19} color="#ff8b83" /><Text style={styles.outlineText}>提取流动性</Text></TouchableOpacity>
      </View>
      <View style={styles.tip}><Text style={styles.tipTitle}>收益说明</Text><Text style={styles.tipText}>提供两种资产后可分享该池子的兑换手续费收益，LP 份额会随池子资产变化。</Text></View>
    </ScrollView>
  ) : null;
  const toggleHistory = (id: string) => setExpandedHistoryIds(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const renderHistoryEntry = (entry: LiquidityHistoryEntry) => {
    const expanded = expandedHistoryIds.has(entry.id);
    const fieldValue = (...labels: string[]) => entry.fields.find(field => labels.includes(field.label))?.value || '链上未提供';
    const accountField = entry.fields.find(field => field.label === '操作账户');
    const account = accountField?.value?.replace(/\s+\([^)]*\)$/, '') || '—';
    const summaryRows = [{ label: '账号', value: account, strong: false }];
    if (entry.title === '闪兑') {
      summaryRows.push({ label: '支出', value: fieldValue('实际支出'), strong: true }, { label: '获得', value: fieldValue('实际获得'), strong: true });
    } else if (entry.title === '增加流动性') {
      summaryRows.push({ label: '注入', value: fieldValue('实际注入', '提交数量'), strong: true }, { label: '获得', value: fieldValue('获得 LP'), strong: true });
    } else if (entry.title === '提取流动性') {
      summaryRows.push({ label: '销毁', value: fieldValue('销毁 LP'), strong: true }, { label: '取回', value: fieldValue('实际取回'), strong: true });
    } else {
      summaryRows.push({ label: '内容', value: entry.summary, strong: false });
    }
    const renderSummaryValue = (row: { label: string; value: string; strong: boolean }) => {
      if (row.label === '账号') return <Text style={[styles.historySummaryValue, styles.historyAccountValue]}>{row.value}</Text>;
      const matcher = /(\d[\d,]*(?:\.\d+)?)(\s*)([A-Za-z][A-Za-z0-9-]*)/g;
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(row.value))) {
        if (match.index > cursor) parts.push(<Text key={`text-${cursor}`}>{row.value.slice(cursor, match.index)}</Text>);
        parts.push(<Text key={`number-${match.index}`} style={styles.historySummaryNumber}>{match[1]}</Text>);
        if (match[2]) parts.push(<Text key={`space-${match.index}`}>{match[2]}</Text>);
        parts.push(<Text key={`asset-${match.index}`} style={styles.historySummaryAsset}>{match[3]}</Text>);
        cursor = match.index + match[0].length;
      }
      if (!parts.length) return <Text style={[styles.historySummaryValue, row.strong && styles.historySummaryValueStrong]}>{row.value}</Text>;
      if (cursor < row.value.length) parts.push(<Text key="tail">{row.value.slice(cursor)}</Text>);
      return <Text style={[styles.historySummaryValue, row.strong && styles.historySummaryValueStrong]}>{parts}</Text>;
    };
    const typeColor = entry.title === '增加流动性' ? '#18d6a0' : entry.title === '闪兑' ? '#69a8ff' : '#f0f0f0';
    return <View key={entry.id} style={styles.history}>
      <View style={styles.historyHeader}>
        <View style={styles.historyDateBlock}><Text style={styles.historyDate}>{entry.time.length >= 19 ? entry.time.slice(5, 19) : entry.time}</Text>{entry.time.length > 19 && <Text style={styles.historyTimezone}>{entry.time.slice(20)}</Text>}</View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={expanded ? '收起链上详情' : '展开链上详情'} style={styles.historyAction} onPress={() => toggleHistory(entry.id)}>
          <Text style={[styles.historyTitle, { color: typeColor }]}>{entry.title}</Text>
          <Icon name={expanded ? 'menu-up' : 'menu-down'} size={19} color={typeColor} />
        </TouchableOpacity>
      </View>
      <View style={styles.historySummaryRows}>
        {summaryRows.map(row => <View key={row.label} style={styles.historySummaryRow}><Text style={styles.historySummaryLabel}>{row.label}：</Text>{renderSummaryValue(row)}</View>)}
      </View>
      {expanded && <View style={styles.historyDetails}><Text style={styles.historyStatus}>已上链 · 链上明细</Text>{entry.fields.map((field, index) => <View key={entry.id + '-' + field.label + '-' + index} style={styles.historyField}><Text style={styles.historyLabel}>{field.label}</Text><Text style={[styles.historyValue, field.highlight && styles.historyHighlight]}>{field.value}</Text></View>)}</View>}
    </View>;
  };
  const historyPage = <ScrollView contentContainerStyle={styles.detailContent} refreshControl={<RefreshControl refreshing={historyLoading} onRefresh={() => setHistoryReload(v => v + 1)} tintColor="#ff5b52" />}>{detailHeader(pool ? `${pool.assetA} / ${pool.assetB}` : '历史记录')}{detailTabs}{historyLoading && !history.length ? <ActivityIndicator color="#ff5b52" style={styles.loading} /> : historyError ? <View style={styles.historyState}><Text style={styles.noLiquidity}>历史记录加载失败</Text><TouchableOpacity style={styles.outlineButton} onPress={() => setHistoryReload(v => v + 1)}><Text style={styles.outlineText}>重新加载</Text></TouchableOpacity></View> : history.length ? history.map(renderHistoryEntry) : <Text style={styles.noLiquidity}>没有历史记录</Text>}</ScrollView>;
  const addPage = pool ? (
    <ScrollView contentContainerStyle={styles.detailContent}>
      {detailHeader('增加流动性')}
      <View style={styles.poolHeroCompact}><Text style={styles.heroEyebrow}>注入交易对</Text><Text style={styles.heroPair}>{pool.assetA} / {pool.assetB}</Text><Text style={styles.heroUnit}>按当前池子比例添加资产</Text></View>
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>资产配置</Text>
        <Text style={styles.formLabel}>资产 A <Text style={styles.available}>可用 {available(pool.assetAId, pool.precisionA)} {pool.assetA}</Text></Text>
        <View style={styles.inputLine}><TextInput value={depositA} onChangeText={setDepositA} keyboardType="decimal-pad" placeholder="请输入数量" placeholderTextColor="#63718a" style={styles.amountInput} /><View style={styles.unitActions}><Text style={styles.unit}>{pool.assetA}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={`使用全部${pool.assetA}`} onPress={() => fillBalance(pool.assetAId, pool.precisionA, setDepositA)}><Text style={styles.link}>全部</Text></TouchableOpacity></View></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="查看注入说明" style={styles.plus} onPress={() => Toast.info('按池子比例注入两种资产，可分享手续费收益。', 3500)}><Icon name="information-outline" size={19} color="#78a8f0" /><Text style={styles.plusText}>按池子比例注入两种资产</Text></TouchableOpacity>
        <Text style={styles.formLabel}>资产 B <Text style={styles.available}>可用 {available(pool.assetBId, pool.precisionB)} {pool.assetB}</Text></Text>
        <View style={styles.inputLine}><TextInput value={depositB} onChangeText={setDepositB} keyboardType="decimal-pad" placeholder="请输入数量" placeholderTextColor="#63718a" style={styles.amountInput} /><View style={styles.unitActions}><Text style={styles.unit}>{pool.assetB}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={`使用全部${pool.assetB}`} onPress={() => fillBalance(pool.assetBId, pool.precisionB, setDepositB)}><Text style={styles.link}>全部</Text></TouchableOpacity></View></View>
        <View style={styles.statsCard}><View style={styles.statRow}><Text style={styles.statLabel}>当前池价</Text><Text style={styles.statValue}>{activePrice > 0 ? activePrice.toFixed(6) : '--'}</Text></View><View style={styles.statRow}><Text style={styles.statLabel}>预计获得</Text><Text style={[styles.statValue, styles.green]}>-- {pool.shareAsset}</Text>{helpButton('预计获得的 LP 份额会按两种资产数量和池子储备计算。')}</View></View>
        <TouchableOpacity style={styles.orange} onPress={submitDeposit}><Icon name="plus" size={20} color="#fff" /><Text style={styles.orangeText}>确认增加</Text></TouchableOpacity>
      </View>
      <View style={styles.tip}><Text style={styles.tipTitle}>添加规则</Text><Text style={styles.tipText}>两种资产需要按当前池子比例注入，提交前请确认数量和余额。</Text></View>
    </ScrollView>
  ) : null;

  const withdrawPage = pool ? (
    <ScrollView contentContainerStyle={styles.detailContent}>
      {detailHeader('提取流动性')}
      <View style={styles.poolHeroCompact}><Text style={styles.heroEyebrow}>可提取份额</Text><Text style={styles.heroPrice}>{lpBalance > 0 ? displayAmount(lpBalance) : '0'}</Text><Text style={styles.heroUnit}>{pool.shareAsset}</Text></View>
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>提取 LP 份额</Text>
        <Text style={styles.formLabel}>提取数量 <Text style={styles.available}>可用 {available(pool.shareAssetId, pool.precisionShare)} {pool.shareAsset}</Text></Text>
        <View style={styles.inputLine}><TextInput value={withdrawAmount} onChangeText={setWithdrawAmount} keyboardType="decimal-pad" placeholder="请输入 LP 数量" placeholderTextColor="#63718a" style={styles.amountInput} /><View style={styles.unitActions}><Text style={styles.unit}>{pool.shareAsset}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="使用全部 LP 份额" onPress={() => fillBalance(pool.shareAssetId, pool.precisionShare, setWithdrawAmount)}><Text style={styles.link}>全部</Text></TouchableOpacity></View></View>
        <View style={styles.statsCard}><View style={styles.statRow}><Text style={styles.statLabel}>资产 A</Text><Text style={styles.statValue}>{pool.assetA}</Text></View><View style={styles.statRow}><Text style={styles.statLabel}>资产 B</Text><Text style={styles.statValue}>{pool.assetB}</Text></View><View style={styles.statRow}><Text style={styles.statLabel}>提取费</Text><Text style={styles.statValue}>{pool.withdrawalFee.toFixed(2)}%</Text></View></View>
        <TouchableOpacity style={styles.orange} onPress={submitWithdraw}><Icon name="arrow-up-bold" size={19} color="#fff" /><Text style={styles.orangeText}>确认提取</Text></TouchableOpacity>
      </View>
    </ScrollView>
  ) : null;

  const createPage = (
    <ScrollView contentContainerStyle={styles.detailContent}>
      {detailHeader('创建流动性池')}
      <View style={styles.poolHeroCompact}><Text style={styles.heroEyebrow}>创建新的交易池</Text><Text style={styles.heroPair}>{createAssetA || '资产 A'} / {createAssetB || '资产 B'}</Text><Text style={styles.heroUnit}>配置资产和手续费后提交上链</Text></View>
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>池子配置</Text>
        <Text style={styles.formLabel}>资产 A</Text><View style={styles.inputLine}><TextInput value={createAssetA} onChangeText={setCreateAssetA} autoCapitalize="characters" placeholder="例如 DFS" placeholderTextColor="#63718a" style={styles.amountInput} /></View>
        <Text style={styles.formLabel}>资产 B</Text><View style={styles.inputLine}><TextInput value={createAssetB} onChangeText={setCreateAssetB} autoCapitalize="characters" placeholder="例如 CNY" placeholderTextColor="#63718a" style={styles.amountInput} /></View>
        <Text style={styles.formLabel}>LP 资产</Text><View style={styles.inputLine}><TextInput value={createShareAsset} onChangeText={setCreateShareAsset} autoCapitalize="characters" placeholder="例如 DFS-CNY-LP" placeholderTextColor="#63718a" style={styles.amountInput} /></View>
        <View style={styles.formColumns}><View style={styles.formColumn}><Text style={styles.formLabel}>兑换费率 (%)</Text><View style={styles.inputLine}><TextInput value={createFee} onChangeText={setCreateFee} keyboardType="decimal-pad" style={styles.amountInput} /></View></View><View style={styles.formColumn}><Text style={styles.formLabel}>提取费率 (%)</Text><View style={styles.inputLine}><TextInput value={createWithdrawalFee} onChangeText={setCreateWithdrawalFee} keyboardType="decimal-pad" style={styles.amountInput} /></View></View></View>
        <TouchableOpacity style={styles.orange} onPress={submitCreate}><Icon name="check" size={20} color="#fff" /><Text style={styles.orangeText}>创建并上链</Text></TouchableOpacity>
      </View>
      <View style={styles.tip}><Text style={styles.tipTitle}>创建规则</Text><Text style={styles.tipText}>三个资产必须是链上已存在且互不相同的资产，核心协议会按资产 ID 自动排序。</Text></View>
    </ScrollView>
  );
  return <SafeAreaView style={styles.container}><StatusBar barStyle="light-content" backgroundColor="#0b0b0b" />{page === 'list' ? listPage : page === 'swap' ? swapPage : page === 'liquidity' ? liquidityPage : page === 'history' ? historyPage : page === 'add' ? addPage : page === 'withdraw' ? withdrawPage : createPage}</SafeAreaView>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080a0f' },
  header: { height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: '#080a0f' },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#f5f7fb', fontSize: 24, fontWeight: '800', letterSpacing: 0.2 },
  search: { height: 44, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: '#263348', backgroundColor: '#131823', flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1, color: '#f5f7fb', marginLeft: 8, fontSize: 15 },
  tabs: { flexDirection: 'row', height: 48, marginHorizontal: 16, marginBottom: 4, padding: 4, borderRadius: 14, borderWidth: 1, borderColor: '#202b3b', backgroundColor: '#11151d' },
  tab: { flex: 1, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  active: { backgroundColor: '#ff5b52' },
  tabText: { color: '#eef2f7', fontSize: 15, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28 },
  loading: { marginTop: 70 },
  empty: { color: '#8290a5', textAlign: 'center', marginTop: 120, fontSize: 16, lineHeight: 23 },
  poolRow: { paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: '#253044', backgroundColor: '#151a23', elevation: 3 },
  poolHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 },
  poolName: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  poolFavoriteButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  poolPair: { flexShrink: 1, color: '#f7f9fc', fontSize: 16, fontWeight: '800' },
  fee: { color: '#a9c9ff', backgroundColor: '#233a65', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, fontSize: 10, fontWeight: '700' },
  zeroText: { color: '#63d7b4', backgroundColor: '#12352f', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '800' },
  changePositive: { color: '#63d7b4' },
  changeNegative: { color: '#ff7a78', backgroundColor: '#3a1d26' },
  changeUnavailable: { color: '#9aa6b8', backgroundColor: '#252b35' },
  poolBody: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 7, borderTopWidth: 1, borderTopColor: '#222d3d' },
  poolMain: { flex: 1, minWidth: 0, paddingRight: 8 },
  metric: { color: '#8fa5c3', fontSize: 13, marginBottom: 8 },
  metricLabel: { color: '#8492a8', fontSize: 11, fontWeight: '600' },
  metricValue: { color: '#f7f9fc', fontSize: 18, lineHeight: 23, fontWeight: '800', marginTop: 2 },
  metricUnit: { color: '#78a8f0', fontSize: 11, fontWeight: '700' },
  metricSecondary: { color: '#8492a8', fontSize: 11, lineHeight: 16, marginTop: 5 },
  metricSecondaryValue: { color: '#a9bad2', fontWeight: '700' },
  poolRight: { width: '34%', alignItems: 'flex-end', justifyContent: 'flex-start' },
  priceLabel: { color: '#8492a8', fontSize: 11, marginBottom: 2 },
  poolPrice: { color: '#f7f9fc', fontSize: 18, lineHeight: 23, fontWeight: '800' },
  detailContent: { paddingHorizontal: 16, paddingBottom: 30 },
  detailHeader: { height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailTitle: { color: '#f5f7fb', fontSize: 23, fontWeight: '800' },
  detailTabs: { height: 48, flexDirection: 'row', marginBottom: 16, padding: 4, borderRadius: 14, borderWidth: 1, borderColor: '#202b3b', backgroundColor: '#11151d' },
  detailTab: { flex: 1, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  poolHero: { minHeight: 128, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, marginBottom: 14, borderRadius: 20, borderWidth: 1, borderColor: '#2b4162', backgroundColor: '#162238' },
  poolHeroCompact: { padding: 20, marginBottom: 14, borderRadius: 20, borderWidth: 1, borderColor: '#293a53', backgroundColor: '#141d2b' },
  heroEyebrow: { color: '#8ca4c4', fontSize: 13, fontWeight: '600', letterSpacing: 0.4 },
  heroPrice: { color: '#f7f9fc', fontSize: 31, lineHeight: 38, fontWeight: '900', marginTop: 4 },
  heroPair: { color: '#f7f9fc', fontSize: 25, fontWeight: '900', marginTop: 5 },
  heroUnit: { color: '#7f9bc2', fontSize: 13, marginTop: 3 },
  heroBadge: { maxWidth: 150, alignItems: 'flex-end', paddingLeft: 12 },
  heroBadgeLabel: { color: '#8ca4c4', fontSize: 12 },
  heroBadgeValue: { color: '#6de0bd', fontSize: 18, fontWeight: '800', marginTop: 5, textAlign: 'right' },
  formCard: { padding: 18, marginBottom: 14, borderRadius: 20, borderWidth: 1, borderColor: '#273449', backgroundColor: '#151a23' },
  sectionTitle: { color: '#f5f7fb', fontSize: 19, fontWeight: '800', marginBottom: 3 },
  formLabel: { color: '#d6deea', fontSize: 14, fontWeight: '700', marginTop: 16 },
  available: { color: '#7ea9eb', fontSize: 12, fontWeight: '500' },
  inputLine: { minHeight: 60, marginTop: 8, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: '#2b3b54', backgroundColor: '#0e131b', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amountInput: { flex: 1, color: '#f7f9fc', fontSize: 22, padding: 0 },
  unitActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  unit: { color: '#f1f5fa', fontSize: 16, fontWeight: '700' },
  link: { color: '#76a9ef', fontSize: 13, fontWeight: '800' },
  switch: { height: 52, alignItems: 'center', justifyContent: 'center' },
  switchCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#355b91', borderWidth: 3, borderColor: '#151a23' },
  statsCard: { marginTop: 18, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: '#26354a', backgroundColor: '#10151d' },
  statRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel: { color: '#8797ae', fontSize: 13, flexShrink: 0 },
  statValue: { color: '#dfe8f4', fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  helpButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  orange: { minHeight: 52, marginTop: 18, borderRadius: 14, backgroundColor: '#f05b52', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  orangeText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  outlineButton: { minHeight: 50, marginTop: 11, borderWidth: 1, borderColor: '#e06a68', borderRadius: 14, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#21191d' },
  outlineText: { color: '#ff9a91', fontSize: 16, fontWeight: '800' },
  green: { color: '#6de0bd' },
  tip: { padding: 16, marginBottom: 14, borderRadius: 17, borderWidth: 1, borderColor: '#263b4c', backgroundColor: '#101a22' },
  tipTitle: { color: '#c8d9ec', fontSize: 15, fontWeight: '800', marginBottom: 6 },
  tipText: { color: '#91a4ba', fontSize: 13, lineHeight: 21 },
  myLiquidity: { color: '#e9f0f8', fontSize: 19, fontWeight: '800', marginTop: 8 },
  liquidityBalance: { padding: 16, marginTop: 12, borderRadius: 15, borderWidth: 1, borderColor: '#2b4658', backgroundColor: '#12231f', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liquidityBalanceLabel: { color: '#8da5a3', fontSize: 14 },
  liquidityBalanceValue: { color: '#6de0bd', fontSize: 18, fontWeight: '800' },
  noLiquidity: { color: '#7890ad', fontSize: 16, textAlign: 'center', marginTop: 28 },
  plus: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  plusText: { color: '#78a8f0', fontSize: 13, fontWeight: '700' },
  formColumns: { flexDirection: 'row', gap: 10 },
  formColumn: { flex: 1 },
  history: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 16, marginBottom: 12, borderRadius: 18, borderWidth: 1, borderColor: '#273449', backgroundColor: '#151a23' },
  historyHeader: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyDateBlock: { flex: 1 },
  historyDate: { color: '#a8b7ca', fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  historyTimezone: { color: '#617189', fontSize: 10, marginTop: 2 },
  historyTitle: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  historyAction: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2, paddingLeft: 8 },
  historySummaryRows: { marginTop: 14, gap: 8 },
  historySummaryRow: { flexDirection: 'row', alignItems: 'flex-start' },
  historySummaryLabel: { color: '#8a9ab0', fontSize: 13, lineHeight: 21, width: 58 },
  historySummaryValue: { color: '#e4ebf4', fontSize: 13, lineHeight: 21, flex: 1 },
  historySummaryValueStrong: { color: '#fff', fontWeight: '800' },
  historyAccountValue: { color: '#75aaf0', fontWeight: '700' },
  historySummaryNumber: { color: '#fff', fontWeight: '800' },
  historySummaryAsset: { color: '#6de0bd', fontWeight: '800' },
  historyDetails: { marginTop: 14, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#29374b' },
  historyStatus: { color: '#79a8e8', fontSize: 12, marginTop: 2, marginBottom: 8, fontWeight: '700' },
  historyField: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#202c3d', paddingTop: 9, marginTop: 9, gap: 10 },
  historyLabel: { color: '#8899af', fontSize: 12, flexShrink: 0 },
  historyValue: { color: '#d7e0ec', fontSize: 12, lineHeight: 17, flex: 1, textAlign: 'right' },
  historyHighlight: { color: '#6de0bd', fontWeight: '800' },
  historyState: { paddingTop: 35 },
});

export default FlashSwapScreen;
