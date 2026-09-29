import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  KeyboardAvoidingView,
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
import { useNavigation } from '@react-navigation/native';
import { PrivateKey } from 'bitsharesjs';
import { ChainConfig } from 'bitsharesjs-ws';
import { useAccountStore } from '../store/useAccountStore';
import { chainServiceMgr } from '../services/chainservice_mgr';
import {
  buildBSCWithdrawalMemo,
  decimalToAtomic,
  DFS_WITHDRAWAL_ACCOUNT,
  DFS_WITHDRAWAL_ASSET_ID,
  DFS_WITHDRAWAL_ASSET_PRECISION,
  DFS_WITHDRAWAL_ASSET_SYMBOL,
  gatewayApi,
  type BSCBridgeConfig,
  type BSCWithdrawalResult,
} from '../services/gateway_api';
import { Toast } from '../components/Toast';
import { UnlockModal, type UnlockedKeys } from '../components/UnlockModal';
import { useBalanceStore } from '../store/useBalanceStore';
import { backgroundService } from '../services/background_service';
import { withdrawalGuard } from '../services/withdrawal_guard';

const formatAmount = (
  value: number,
  precision = DFS_WITHDRAWAL_ASSET_PRECISION,
) => {
  if (!Number.isFinite(value) || value <= 0) return '0.00';
  const fixed = value.toFixed(Math.min(precision, 8));
  return fixed.includes('.')
    ? fixed.replace(/0+$/, '').replace(/\.$/, '')
    : fixed;
};

const getBridgeFee = (
  config: BSCBridgeConfig | null,
): { amount: number; asset: string } | null => {
  if (!config) return null;
  const rawFee = config.withdrawal_fee;
  const feeText =
    typeof rawFee === 'string' ? rawFee.trim() : String(rawFee ?? '');
  const amount =
    typeof rawFee === 'number' ? rawFee : Number(feeText.split(/\s+/)[0]);
  if (
    rawFee === undefined ||
    rawFee === null ||
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return null;
  }
  return {
    amount,
    asset:
      config.withdrawal_fee_asset ||
      feeText.split(/\s+/)[1] ||
      config.funding_asset_symbol ||
      DFS_WITHDRAWAL_ASSET_SYMBOL,
  };
};

const getBridgeMinimum = (
  config: BSCBridgeConfig | null,
  direction: 'deposit' | 'withdrawal',
): number | null => {
  if (!config) return null;
  const raw =
    direction === 'deposit'
      ? config.deposit_min_amount
      : config.withdrawal_min_amount;
  if (raw === undefined || raw === null) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

const getBridgeTip = (config: BSCBridgeConfig | null) => {
  const value = config?.withdrawal_tips || config?.currency?.withdrawal_tips;
  return typeof value === 'string' ? value.trim() : '';
};

/** Convert technical gateway/chain errors into messages users can act on. */
const formatWithdrawalError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error || '');
  const normalized = raw.toLowerCase();
  if (
    normalized.includes('fee pool') ||
    normalized.includes('insufficient balance') ||
    raw.includes('手续费')
  ) {
    return '转账失败：链上手续费资产余额不足，请补充 DFS 后重试。';
  }
  if (normalized.includes('insufficient') || normalized.includes('余额不足')) {
    return '转账失败：USDT 可用余额不足，请减少提现金额后重试。';
  }
  if (
    normalized.includes('assert exception') ||
    normalized.includes('assertion') ||
    normalized.includes('missing required authority') ||
    normalized.includes('invalid parameter')
  ) {
    return '转账失败：链上校验未通过，请检查提现地址、余额和账户权限后重试。';
  }
  if (
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('unable to connect')
  ) {
    return '转账失败：网络暂时不可用，请稍后重试。';
  }
  if (raw.includes('提现') || raw.includes('转账')) return raw;
  return '转账失败：提现转账未完成，请稍后重试。';
};

