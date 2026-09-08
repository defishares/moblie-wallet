/**
 * 邀请计划页面
 * 显示当前用户的邀请信息和被邀请用户列表
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList, FullAccountData } from '../types';
import { chainServiceMgr } from '../services';
import { useAccountStore } from '../store/useAccountStore';
import { getOnChainSettingsAccount } from '../config/constants';

// 邀请记录类型
interface InvitationRecord {
  accountId: string;    // 被邀请人账号 ID
  accountName: string;  // 被邀请人账号名
  inviteTime: number;   // 邀请时间戳（秒）
}

const InvitationScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { currentAccount } = useAccountStore();

  // 状态
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLtm, setIsLtm] = useState(false);
  const [invitationList, setInvitationList] = useState<InvitationRecord[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 格式化时间戳为日期字符串
  const formatInviteTime = (timestamp: number): string => {
    if (timestamp <= 0) {
      return '';
    }
    try {
      const date = new Date(timestamp * 1000);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}/${month}/${day}`;
    } catch (e) {
      return '';
    }
  };

  // 检查账户是否为终身会员
  const checkLtmStatus = (fullAccountData: FullAccountData): boolean => {
    const account = fullAccountData.account;
    // 终身会员判断条件：lifetime_referrer 等于自己的 id
    return account.lifetime_referrer === account.id;
  };

  // 查询邀请信息
  const queryInvitationInfo = useCallback(async () => {
    if (!currentAccount?.id) {
      setErrorMsg('请先登录');
      setIsLoading(false);
      return;
    }

    try {
      // 1. 获取完整账户信息以检查 LTM 状态
      const fullAccountData = await chainServiceMgr.queryFullAccountInfo(currentAccount.id);
      if (fullAccountData) {
        setIsLtm(checkLtmStatus(fullAccountData));
      }

      // 2. 获取链上配置账户
      const invitationAccountId = getOnChainSettingsAccount();
      if (!invitationAccountId) {
        setInvitationList([]);
        setIsLoading(false);
        return;
      }

      // 3. 构造 catalog: system.referrer.{account_id}
      const catalog = `system.referrer.${currentAccount.id}`;

      // 4. 查询邀请存储信息
      const dataArray = await chainServiceMgr.getStorageInfo(invitationAccountId, catalog);

      if (!dataArray || dataArray.length === 0) {
        setInvitationList([]);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      // 5. 解析数据并排序
      const records: InvitationRecord[] = [];
      for (const storageItem of dataArray) {
        try {
          // key 是被邀请人账号 ID
          const accountId = storageItem.key;

          // value 是 JSON 对象，包含 name 和 time
          let valueObj = storageItem.value;

          // 如果 value 是字符串，需要解析
          if (typeof valueObj === 'string') {
            valueObj = JSON.parse(valueObj);
          }

          const accountName = valueObj.name || '';
          const inviteTime = valueObj.time || 0;

          records.push({
            accountId,
            accountName,
            inviteTime,
          });
        } catch (parseError) {
          console.log('[InvitationScreen] 解析邀请记录失败:', parseError);
        }
      }

      // 按时间降序排序（最新的在前面）
      records.sort((a, b) => b.inviteTime - a.inviteTime);

      setInvitationList(records);
      setErrorMsg(null);
    } catch (error: any) {
      console.error('[InvitationScreen] 查询邀请信息失败:', error);
      setErrorMsg('查询失败，请检查网络后重试');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentAccount?.id]);

  // 初始加载
  useEffect(() => {
    queryInvitationInfo();
  }, [queryInvitationInfo]);

  // 下拉刷新
  const handleRefresh = () => {
    setIsRefreshing(true);
    queryInvitationInfo();
  };

  // 渲染单个邀请记录
  const renderInvitationItem = (item: InvitationRecord, index: number) => {
    return (
      <View key={item.accountId} style={styles.invitationItem}>
        <View style={styles.invitationLeft}>
          <Text style={styles.invitationName}>
            {item.accountName}
            <Text style={styles.invitationId}>（{item.accountId}）</Text>
          </Text>
        </View>
        <Text style={styles.invitationDate}>
          {formatInviteTime(item.inviteTime)}
        </Text>
      </View>
    );
  };

  // 渲染空列表
  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <Icon name="account-group-outline" size={48} color="#333333" />
      <Text style={styles.emptyText}>暂无邀请信息</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      {/* 头部导航栏 */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>邀请计划</Text>
        <View style={styles.headerRight} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00D094" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#00D094"
              colors={['#00D094']}
            />
          }
        >
          {/* 身份等级卡片 */}
          <View style={styles.levelCard}>
            <Text style={styles.levelLabel}>我的身份等级：</Text>
            <Text style={styles.levelValue}>
              {isLtm ? '高级会员(LTM)' : '普通会员'}
            </Text>
          </View>

          {/* 说明卡片 */}
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              通过填入邀请人的账户进行注册后，被邀请人将出现在列表中。
              邀请人可获得被邀请人的网络手续费的部分返还及其他的激励。
              注意：只有成为"LTM"等级的会员才有资格成为有效邀请人。
            </Text>
          </View>

          {/* 邀请列表标题 */}
          <Text style={styles.sectionTitle}>我的邀请用户({invitationList.length})</Text>

          {/* 邀请列表 */}
          {errorMsg ? (
            <View style={styles.errorContainer}>
              <Icon name="alert-circle-outline" size={24} color="#FF6B6B" />
              <Text style={styles.errorText}>{errorMsg}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
                <Text style={styles.retryButtonText}>重试</Text>
              </TouchableOpacity>
            </View>
          ) : invitationList.length > 0 ? (
            <View style={styles.invitationList}>
              {invitationList.map((item, index) => renderInvitationItem(item, index))}
            </View>
          ) : (
            renderEmptyList()
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },

  // 头部样式
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerRight: {
    width: 40,
  },

  // 加载状态
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: '#888888',
    marginTop: 12,
  },

  // 滚动区域
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },

  // 身份等级卡片
  levelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  levelLabel: {
    fontSize: 15,
    color: '#888888',
  },
  levelValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // 说明卡片
  infoCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#AAAAAA',
    lineHeight: 22,
  },

  // 分区标题
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 24,
    marginBottom: 12,
  },

  // 邀请列表
  invitationList: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    overflow: 'hidden',
  },
  invitationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D2D',
  },
  invitationLeft: {
    flex: 1,
    marginRight: 12,
  },
  invitationName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  invitationId: {
    fontSize: 13,
    color: '#888888',
    fontWeight: '400',
  },
  invitationDate: {
    fontSize: 14,
    color: '#888888',
  },

  // 空列表
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#666666',
    marginTop: 12,
  },

  // 错误状态
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#FF6B6B',
    marginTop: 8,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#333333',
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
});

export default InvitationScreen;

