/**
 * 每日签到页面
 * 显示签到状态、累计奖励和签到规则
 * 
 * 签到和领取操作通过转账 OP 实现：
 * - 签到：转账金额 = checkin_fee * 10^precision + 1（尾数为1）
 * - 领取：转账金额 = withdraw_fee * 10^precision + 2（尾数为2）
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
import type { RootStackParamList, IDailyCheckinConfig, IUserCheckinData } from '../types';
import { chainServiceMgr, formatGrapheneError } from '../services';
import { useAccountStore } from '../store/useAccountStore';
import { useChainConfigStore } from '../store/useChainConfigStore';
import { UnlockModal, type UnlockedKeys } from '../components/UnlockModal';
import { Toast } from '../components/Toast';
import { BlockView } from '../components/BlockView';
import { CURRENT_NETWORK } from '../config';

// 签到状态枚举
enum CheckinStatus {
    Loading = 'loading',       // 加载中
    NotStarted = 'notStarted', // 活动未开始
    Ended = 'ended',           // 活动已结束
    NotCheckedIn = 'notCheckedIn', // 今日未签到
    CheckedIn = 'checkedIn',   // 今日已签到
    NotLoggedIn = 'notLoggedIn', // 未登录
    ConfigError = 'configError', // 配置错误
}

const DailyCheckinScreen: React.FC = () => {
    const navigation = useNavigation<NavigationProp<RootStackParamList>>();
    const { currentAccount } = useAccountStore();
    const { appSettings } = useChainConfigStore();

    // 状态
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [checkinStatus, setCheckinStatus] = useState<CheckinStatus>(CheckinStatus.Loading);
    const [checkinConfig, setCheckinConfig] = useState<IDailyCheckinConfig | null>(null);
    const [userCheckinData, setUserCheckinData] = useState<IUserCheckinData | null>(null);
    const [currentPeriodIndex, setCurrentPeriodIndex] = useState<number>(-1);
    const [todayReward, setTodayReward] = useState<number>(0);
    const [totalClaimedReward, setTotalClaimedReward] = useState<number>(0);
    const [hasClaimedToday, setHasClaimedToday] = useState<boolean>(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [feeAssetPrecision, setFeeAssetPrecision] = useState<number>(5); // 默认精度
    const [rewardAssetPrecision, setRewardAssetPrecision] = useState<number>(5); // 奖励资产精度

    // 计算当前签到周期索引
    const calculatePeriodIndex = useCallback((config: IDailyCheckinConfig): number => {
        const now = Math.floor(Date.now() / 1000);
        const periodIndex = Math.floor((now - config.start_time) / config.period_seconds);
        console.log(`[DailyCheckinScreen] 当前签到周期索引: ${Object.values(config)}`, now - config.start_time);
        return periodIndex;
    }, []);

    // 格式化时间戳为日期字符串
    const formatDate = (timestamp: number): string => {
        if (timestamp <= 0) return '';
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

    // 计算活动结束时间戳
    const getEndTimestamp = useCallback((config: IDailyCheckinConfig): number => {
        return config.start_time + config.period_seconds * config.period_count;
    }, []);

    // 格式化奖励数量（除以精度）
    const formatRewardAmount = useCallback((amount: number): string => {
        const divisor = Math.pow(10, rewardAssetPrecision);
        const formatted = amount / divisor;
        // 移除末尾多余的0
        return formatted.toFixed(rewardAssetPrecision).replace(/\.?0+$/, '');
    }, [rewardAssetPrecision]);

    // 计算下次可签到时间
    const getNextCheckinTime = useCallback((config: IDailyCheckinConfig, periodIndex: number): string => {
        // 计算下一个周期的开始时间
        const nextPeriodStart = config.start_time + (periodIndex + 1) * config.period_seconds;
        const now = Math.floor(Date.now() / 1000);

        // 判断是否是明天
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStartTimestamp = Math.floor(todayStart.getTime() / 1000);
        const tomorrowStartTimestamp = todayStartTimestamp + 86400;

        if (nextPeriodStart >= tomorrowStartTimestamp && nextPeriodStart < tomorrowStartTimestamp + 86400) {
            const nextDate = new Date(nextPeriodStart * 1000);
            const hours = String(nextDate.getHours()).padStart(2, '0');
            const minutes = String(nextDate.getMinutes()).padStart(2, '0');
            return `明天 ${hours}:${minutes}`;
        } else {
            return formatDate(nextPeriodStart);
        }
    }, []);

    // 查询签到信息
    const queryCheckinInfo = useCallback(async () => {
        // 检查登录状态
        if (!currentAccount?.id) {
            setCheckinStatus(CheckinStatus.NotLoggedIn);
            setIsLoading(false);
            setIsRefreshing(false);
            return;
        }

        // 获取签到配置
        const config = appSettings?.daily_checkin;
        if (!config || !config.enable) {
            setCheckinStatus(CheckinStatus.ConfigError);
            setIsLoading(false);
            setIsRefreshing(false);
            return;
        }

        setCheckinConfig(config);

        try {
            // 获取费用资产和奖励资产精度
            const feeAssetSymbol = config.fee_asset || CURRENT_NETWORK.coreAsset;
            const rewardAssetSymbol = config.reward_asset || CURRENT_NETWORK.coreAsset;
            const assetMap = await chainServiceMgr.queryAssetsBySymbols([feeAssetSymbol, rewardAssetSymbol]);
            const feeAsset = assetMap.get(feeAssetSymbol);
            const rewardAsset = assetMap.get(rewardAssetSymbol);
            if (feeAsset) {
                setFeeAssetPrecision(feeAsset.precision);
            }
            if (rewardAsset) {
                setRewardAssetPrecision(rewardAsset.precision);
            }

            // 计算当前周期索引
            const periodIndex = calculatePeriodIndex(config);
            setCurrentPeriodIndex(periodIndex);

            // 检查活动状态
            if (periodIndex < 0) {
                setCheckinStatus(CheckinStatus.NotStarted);
                setIsLoading(false);
                setIsRefreshing(false);
                return;
            }

            if (periodIndex >= config.period_count) {
                setCheckinStatus(CheckinStatus.Ended);
                setIsLoading(false);
                setIsRefreshing(false);
                return;
            }

            // 辅助函数：从存储数据中解析用户签到数据
            const parseUserDataFromStorage = (dataArray: any[], userId: string): IUserCheckinData | null => {
                if (!dataArray || dataArray.length === 0) return null;
                for (const storageItem of dataArray) {
                    if (storageItem.key === userId) {
                        let valueObj = storageItem.value;
                        if (typeof valueObj === 'string') {
                            valueObj = JSON.parse(valueObj);
                        }
                        return valueObj as IUserCheckinData;
                    }
                }
                return null;
            };

            // 辅助函数：查找用户历史累积已领取金额
            // 从指定周期往回查找，每次查询10个周期，直到找到已领奖记录或到达第一个周期
            const findPreviousCumulativeAmount = async (startPeriodIndex: number): Promise<number> => {
                const BATCH_SIZE = 10;
                let searchIndex = startPeriodIndex;

                while (searchIndex >= 0) {
                    // 计算本批次要查询的周期范围
                    const endIndex = Math.max(0, searchIndex - BATCH_SIZE + 1);
                    const periodIndices: number[] = [];
                    for (let i = searchIndex; i >= endIndex; i--) {
                        periodIndices.push(i);
                    }

                    // 并行查询这批周期的数据
                    const queryPromises = periodIndices.map(idx => {
                        const cat = `system.dailycheckin.${config.activity_id}.${idx}`;
                        return chainServiceMgr.getStorageInfo(config.target_account, cat)
                            .then(data => ({ periodIndex: idx, data }))
                            .catch(() => ({ periodIndex: idx, data: null }));
                    });

                    const results = await Promise.all(queryPromises);

                    // 按周期索引降序检查（从最近的开始）
                    for (const result of results) {
                        if (result.data) {
                            const historyData = parseUserDataFromStorage(result.data, currentAccount.id);
                            if (historyData && historyData.r === 1) {
                                // 找到已领奖记录，返回其累积金额
                                console.log(`[DailyCheckinScreen] 找到历史领奖记录，周期: ${result.periodIndex}, ca: ${historyData.ca}`);
                                return historyData.ca || 0;
                            }
                        }
                    }

                    // 继续往前查找
                    searchIndex = endIndex - 1;
                }

                // 没有找到历史领奖记录
                console.log('[DailyCheckinScreen] 未找到历史领奖记录');
                return 0;
            };

            // 构造 catalog: system.dailycheckin.${activity_id}.${period_index}
            const catalog = `system.dailycheckin.${config.activity_id}.${periodIndex}`;

            // 查询当前周期用户签到数据
            const dataArray = await chainServiceMgr.getStorageInfo(config.target_account, catalog);

            // 解析当前用户的签到数据
            const userData = parseUserDataFromStorage(dataArray, currentAccount.id);

            setUserCheckinData(userData);

            // 计算今日奖励和累计已领取奖励
            if (userData) {
                setTodayReward(userData.ra || 0);
                // 今日是否已领取
                setHasClaimedToday(userData.r === 1);

                // 判断签到状态
                if (userData.s === 1) {
                    setCheckinStatus(CheckinStatus.CheckedIn);
                } else {
                    setCheckinStatus(CheckinStatus.NotCheckedIn);
                }

                // 累计已领取余额：如果当前周期已领取，直接用 ca；否则查找历史
                if (userData.r === 1) {
                    setTotalClaimedReward(userData.ca || 0);
                } else {
                    // 从上一个周期开始往回查找最近的已领奖记录
                    const previousCa = await findPreviousCumulativeAmount(periodIndex - 1);
                    setTotalClaimedReward(previousCa);
                }
            } else {
                setTodayReward(0);
                setHasClaimedToday(false);
                setCheckinStatus(CheckinStatus.NotCheckedIn);
                // 未签到，也需要查找历史累积金额
                const previousCa = await findPreviousCumulativeAmount(periodIndex - 1);
                setTotalClaimedReward(previousCa);
            }

        } catch (error: any) {
            console.error('[DailyCheckinScreen] 查询签到信息失败:', error);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [currentAccount?.id, appSettings?.daily_checkin, calculatePeriodIndex]);

    // 初始加载
    useEffect(() => {
        queryCheckinInfo();
    }, [queryCheckinInfo]);

    // 下拉刷新
    const handleRefresh = () => {
        setIsRefreshing(true);
        queryCheckinInfo();
    };

    /**
     * 执行签到/领取转账操作
     * @param opcode 操作码：1=签到，2=领取
     * @param fee 费用金额
     * @param keys 解锁后的私钥
     */
    const executeCheckinTransfer = async (opcode: number, fee: number, keys: UnlockedKeys) => {
        if (!currentAccount || !checkinConfig) {
            Toast.error('账户或配置信息不完整');
            return;
        }

        const activePrivateKey = keys.active;
        if (!activePrivateKey) {
            Toast.error('缺少资金私钥');
            return;
        }

        const operationName = opcode === 1 ? '签到' : '领取';
        BlockView.show(`正在${operationName}...`);

        try {
            // 1. 获取发送者账户信息
            const fromAccount = await chainServiceMgr.getAccountByName(currentAccount.name);
            if (!fromAccount) {
                throw new Error('获取发送账户信息失败');
            }

            // 2. 获取费用资产信息
            const feeAssetSymbol = checkinConfig.fee_asset || CURRENT_NETWORK.coreAsset;
            const assetMap = await chainServiceMgr.queryAssetsBySymbols([feeAssetSymbol]);
            const feeAsset = assetMap.get(feeAssetSymbol);
            if (!feeAsset) {
                throw new Error('获取费用资产信息失败');
            }

            // 3. 计算转账金额：fee * 10^precision + opcode
            const precisionPow = Math.pow(10, feeAsset.precision);
            const transferAmount = Math.round(fee * precisionPow + opcode);

            console.log(`[DailyCheckinScreen] ${operationName}转账金额: ${transferAmount} (${fee} * 10^${feeAsset.precision} + ${opcode})`);

            // 4. 执行转账到 target_account
            await chainServiceMgr.transfer({
                fromAccountId: fromAccount.id,
                toAccountId: checkinConfig.target_account,
                assetId: feeAsset.id,
                amount: transferAmount,
                feeAssetId: feeAsset.id,
            }, activePrivateKey);

            BlockView.hide();
            Toast.success(opcode === 1 ? '已签到，请稍候刷新。' : '已领取，请稍候刷新。');

            // 刷新数据
            setTimeout(() => {
                setIsRefreshing(true);
                queryCheckinInfo();
            }, 2000);

        } catch (error: any) {
            BlockView.hide();
            console.error(`[DailyCheckinScreen] ${operationName}失败:`, error);
            Toast.error(formatGrapheneError(error));
        }
    };

    // 签到按钮点击
    const handleCheckin = () => {
        if (!currentAccount) {
            Toast.error('请先登录');
            return;
        }

        if (!checkinConfig) {
            Toast.error('签到配置不可用');
            return;
        }

        if (isProcessing) {
            return;
        }

        setIsProcessing(true);

        // 弹出解锁弹窗
        UnlockModal.show({
            accountId: currentAccount.id,
            accountName: currentAccount.name,
            onSuccess: (keys: UnlockedKeys) => {
                // 签到操作：opcode = 1，费用 = checkin_fee
                executeCheckinTransfer(1, parseFloat(checkinConfig.checkin_fee), keys);
                setIsProcessing(false);
            },
            onCancel: () => {
                setIsProcessing(false);
            },
        });
    };

    // 领取奖励按钮点击
    const handleWithdraw = () => {
        if (!currentAccount) {
            Toast.error('请先登录');
            return;
        }

        if (!checkinConfig) {
            Toast.error('签到配置不可用');
            return;
        }

        if (isProcessing) {
            return;
        }

        setIsProcessing(true);

        // 弹出解锁弹窗
        UnlockModal.show({
            accountId: currentAccount.id,
            accountName: currentAccount.name,
            onSuccess: (keys: UnlockedKeys) => {
                // 领取操作：opcode = 2，费用 = withdraw_fee
                executeCheckinTransfer(2, parseFloat(checkinConfig.withdraw_fee), keys);
                setIsProcessing(false);
            },
            onCancel: () => {
                setIsProcessing(false);
            },
        });
    };

    // 获取签到按钮文案和状态
    const getCheckinButtonInfo = (): { text: string; disabled: boolean } => {
        // 处理中时禁用
        if (isProcessing) {
            return { text: '处理中...', disabled: true };
        }

        switch (checkinStatus) {
            case CheckinStatus.NotStarted:
                return { text: '活动未开始', disabled: true };
            case CheckinStatus.Ended:
                return { text: '活动已结束', disabled: true };
            case CheckinStatus.CheckedIn:
                return { text: '今日已签到', disabled: true };
            case CheckinStatus.NotCheckedIn:
                return { text: '立即签到', disabled: false };
            case CheckinStatus.NotLoggedIn:
                return { text: '请先登录', disabled: true };
            case CheckinStatus.ConfigError:
                return { text: '暂未开放', disabled: true };
            default:
                return { text: '签到', disabled: true };
        }
    };

    // 获取领取按钮状态和样式
    const getWithdrawButtonInfo = (): { text: string; disabled: boolean; isGreen: boolean } => {
        // 处理中时禁用
        if (isProcessing) {
            return { text: '处理中...', disabled: true, isGreen: false };
        }

        if (!checkinConfig) {
            return { text: '不可领取', disabled: true, isGreen: false };
        }

        // 未签到 - 不可领取
        if (checkinStatus !== CheckinStatus.CheckedIn) {
            return { text: '不可领取', disabled: true, isGreen: false };
        }

        // 已签到且已领取 - 今日已领取
        if (hasClaimedToday) {
            return { text: '今日已领取', disabled: true, isGreen: false };
        }

        // 已签到但未领取 - 领取奖励（绿色）
        return { text: '领取奖励', disabled: false, isGreen: true };
    };

    const checkinButtonInfo = getCheckinButtonInfo();
    const withdrawButtonInfo = getWithdrawButtonInfo();

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
                <Text style={styles.headerTitle}>每日签到</Text>
                <View style={styles.headerRight} />
            </View>

            {isLoading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#F0B90B" />
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
                            tintColor="#F0B90B"
                            colors={['#F0B90B']}
                        />
                    }
                >
                    {/* 签到主卡片 */}
                    <View style={styles.mainCard}>
                        {/* 日历图标 */}
                        <View style={styles.iconContainer}>
                            <Icon name="calendar-check" size={40} color="#F0B90B" />
                        </View>

                        {/* 标题 */}
                        <Text style={styles.mainTitle}>每日签到</Text>
                        <Text style={styles.mainSubtitle}>连续签到可获得更多奖励</Text>

                        {/* 签到按钮 */}
                        <TouchableOpacity
                            style={[
                                styles.checkinButton,
                                checkinButtonInfo.disabled && styles.checkinButtonDisabled,
                            ]}
                            onPress={handleCheckin}
                            disabled={checkinButtonInfo.disabled}
                        >
                            <Text
                                style={[
                                    styles.checkinButtonText,
                                    checkinButtonInfo.disabled && styles.checkinButtonTextDisabled,
                                ]}
                            >
                                {checkinButtonInfo.text}
                            </Text>
                        </TouchableOpacity>

                        {/* 今日获得激励 */}
                        <View style={styles.todayRewardContainer}>
                            <Text style={styles.todayRewardLabel}>今日获得激励</Text>
                            <Text style={styles.todayRewardValue}>
                                <Text style={styles.todayRewardNumber}>{formatRewardAmount(todayReward)}</Text>
                                <Text style={styles.todayRewardUnit}> {checkinConfig?.reward_asset || ''}</Text>
                            </Text>
                        </View>
                    </View>

                    {/* 累积已领取余额卡片 */}
                    <View style={styles.balanceCard}>
                        <View style={styles.balanceHeader}>
                            <Text style={styles.balanceLabel}>累积已领取余额</Text>
                        </View>
                        <View style={styles.balanceValueContainer}>
                            <Text style={styles.balanceValue}>{formatRewardAmount(totalClaimedReward)}</Text>
                            <Text style={styles.balanceUnit}> {checkinConfig?.reward_asset || ''}</Text>
                        </View>

                        {/* 领取按钮 */}
                        <TouchableOpacity
                            style={[
                                styles.withdrawButton,
                                withdrawButtonInfo.isGreen && styles.withdrawButtonGreen,
                                withdrawButtonInfo.disabled && styles.withdrawButtonDisabled,
                            ]}
                            onPress={handleWithdraw}
                            disabled={withdrawButtonInfo.disabled}
                        >
                            <Text
                                style={[
                                    styles.withdrawButtonText,
                                    withdrawButtonInfo.isGreen && styles.withdrawButtonTextGreen,
                                    withdrawButtonInfo.disabled && styles.withdrawButtonTextDisabled,
                                ]}
                            >
                                {withdrawButtonInfo.text}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* 规则说明 */}
                    <View style={styles.rulesCard}>
                        <Text style={styles.rulesTitle}>规则说明</Text>

                        {/* 每日签到时间 */}
                        <View style={styles.ruleItem}>
                            <View style={styles.ruleIconContainer}>
                                <Icon name="clock-outline" size={20} color="#888888" />
                            </View>
                            <Text style={styles.ruleLabel}>每日签到时间</Text>
                            <Text style={styles.ruleValue}>08:00 - 07:59 (UTC+8)</Text>
                        </View>

                        {/* 下次可签到时间 */}
                        <View style={styles.ruleItem}>
                            <View style={styles.ruleIconContainer}>
                                <Icon name="calendar-today" size={20} color="#888888" />
                            </View>
                            <Text style={styles.ruleLabel}>下次可签到时间</Text>
                            <Text style={[styles.ruleValue, styles.ruleValueHighlight]}>
                                {checkinConfig && currentPeriodIndex >= 0
                                    ? getNextCheckinTime(checkinConfig, currentPeriodIndex)
                                    : '--'}
                            </Text>
                        </View>

                        {/* 签到手续费 */}
                        <View style={styles.ruleItem}>
                            <View style={styles.ruleIconContainer}>
                                <Icon name="cash-check" size={20} color="#888888" />
                            </View>
                            <Text style={styles.ruleLabel}>签到手续费</Text>
                            <Text style={styles.ruleValue}>
                                {checkinConfig ? `${checkinConfig.checkin_fee} ${checkinConfig.fee_asset}` : '--'}
                            </Text>
                        </View>

                        {/* 领取手续费 */}
                        <View style={[styles.ruleItem, styles.ruleItemLast]}>
                            <View style={styles.ruleIconContainer}>
                                <Icon name="cash-check" size={20} color="#888888" />
                            </View>
                            <Text style={styles.ruleLabel}>领取手续费</Text>
                            <Text style={styles.ruleValue}>
                                {checkinConfig ? `${checkinConfig.withdraw_fee} ${checkinConfig.fee_asset}` : '--'}
                            </Text>
                        </View>
                    </View>

                    {/* 操作提示 */}
                    <View style={styles.tipContainer}>
                        <Icon name="information-outline" size={18} color="#F0B90B" />
                        <View style={styles.tipContent}>
                            <Text style={styles.tipTitle}>操作提示</Text>
                            <Text style={styles.tipText}>
                                签到和提取操作存在少许延迟，请勿重复提交。
                            </Text>
                        </View>
                    </View>

                    {/* 底部间距 */}
                    <View style={styles.bottomSpacer} />
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

    // 签到主卡片
    mainCard: {
        backgroundColor: '#1A1A1A',
        borderRadius: 16,
        padding: 24,
        marginTop: 16,
        alignItems: 'center',
    },
    iconContainer: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: '#2D2D2D',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    mainTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#FFFFFF',
        marginBottom: 8,
    },
    mainSubtitle: {
        fontSize: 14,
        color: '#888888',
        marginBottom: 24,
    },
    checkinButton: {
        width: '100%',
        height: 48,
        borderRadius: 8,
        backgroundColor: '#F0B90B',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    checkinButtonDisabled: {
        backgroundColor: '#3D3D3D',
    },
    checkinButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#0D0D0D',
    },
    checkinButtonTextDisabled: {
        color: '#888888',
    },
    todayRewardContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#2D2D2D',
    },
    todayRewardLabel: {
        fontSize: 15,
        color: '#888888',
    },
    todayRewardValue: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    todayRewardNumber: {
        fontSize: 20,
        fontWeight: '700',
        color: '#F0B90B',
    },
    todayRewardUnit: {
        fontSize: 14,
        color: '#F0B90B',
    },

    // 余额卡片
    balanceCard: {
        backgroundColor: '#1A1A1A',
        borderRadius: 16,
        padding: 20,
        marginTop: 16,
    },
    balanceHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    balanceLabel: {
        fontSize: 15,
        color: '#888888',
    },
    balanceValueContainer: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginTop: 8,
        marginBottom: 20,
    },
    balanceValue: {
        fontSize: 32,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    balanceUnit: {
        fontSize: 16,
        color: '#888888',
    },
    withdrawButton: {
        width: '100%',
        height: 48,
        borderRadius: 8,
        backgroundColor: '#F0B90B',
        justifyContent: 'center',
        alignItems: 'center',
    },
    withdrawButtonGreen: {
        backgroundColor: '#F0B90B',
    },
    withdrawButtonDisabled: {
        backgroundColor: '#3D3D3D',
    },
    withdrawButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#0D0D0D',
    },
    withdrawButtonTextGreen: {
        color: '#0D0D0D',
    },
    withdrawButtonTextDisabled: {
        color: '#888888',
    },

    // 规则卡片
    rulesCard: {
        backgroundColor: '#1A1A1A',
        borderRadius: 16,
        padding: 20,
        marginTop: 16,
    },
    rulesTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: '#FFFFFF',
        marginBottom: 16,
    },
    ruleItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#2D2D2D',
    },
    ruleItemLast: {
        borderBottomWidth: 0,
    },
    ruleIconContainer: {
        width: 28,
        marginRight: 8,
    },
    ruleLabel: {
        flex: 1,
        fontSize: 15,
        color: '#888888',
    },
    ruleValue: {
        fontSize: 15,
        color: '#FFFFFF',
        fontWeight: '500',
    },
    ruleValueHighlight: {
        color: '#F0B90B',
        fontWeight: '600',
    },

    // 操作提示
    tipContainer: {
        flexDirection: 'row',
        backgroundColor: 'rgba(240, 185, 11, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(240, 185, 11, 0.3)',
        borderRadius: 12,
        padding: 16,
        marginTop: 16,
    },
    tipContent: {
        flex: 1,
        marginLeft: 12,
    },
    tipTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#F0B90B',
        marginBottom: 4,
    },
    tipText: {
        fontSize: 12,
        color: '#888888',
        lineHeight: 18,
    },

    // 底部间距
    bottomSpacer: {
        height: 32,
    },
});

export default DailyCheckinScreen;

