import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import QRCode from 'react-native-qrcode-svg';
import { useNavigation } from '@react-navigation/native';
import { useAccountStore } from '../store/useAccountStore';
import {
  gatewayApi,
  type BSCBridgeConfig,
  type BSCDepositRoute,
} from '../services/gateway_api';
import { Toast } from '../components/Toast';

const formatConfiguredAmount = (value: string | number | undefined) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '--';
  return amount.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0';
};

const getBridgeTip = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const BSCDepositScreen: React.FC = () => {
  const navigation = useNavigation();
  const currentAccount = useAccountStore(state => state.currentAccount);
  const [route, setRoute] = useState<BSCDepositRoute | null>(null);
  const [bridgeConfig, setBridgeConfig] = useState<BSCBridgeConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const loadRoute = useCallback(
    async () => {
      if (!currentAccount?.name) {
        setRoute(null);
        return;
      }
      setLoading(true);
      try {
        setRoute(await gatewayApi.getBSCDepositAddress(currentAccount.name));
      } catch (error) {
        setRoute(null);
        Toast.error(
          error instanceof Error ? error.message : '获取充值地址失败',
        );
      } finally {
        setLoading(false);
      }
    },
    [currentAccount?.name],
  );

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  useEffect(() => {
    let cancelled = false;
    gatewayApi
      .getBSCConfig()
      .then(config => {
        if (!cancelled) setBridgeConfig(config);
      })
      .catch(() => {
        if (!cancelled) setBridgeConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentAccount?.id]);

  const token = route?.token || bridgeConfig?.token || 'USDT';
  const network = route?.chain || bridgeConfig?.chain || 'BSC';
  const chainId = route?.chain_id || bridgeConfig?.chain_id;
  const bridgeTip = getBridgeTip(
    route?.withdrawal_tips ||
      bridgeConfig?.withdrawal_tips ||
      route?.currency?.withdrawal_tips ||
      bridgeConfig?.currency?.withdrawal_tips,
  );

  const copyAddress = () => {
    if (!route?.address) return;
    Clipboard.setString(route.address);
    Toast.success('充值地址已复制');
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
        <Text style={styles.headerTitle}>{token} 充值</Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => loadRoute()}
          disabled={loading}
        >
          <Icon
            name="refresh"
            size={22}
            color={loading ? '#555555' : '#FFFFFF'}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.assetCard}>
          <View style={styles.tokenIcon}>
            <Text style={styles.tokenIconText}>₮</Text>
          </View>
          <View>
            <Text style={styles.assetName}>{token}</Text>
            <Text style={styles.assetSub}>{network}{chainId ? `（${chainId}）` : ''}</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#F0B90B" />
            <Text style={styles.muted}>正在获取专属充值地址...</Text>
          </View>
        ) : !currentAccount ? (
          <View style={styles.empty}>
            <Icon name="account-alert-outline" size={42} color="#F0B90B" />
            <Text style={styles.emptyTitle}>请先登录 DFS 账户</Text>
          </View>
        ) : route ? (
          <>
            <View style={styles.qrCard}>
              <View style={styles.qrFrame}>
                <QRCode
                  value={route.address}
                  size={224}
                  color="#101114"
                  backgroundColor="#FFFFFF"
                />
              </View>
              <Text style={styles.qrHint}>
                使用钱包扫描二维码，自动填写 {network} {token} 充值地址
              </Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.label}>充值地址（仅限 {network} {token}）</Text>
              <Text selectable style={styles.address}>
                {route.address}
              </Text>
              <TouchableOpacity style={styles.copyButton} onPress={copyAddress}>
                <Icon name="content-copy" size={18} color="#0D0D0D" />
                <Text style={styles.copyText}>复制地址</Text>
              </TouchableOpacity>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>到账账户</Text>
                <Text style={styles.infoValue}>{route.account}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>确认数</Text>
                <Text style={styles.infoValue}>
                  {route.confirmations} 个区块
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>最低充值</Text>
                <Text style={styles.infoValue}>
                  {formatConfiguredAmount(route.deposit_min_amount)} {token}
                </Text>
              </View>
            </View>
            <View style={styles.card}>
              <Text style={styles.label}>{token} 合约地址</Text>
              <Text selectable style={styles.contract}>
                {route.contract}
              </Text>
              {bridgeTip ? <Text style={styles.warning}>{bridgeTip}</Text> : null}
            </View>
          </>
        ) : (
          <View style={styles.empty}>
            <Icon name="alert-circle-outline" size={42} color="#FF4757" />
            <Text style={styles.emptyTitle}>暂时无法获取充值地址</Text>
            <TouchableOpacity onPress={() => loadRoute()}>
              <Text style={styles.retry}>点击重试</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.supportCard}>
          <Icon name="email-outline" size={20} color="#F0B90B" />
          <Text selectable style={styles.supportText}>
            {'充值提现问题，请联系邮箱：\n'}
            <Text style={styles.supportEmail}>bridge-team@defishares.org</Text>
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
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
  refreshButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  content: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 36 },
  assetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  tokenIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#26A17B',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tokenIconText: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  assetName: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  assetSub: { color: '#888888', fontSize: 13, marginTop: 4 },
  qrCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    alignItems: 'center',
    padding: 18,
    marginBottom: 14,
  },
  qrFrame: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
  },
  qrHint: {
    color: '#A8A8A8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 14,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
  },
  label: { color: '#999999', fontSize: 13, marginBottom: 10 },
  address: { color: '#FFFFFF', fontSize: 15, lineHeight: 23, marginBottom: 14 },
  contract: { color: '#D0D0D0', fontSize: 12, lineHeight: 19 },
  copyButton: {
    height: 44,
    borderRadius: 8,
    backgroundColor: '#F0B90B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  copyText: {
    color: '#0D0D0D',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#2D2D2D',
    paddingTop: 12,
    marginTop: 4,
  },
  infoLabel: { color: '#888888', fontSize: 13 },
  infoValue: { color: '#FFFFFF', fontSize: 13 },
  warning: { color: '#F0B90B', fontSize: 13, lineHeight: 20, marginTop: 16 },
  supportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#171B23',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#252B36',
    padding: 14,
    marginTop: 14,
    marginBottom: 14,
  },
  supportText: { flex: 1, color: '#B7B7B7', fontSize: 12, lineHeight: 18, marginLeft: 10 },
  supportEmail: { color: '#F0B90B', fontWeight: '600' },
  loading: { alignItems: 'center', paddingTop: 80 },
  muted: { color: '#888888', fontSize: 14, marginTop: 14 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { color: '#FFFFFF', fontSize: 16, marginTop: 14 },
  retry: { color: '#F0B90B', fontSize: 14, marginTop: 14 },
});

export default BSCDepositScreen;
