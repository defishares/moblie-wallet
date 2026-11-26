import React, { useEffect, useState } from 'react';
import { Clipboard, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { gatewayApi, type BSCBridgeConfig, type BridgeHistoryRecord } from '../services/gateway_api';
import { Toast } from '../components/Toast';

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').split('.')[0];
  return date.toLocaleString('zh-CN', { hour12: false });
};

const BSCHistoryDetailScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const record = route.params?.record as BridgeHistoryRecord;
  const isDeposit = record?.type === '充值';
  const [config, setConfig] = useState<BSCBridgeConfig | null>(null);

  useEffect(() => {
    gatewayApi.getBSCConfig().then(setConfig).catch(() => undefined);
  }, []);

  if (!record) return null;

  const amount = `${isDeposit ? '+' : '-'}${record.amount} USDT`;
  const fee = isDeposit ? '0 USDT' : config?.withdrawal_fee === undefined ? '--' : `${config.withdrawal_fee} USDT`;
  const actualAmount = isDeposit ? `${record.amount} USDT` : '--';

  const copy = (value: string, label: string) => {
    if (!value) return;
    Clipboard.setString(value);
    Toast.success(`${label}已复制`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={27} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isDeposit ? '充值详情' : '提现详情'}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.tokenIcon}><Text style={styles.tokenIconText}>₮</Text></View>
          <Text style={styles.amount}>{amount}</Text>
          <View style={styles.statusRow}>
            <Icon name="check-circle-outline" size={22} color="#00C853" />
            <Text style={styles.status}>{record.status}</Text>
          </View>
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{isDeposit ? '为什么我的充值未到账?' : '为什么我的提现未到账?'}</Text>
          <Text style={styles.noticeText}>
            {isDeposit
              ? '充值需要等待 BNB Chain 区块确认，到账状态以 Bridge 记录为准。'
              : '加密货币从 Bridge 转出后，请联系收款平台查询到账情况。'}
          </Text>
        </View>

        <View style={styles.details}>
          <DetailRow label="时间" value={formatTime(record.time)} />
          <DetailRow label="单号" value="--" />
          <DetailRow label="网络" value="BNB Chain" />
          <DetailRow label="实际到账" value={actualAmount} />
          <DetailRow label="手续费" value={fee} />
          <CopyRow label={isDeposit ? '充值地址' : '地址'} value={record.address} onCopy={() => copy(record.address, '地址')} />
          <CopyRow label="TXID" value={record.txid} onCopy={() => copy(record.txid, '交易哈希')} />
          <DetailRow label="地址名称" value="--" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.detailRow}>
    <Text style={styles.label}>{label}</Text>
    <Text selectable style={styles.value}>{value}</Text>
  </View>
);

const CopyRow: React.FC<{ label: string; value: string; onCopy: () => void }> = ({ label, value, onCopy }) => (
  <View style={styles.detailRow}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.copyValue}>
      <Text selectable numberOfLines={2} style={styles.value}>{value || '--'}</Text>
      {value ? <TouchableOpacity onPress={onCopy}><Icon name="content-copy" size={17} color="#B7B7B7" /></TouchableOpacity> : null}
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 5 },
  backButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '600' },
  headerRight: { width: 44 },
  content: { paddingHorizontal: 4, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingTop: 28, paddingBottom: 28 },
  tokenIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#26A17B', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  tokenIconText: { color: '#FFFFFF', fontSize: 29, fontWeight: '700' },
  amount: { color: '#FFFFFF', fontSize: 30, fontWeight: '500' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  status: { color: '#00C853', fontSize: 18, fontWeight: '600', marginLeft: 6 },
  notice: { backgroundColor: '#242428', borderRadius: 15, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 30 },
  noticeTitle: { color: '#E5E5E8', fontSize: 16, marginBottom: 8 },
  noticeText: { color: '#8D8D95', fontSize: 14, lineHeight: 22 },
  details: { paddingHorizontal: 0 },
  detailRow: { minHeight: 47, flexDirection: 'row', alignItems: 'center' },
  label: { width: 86, color: '#8D8D95', fontSize: 15 },
  value: { flex: 1, color: '#E5E5E8', fontSize: 15, textAlign: 'right', lineHeight: 22 },
  copyValue: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
});

export default BSCHistoryDetailScreen;