const BSCWithdrawScreen: React.FC = () => {
  const navigation = useNavigation();
  const currentAccount = useAccountStore(state => state.currentAccount);
  const balanceItems = useBalanceStore(state => state.balanceItems);
  const balancesLoaded = useBalanceStore(state => state.isLoaded);
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BSCWithdrawalResult | null>(null);
  const [bridgeConfig, setBridgeConfig] = useState<BSCBridgeConfig | null>(
    null,
  );
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const submittingRef = useRef(false);
  const [freshBalance, setFreshBalance] = useState<{ accountId: string; atomic: bigint } | null>(null);

  const fundingAssetId = bridgeConfig?.funding_asset_id || DFS_WITHDRAWAL_ASSET_ID;
  const fundingAssetSymbol =
    bridgeConfig?.funding_asset_symbol || DFS_WITHDRAWAL_ASSET_SYMBOL;
  const fundingPrecision =
    bridgeConfig?.funding_precision || DFS_WITHDRAWAL_ASSET_PRECISION;
  const configuredFundingAccount =
    bridgeConfig?.funding_account || DFS_WITHDRAWAL_ACCOUNT;
  const token = bridgeConfig?.token || fundingAssetSymbol;
  const bridgeTip = getBridgeTip(bridgeConfig);
  const amountPattern = useMemo(
    () => new RegExp(`^\\d+(\\.\\d{1,${fundingPrecision}})?$`),
    [fundingPrecision],
  );

  const usdtBalance = useMemo(
    () =>
      balanceItems.find(item => item.assetId === fundingAssetId) ||
      balanceItems.find(item => item.symbol === fundingAssetSymbol),
    [balanceItems, fundingAssetId, fundingAssetSymbol],
  );
  const cachedAtomic = decimalToAtomic(
    Math.max(0, usdtBalance?.available || 0).toFixed(fundingPrecision),
    fundingPrecision,
  );
  const availableBalance = Number(withdrawalGuard.available(
    currentAccount?.id || '',
    freshBalance?.accountId === currentAccount?.id ? freshBalance!.atomic : cachedAtomic,
  )) / 10 ** fundingPrecision;
  const bridgeFee = getBridgeFee(bridgeConfig);
  const minimumWithdrawal = getBridgeMinimum(bridgeConfig, 'withdrawal');
  const enteredAmount = Number(amount);
  const amountExceedsBalance = useMemo(() => {
    if (
      !amountPattern.test(amount.trim()) ||
      !Number.isFinite(enteredAmount)
    ) {
      return false;
    }
    try {
      const amountAtomic = decimalToAtomic(
        amount.trim(),
        fundingPrecision,
      );
      const availableAtomic = decimalToAtomic(
        Math.max(0, availableBalance).toFixed(fundingPrecision),
        fundingPrecision,
      );
      return balancesLoaded && amountAtomic > availableAtomic;
    } catch {
      return false;
    }
  }, [amount, amountPattern, availableBalance, balancesLoaded, enteredAmount, fundingPrecision]);
  const expectedReceived =
    amountPattern.test(amount.trim()) && bridgeFee
      ? Math.max(0, enteredAmount - bridgeFee.amount)
      : null;
  const amountBelowMinimum =
    amountPattern.test(amount.trim()) &&
    minimumWithdrawal !== null &&
    enteredAmount < minimumWithdrawal;

  useEffect(() => {
    let cancelled = false;
    setConfigLoading(true);
    setBridgeConfig(null);
    setConfigError(false);
    setResult(null);
    Promise.allSettled([
      gatewayApi.getBSCConfig(),
      backgroundService.refreshAccountBalance(),
    ]).then(([configResult]) => {
      if (cancelled) return;
      if (configResult.status === 'fulfilled')
        setBridgeConfig(configResult.value);
      else setConfigError(true);
      setConfigLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentAccount?.id]);

  const submit = async (activeKeyWif?: string, unlockedMemoKey?: string) => {
    if (submittingRef.current) return;
    if (!currentAccount?.name) return Toast.error('请先登录 DFS 账户');
    if (configLoading || !bridgeConfig || configError)
      return Toast.error('正在读取 bridge 币种配置，请稍后再试');
    const normalizedAddress = address.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(normalizedAddress))
      return Toast.error('请输入正确的 BSC 地址');
    if (!amountPattern.test(amount.trim()) || Number(amount) <= 0)
      return Toast.error(`请输入 ${fundingPrecision} 位小数以内的提现金额`);
    let amountAtomic: bigint;
    try {
      amountAtomic = decimalToAtomic(
        amount.trim(),
        fundingPrecision,
      );
    } catch (error) {
      return Toast.error(
        error instanceof Error ? error.message : '提现金额格式不正确',
      );
    }
    if (amountAtomic <= 0n) return Toast.error('提现金额必须大于 0');
    if (!balancesLoaded) return Toast.error(`${token} 余额正在加载，请稍候再试`);
    if (
      minimumWithdrawal !== null &&
      Number(amount.trim()) < minimumWithdrawal
    ) {
      return Toast.error(
        `提现金额不得低于最低提现金额 ${formatAmount(
          minimumWithdrawal,
        )} ${token}`,
      );
    }
    const availableAtomic = decimalToAtomic(
      Math.max(0, availableBalance).toFixed(fundingPrecision),
      fundingPrecision,
    );
    if (amountAtomic > availableAtomic) {
      return Toast.error(
        `余额不足，当前可提余额为 ${formatAmount(
          availableBalance,
        )} ${token}`,
      );
    }

    try {
      await gatewayApi.checkBSCAddress(normalizedAddress, bridgeConfig.code);
    } catch (error) {
      return Toast.error(error instanceof Error ? error.message : '提币地址校验失败');
    }

    if (!activeKeyWif) {
      submittingRef.current = true;
      setSubmitting(true);
      return UnlockModal.show({
        accountId: currentAccount.id,
        accountName: currentAccount.name,
        onSuccess: (keys: UnlockedKeys) => {
          submittingRef.current = false;
          setSubmitting(false);
          if (useAccountStore.getState().currentAccount?.id !== currentAccount.id) return;
          if (keys.active) submit(keys.active, keys.memo).catch(() => undefined);
        },
        onCancel: () => {
          submittingRef.current = false;
          setSubmitting(false);
        },
      });
    }
    // Restore DFS after a persisted login before comparing memo keys or transferring.
    ChainConfig.setPrefix('DFS');

    if (!withdrawalGuard.begin(currentAccount.id)) {
      return Toast.error('上一笔提现仍在处理中，请稍候');
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      // Read the node directly: the background balance store may be seconds old.
      const balances = await chainServiceMgr.getAccountBalances(
        currentAccount.id, [fundingAssetId],
      );
      if (!Array.isArray(balances)) throw new Error('提现余额读取失败，请稍后重试');
      const balance = balances.find(item => item.asset_id === fundingAssetId);
      const liveAtomic = BigInt(balance?.amount ?? 0);
      const spendableAtomic = withdrawalGuard.observeFreshBalance(currentAccount.id, liveAtomic);
      setFreshBalance({ accountId: currentAccount.id, atomic: spendableAtomic });
      if (amountAtomic > spendableAtomic) {
        throw new Error(`${token} 可用余额不足，余额已更新，请重新输入提现金额`);
      }
      if (useAccountStore.getState().currentAccount?.id !== currentAccount.id) {
        throw new Error('账户已切换，请重新提交提现');
      }
      const [fromAccount, fundingAccount, asset] = await Promise.all([
        chainServiceMgr.getAccountByName(currentAccount.name),
        chainServiceMgr.getAccountByName(configuredFundingAccount),
        chainServiceMgr
          .queryAssetsBySymbols([fundingAssetSymbol], false)
          .then(assets => assets.get(fundingAssetSymbol)),
      ]);
      if (!fromAccount) throw new Error('获取发送账户信息失败');
      if (!fundingAccount) throw new Error('获取桥接收款账户信息失败');
      if (
        !asset ||
        asset.id !== fundingAssetId ||
        asset.precision !== fundingPrecision
      ) {
        throw new Error(`链上 ${token} 资产配置不一致，已停止转账`);
      }
      const fromMemoKey = fromAccount.options?.memo_key;
      const toMemoKey = fundingAccount.options?.memo_key;
      if (!toMemoKey) throw new Error('获取桥接账户备注公钥失败');

      let memoPrivateKey = activeKeyWif;
      if (unlockedMemoKey && fromMemoKey) {
        try {
          const memoKey = PrivateKey.fromWif(unlockedMemoKey);
          if (memoKey.toPublicKey().toPublicKeyString() === fromMemoKey)
            memoPrivateKey = unlockedMemoKey;
        } catch {
          // Fall back to the active key, which is valid for the account's memo
          // key on older accounts.
        }
      }
      const fundingMemo = buildBSCWithdrawalMemo(normalizedAddress);
      try {
        await chainServiceMgr.transfer(
          {
            fromAccountId: fromAccount.id,
            toAccountId: fundingAccount.id,
            assetId: asset.id,
            amount: amountAtomic.toString(),
            memo: fundingMemo,
            toMemoKey,
          },
          activeKeyWif,
          memoPrivateKey,
        );
      } catch (error) {
        throw new Error(formatWithdrawalError(error));
      }

      const response: BSCWithdrawalResult = {
        account: currentAccount.name,
        address: normalizedAddress,
        amount: amount.trim(),
        status: '待提币',
        message: 'DFS 链上转账已提交，Bridge 将自动识别并处理。',
      };
      setResult(response);
      const remainingAtomic = withdrawalGuard.transferred(currentAccount.id, spendableAtomic, amountAtomic);
      setFreshBalance({ accountId: currentAccount.id, atomic: remainingAtomic });
      setAmount('');
      // The local ceiling already prevents reuse even if this refresh is slow.
      await backgroundService.refreshAccountBalance().catch(() => undefined);
      Toast.success(`已提交 ${amount.trim()} ${fundingAssetSymbol}，请在充提查询中查看状态`);
    } catch (error) {
      Toast.error(formatWithdrawalError(error));
    } finally {
      withdrawalGuard.end(currentAccount.id);
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const paste = async () => {
    if (submittingRef.current) return;
    const value = await Clipboard.getString();
    if (value && !submittingRef.current) {
      setAddress(value.trim());
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{token} 提现</Text>
        <View style={styles.headerRight} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.accountCard}>
            <View style={styles.accountHeaderRow}>
              <View>
                <Text style={styles.label}>DFS 账户</Text>
                <Text style={styles.account}>
                  {currentAccount?.name || '未登录'}
                </Text>
              </View>
              <View style={styles.balanceBlock}>
                <Text style={styles.balanceLabel}>可提余额</Text>
                <Text style={styles.balanceValue}>
                  {balancesLoaded ? formatAmount(availableBalance) : '加载中…'}{' '}
                  <Text style={styles.balanceUnit}>{token}</Text>
                </Text>
              </View>
            </View>
            <Text style={styles.sub}>仅可提取当前账户的 {token} 可用余额</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.label}>{token} 收款地址（{bridgeConfig?.chain || 'BSC'}）</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={address}
                editable={!submitting}
                onChangeText={value => {
                  setAddress(value);
                }}
                placeholder="0x..."
                placeholderTextColor="#666666"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={paste} disabled={submitting}>
                <Text style={styles.paste}>粘贴</Text>
              </TouchableOpacity>
            </View>
            {bridgeConfig && (
              <Text style={styles.hint}>
                只支持 {bridgeConfig.chain} 网络的 {token} 地址
              </Text>
            )}
            <Text style={styles.hint}>
              提现将转入 {configuredFundingAccount}，备注格式：USDT:&lt;收款地址&gt;
            </Text>
            <Text style={[styles.label, styles.amountLabel]}>
              提现数量（{token}）
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={amount}
                editable={!submitting}
                onChangeText={value => {
                  setAmount(value);
                }}
                placeholder="0.00"
                placeholderTextColor="#666666"
                keyboardType="decimal-pad"
              />
              <View style={styles.unitActions}>
                <Text style={styles.unit}>{token}</Text>
                <TouchableOpacity
                  disabled={submitting || !balancesLoaded}
                  onPress={() => {
                    if (!balancesLoaded || submittingRef.current) return;
                    setAmount(formatAmount(availableBalance));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="使用全部可提余额"
                >
                  <Text style={styles.allButton}>全部</Text>
                </TouchableOpacity>
              </View>
            </View>
            {amountExceedsBalance && (
              <Text style={styles.errorText}>
                余额不足，最多可提 {formatAmount(availableBalance)} {token}
              </Text>
            )}
            {amountBelowMinimum && (
              <Text style={styles.errorText}>
                不得低于最低提现金额 {formatAmount(minimumWithdrawal || 0)} {token}
              </Text>
            )}
          </View>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>到账数量</Text>
              <Text style={styles.summaryValue}>
                {expectedReceived === null
                  ? '--'
                  : `${formatAmount(expectedReceived)} ${token}`}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>网络手续费</Text>
              <Text style={styles.summaryValue}>
                {configLoading
                  ? '读取 bridge 配置中…'
                  : configError
                  ? '暂时无法读取'
                  : bridgeFee
                  ? `${formatAmount(bridgeFee.amount)} ${bridgeFee.asset}`
                  : 'bridge 未返回'}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>最低提现</Text>
              <Text style={styles.summaryValue}>
                {configLoading
                  ? '读取 bridge 配置中…'
                  : configError
                  ? '暂时无法读取'
                  : minimumWithdrawal !== null
                  ? `${formatAmount(minimumWithdrawal)} ${token}`
                  : 'bridge 未返回'}
              </Text>
            </View>
            {!configLoading && configError && (
              <Text style={styles.summaryHint}>
                暂时无法读取 bridge 后台配置，请稍后刷新页面
              </Text>
            )}
            {!configLoading && !configError && !bridgeFee && (
              <Text style={styles.summaryHint}>
                手续费以 bridge 后台配置为准，当前接口未返回手续费字段
              </Text>
            )}
          </View>
          {bridgeTip ? (
            <View style={styles.notice}>
              <Icon name="shield-check-outline" size={20} color="#F0B90B" />
              <Text style={styles.noticeText}>{bridgeTip}</Text>
            </View>
          ) : null}
          <View style={styles.supportCard}>
            <Icon name="email-outline" size={20} color="#F0B90B" />
            <Text selectable style={styles.supportText}>
              {'充值提现问题，请联系邮箱：\n'}
              <Text style={styles.supportEmail}>
                bridge-team@defishares.org
              </Text>
            </Text>
          </View>
          {result && (
            <View style={styles.result}>
              <Text style={styles.resultTitle}>提现转账已提交</Text>
              <Text style={styles.resultLine}>状态：{result.status}</Text>
              <Text selectable style={styles.resultLine}>
                收款地址：{result.address}
              </Text>
              <Text style={styles.resultNote}>{result.message}</Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.submit, submitting && styles.disabled]}
            onPress={() => submit()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#0D0D0D" />
            ) : (
              <Text style={styles.submitText}>提交提现申请</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  headerRight: { width: 40 },
  content: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 40 },
  accountCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
  },
  accountHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  card: { backgroundColor: '#1A1A1A', borderRadius: 14, padding: 18 },
  label: { color: '#999999', fontSize: 13, marginBottom: 9 },
  account: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  sub: { color: '#888888', fontSize: 12, marginTop: 8 },
  balanceBlock: { alignItems: 'flex-end', marginLeft: 12 },
  balanceLabel: { color: '#999999', fontSize: 12, marginBottom: 5 },
  balanceValue: { color: '#F0B90B', fontSize: 16, fontWeight: '700' },
  balanceUnit: { color: '#F0B90B', fontSize: 12, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#343434',
    borderRadius: 8,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  input: { flex: 1, color: '#FFFFFF', fontSize: 15, paddingVertical: 11 },
  paste: { color: '#F0B90B', fontSize: 14, fontWeight: '600', paddingLeft: 10 },
  unitActions: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8 },
  unit: { color: '#FFFFFF', fontSize: 14 },
  allButton: {
    color: '#F0B90B',
    fontSize: 13,
    fontWeight: '700',
    paddingLeft: 12,
  },
  hint: { color: '#777777', fontSize: 12, marginTop: 8 },
  amountLabel: { marginTop: 20 },
  errorText: { color: '#FF6673', fontSize: 12, marginTop: 8 },
  summaryCard: {
    backgroundColor: '#171B23',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#252B36',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  summaryLabel: { color: '#A7ADB8', fontSize: 13 },
  summaryValue: { color: '#E9EDF3', fontSize: 13, fontWeight: '600' },
  summaryHint: { color: '#7B8491', fontSize: 11, lineHeight: 16, marginTop: 5 },
  notice: {
    flexDirection: 'row',
    backgroundColor: 'rgba(240,185,11,0.10)',
    borderColor: 'rgba(240,185,11,0.28)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 13,
    marginTop: 14,
  },
  noticeText: {
    flex: 1,
    color: '#B7B7B7',
    fontSize: 12,
    lineHeight: 18,
    marginLeft: 10,
  },
  supportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#171B23',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#252B36',
    padding: 14,
    marginTop: 14,
  },
  supportText: { flex: 1, color: '#B7B7B7', fontSize: 12, lineHeight: 18, marginLeft: 10 },
  supportEmail: { color: '#F0B90B', fontWeight: '600' },
  result: {
    backgroundColor: '#17261F',
    borderRadius: 12,
    padding: 16,
    marginTop: 14,
  },
  resultTitle: {
    color: '#00D094',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  resultLine: { color: '#D7D7D7', fontSize: 13, lineHeight: 21 },
  resultNote: { color: '#9CCDB9', fontSize: 12, lineHeight: 18, marginTop: 7 },
  submit: {
    height: 50,
    borderRadius: 9,
    backgroundColor: '#F0B90B',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  disabled: { opacity: 0.6 },
  submitText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },
});

export default BSCWithdrawScreen;
