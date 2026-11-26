import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useAccountStore } from '../store/useAccountStore';
import { gatewayApi, type BridgeHistoryRecord } from '../services/gateway_api';
import { Toast } from '../components/Toast';

type HistoryTab = 'deposit' | 'withdrawal';

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').split('.')[0];
  return date.toLocaleString('zh-CN', { hour12: false });
};

const BSC_HISTORY_TAB: Record<HistoryTab, string> = {
  deposit: '充值',
  withdrawal: '提现',
};

const BSCHistoryScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const currentAccount = useAccountStore(state => state.currentAccount);
  const [activeTab, setActiveTab] = useState<HistoryTab>('deposit');
  const [records, setRecords] = useState<BridgeHistoryRecord[]>([]);
  const [rangeDays, setRangeDays] = useState(90);
  const [loading, setLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!currentAccount?.name) {
      setRecords([]);
      return;
    }
    setLoading(true);
    try {
      const response = await gatewayApi.getBSCHistory(currentAccount.name);
      setRecords(response.data);
      setRangeDays(response.range_days);
    } catch (error) {
      setRecords([]);
      Toast.error(error instanceof Error ? error.message : '读取充提记录失败');
    } finally {
      setLoading(false);
    }
  }, [currentAccount?.name]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const visibleRecords = useMemo(
    () => records.filter(record => (activeTab === 'deposit' ? record.type === '充值' : record.type === '提币')),
    [activeTab, records],
  );

  const openDetail = (record: BridgeHistoryRecord) => {
    navigation.navigate('BSCHistoryDetail', { record });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>充提查询</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={loadHistory} disabled={loading}>
          <Icon name="refresh" size={26} color={loading ? '#555555' : '#FFFFFF'} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        {(Object.keys(BSC_HISTORY_TAB) as HistoryTab[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {BSC_HISTORY_TAB[tab]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!currentAccount ? (
        <View style={styles.empty}>
          <Icon name="account-alert-outline" size={44} color="#F0B90B" />
          <Text style={styles.emptyTitle}>请先登录 DFS 账户</Text>
        </View>
      ) : loading && records.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color="#F0B90B" />
          <Text style={styles.muted}>正在读取最近 {rangeDays} 天记录...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={loadHistory} tintColor="#F0B90B" />
          }
        >
          {visibleRecords.length === 0 ? (
            <View style={styles.emptyInline}>
              <Icon name="history" size={48} color="#555555" />
              <Text style={styles.muted}>暂无{BSC_HISTORY_TAB[activeTab]}记录</Text>
            </View>
          ) : (
            visibleRecords.map((record, index) => {
              const isDeposit = record.type === '充值';
              const amount = `${isDeposit ? '+' : '-'}${record.amount}`;
              return (
                <TouchableOpacity
                  key={`${record.txid}-${index}`}
                  style={styles.recordRow}
                  activeOpacity={0.7}
                  onPress={() => openDetail(record)}
                >
                  <View style={styles.recordMain}>
                    <Text style={styles.symbol}>USDT</Text>
                    <Text style={styles.time}>{formatTime(record.time)}</Text>
                  </View>
                  <View style={styles.recordRight}>
                    <Text style={[styles.amount, isDeposit ? styles.depositAmount : styles.withdrawAmount]}>
                      {amount}
                    </Text>
                    <Text style={styles.status}>{record.status}</Text>
                  </View>
                  <Icon name="chevron-right" size={20} color="#555555" />
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    height: 78,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  backButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  refreshButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-end' },
  headerTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '600' },
  tabs: { flexDirection: 'row', height: 52, borderBottomWidth: 1, borderBottomColor: '#242424' },
  tab: { flex: 1, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#F0B90B' },
  tabText: { color: '#777777', fontSize: 16 },
  activeTabText: { color: '#FFFFFF', fontWeight: '600' },
  content: { flex: 1 },
  contentContainer: { paddingBottom: 24 },
  recordRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#20252C',
  },
  recordMain: { flex: 1 },
  symbol: { color: '#F1F3F5', fontSize: 17, fontWeight: '600', marginBottom: 7 },
  time: { color: '#808791', fontSize: 12 },
  recordRight: { alignItems: 'flex-end', marginRight: 2 },
  amount: { fontSize: 17, fontWeight: '600', marginBottom: 5, textAlign: 'right' },
  depositAmount: { color: '#00D094' },
  withdrawAmount: { color: '#FF4757' },
  status: { color: '#858B93', fontSize: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyInline: { alignItems: 'center', paddingVertical: 120 },
  emptyTitle: { color: '#FFFFFF', fontSize: 16, marginTop: 12 },
  muted: { color: '#777777', fontSize: 13, marginTop: 12 },
});

export default BSCHistoryScreen;
