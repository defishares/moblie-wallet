/**
 * 转账页面
 * 支持转账到其他账户，包含二次确认和解锁验证
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    StatusBar,
    TextInput,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Modal,
    Clipboard,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types';
import { useAccountStore } from '../store/useAccountStore';
import { useBalanceStore, type AssetBalanceDetail } from '../store/useBalanceStore';
import { PrivateKey } from 'bitsharesjs';
import { chainServiceMgr, formatGrapheneError } from '../services/chainservice_mgr';
import { Toast } from '../components/Toast';
import { BlockView } from '../components/BlockView';
import { UnlockModal, type UnlockedKeys } from '../components/UnlockModal';
import { CURRENT_NETWORK } from '../config';
import { filterNumericInput, INPUT_DECIMAL_PRESETS } from '../utils';

// 核心资产配置
const CORE_ASSET_SYMBOL = CURRENT_NETWORK.coreAsset;
const CORE_ASSET_ID = CURRENT_NETWORK.coreAssetId;

type TransferScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Transfer'>;
type TransferScreenRouteProp = RouteProp<RootStackParamList, 'Transfer'>;

// 资产选项接口
interface AssetOption {
    id: string;
    symbol: string;
    precision: number;
    available: number;
    color: string;
}

// 获取资产颜色
const getAssetColor = (symbol: string): string => {
    const colorMap: Record<string, string> = {
        BTC: '#F7931A',
        ETH: '#627EEA',
        USDT: '#26A17B',
        SOL: '#9945FF',
        DOGE: '#C2A633',
        XRP: '#23292F',
        BCH: '#8DC351',
        PAXG: '#E4B831',
        HBW: '#00D094',
        OKB: '#2D60E0',
        BNB: '#F3BA2F',
    };
    return colorMap[symbol] || '#888888';
};

const TransferScreen: React.FC = () => {
    const navigation = useNavigation<TransferScreenNavigationProp>();
    const route = useRoute<TransferScreenRouteProp>();
    const { currentAccount } = useAccountStore();

    // 从 BalanceStore 获取资产列表
    const balanceItems = useBalanceStore(state => state.balanceItems);

    // 构建可转账资产列表
    const assetOptions = useMemo((): AssetOption[] => {
        if (balanceItems.length === 0) {
            // 如果没有任何余额，显示默认的 core 代币
            return [{
                id: CORE_ASSET_ID,
                symbol: CORE_ASSET_SYMBOL,
                precision: 5,
                available: 0,
                color: getAssetColor(CORE_ASSET_SYMBOL),
            }];
        }

        return balanceItems.map(item => ({
            id: item.assetId,
            symbol: item.symbol,
            precision: item.precision,
            available: item.available,
            color: getAssetColor(item.symbol),
        }));
    }, [balanceItems]);

    // 表单状态
    const [selectedAsset, setSelectedAsset] = useState<AssetOption>(assetOptions[0]);
    const [receiverAccount, setReceiverAccount] = useState('');
    const [amount, setAmount] = useState('');
    const [memo, setMemo] = useState('');

    // UI 状态
    const [showAssetPicker, setShowAssetPicker] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [receiverValid, setReceiverValid] = useState<boolean | null>(null);
    const [isCheckingReceiver, setIsCheckingReceiver] = useState(false);

    // 接收账户信息（用于获取 memo key）
    const [toAccountInfo, setToAccountInfo] = useState<any>(null);

    // 更新选中的资产（当资产列表变化时）
    useEffect(() => {
        if (assetOptions.length > 0 && !assetOptions.find(a => a.id === selectedAsset.id)) {
            setSelectedAsset(assetOptions[0]);
        }
    }, [assetOptions, selectedAsset.id]);

    // 获取可用余额
    const availableBalance = selectedAsset.available;

    // 获取核心资产余额（用于手续费）
    const coreAssetBalance = useMemo(() => {
        const coreItem = balanceItems.find(item => item.assetId === CORE_ASSET_ID);
        return coreItem?.available || 0;
    }, [balanceItems]);

    // 验证接收账户
    const validateReceiver = useCallback(async (account: string) => {
        if (!account.trim()) {
            setReceiverValid(null);
            setToAccountInfo(null);
            return;
        }

        // 检查是否给自己转账
        if (currentAccount && account.trim().toLowerCase() === currentAccount.name.toLowerCase()) {
            setReceiverValid(false);
            setToAccountInfo(null);
            return;
        }

        setIsCheckingReceiver(true);
        try {
            const accountInfo = await chainServiceMgr.getAccountByName(account.trim());
            if (accountInfo) {
                // 再次检查账户 ID 是否与当前账户相同（防止大小写不同但实际是同一账户）
                if (currentAccount && accountInfo.id === currentAccount.id) {
                    setReceiverValid(false);
                    setToAccountInfo(null);
                } else {
                    setReceiverValid(true);
                    setToAccountInfo(accountInfo);
                }
            } else {
                setReceiverValid(false);
                setToAccountInfo(null);
            }
        } catch (error) {
            setReceiverValid(false);
            setToAccountInfo(null);
        } finally {
            setIsCheckingReceiver(false);
        }
    }, [currentAccount]);

    // 延迟验证接收账户
    useEffect(() => {
        const timer = setTimeout(() => {
            if (receiverAccount.trim()) {
                validateReceiver(receiverAccount);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [receiverAccount, validateReceiver]);

    // 粘贴接收账户
    const handlePaste = async () => {
        try {
            const text = await Clipboard.getString();
            if (text) {
                setReceiverAccount(text.trim());
            }
        } catch (error) {
            console.error('粘贴失败:', error);
        }
    };

    // 设置全部金额
    const handleSetAllAmount = () => {
        setAmount(availableBalance.toString());
    };

    // 处理金额输入（根据资产精度限制小数位数）
    const handleAmountChange = useCallback((text: string) => {
        const filtered = filterNumericInput(text, selectedAsset.precision);
        setAmount(filtered);
    }, [selectedAsset.precision]);

    // 验证表单（条件不满足时用 Toast 提示）
    const validateForm = (): boolean => {
        if (!receiverAccount.trim()) {
            Toast.warning('请输入接收账户');
            return false;
        }
        // 检查是否给自己转账
        if (currentAccount && (
            receiverAccount.trim().toLowerCase() === currentAccount.name.toLowerCase() ||
            (toAccountInfo && toAccountInfo.id === currentAccount.id)
        )) {
            Toast.warning('不能给自己转账');
            return false;
        }
        if (receiverValid === false) {
            Toast.warning('接收账户不存在');
            return false;
        }
        if (!amount || parseFloat(amount) <= 0) {
            Toast.warning('请输入转账金额');
            return false;
        }
        if (parseFloat(amount) > availableBalance) {
            Toast.warning('余额不足');
            return false;
        }
        // 检查核心资产余额是否足够支付手续费（简单检查）
        if (coreAssetBalance <= 0 && selectedAsset.id !== CORE_ASSET_ID) {
            Toast.warning(`${CORE_ASSET_SYMBOL}余额不足以支付手续费`);
            return false;
        }
        return true;
    };

    // 点击确认转账按钮
    const handleConfirmPress = () => {
        if (validateForm()) {
            setShowConfirmModal(true);
        }
    };

    // 执行转账
    const executeTransfer = async (keys: UnlockedKeys) => {
        if (!currentAccount || !toAccountInfo) {
            Toast.error('账户信息不完整');
            return;
        }

        // 获取 active 私钥（必须）
        const activePrivateKey = keys.active;
        if (!activePrivateKey) {
            Toast.error('缺少资金私钥。');
            return;
        }

        BlockView.show('正在转账...');

        try {
            // 1. 获取发送者账户信息
            const fromAccount = await chainServiceMgr.getAccountByName(currentAccount.name);

            if (!fromAccount) {
                throw new Error('获取发送账户信息失败');
            }

            // 2. 获取资产信息
            const assetMap = await chainServiceMgr.queryAssetsBySymbols([selectedAsset.symbol]);
            const asset = assetMap.get(selectedAsset.symbol);

            if (!asset) {
                throw new Error('获取资产信息失败');
            }

            // 3. 计算转账数量（精度转换）
            const amountValue = Math.round(parseFloat(amount) * Math.pow(10, asset.precision));

            // 4. 准备 memo 加密相关信息
            const fromMemoKey = fromAccount.options?.memo_key;
            const toMemoKey = toAccountInfo.options?.memo_key;

            // 5. 确定用于 memo 加密的私钥
            // 如果存在 memo 私钥，验证其公钥是否与账户的 memo_key 匹配
            let memoPrivateKey: string | undefined;
            if (keys.memo && fromMemoKey) {
                try {
                    const memoPrivKey = PrivateKey.fromWif(keys.memo);
                    const derivedMemoPublicKey = memoPrivKey.toPublicKey().toPublicKeyString();
                    if (derivedMemoPublicKey === fromMemoKey) {
                        // memo 私钥匹配，使用 memo 私钥
                        memoPrivateKey = keys.memo;
                        console.log('[Transfer] 使用 memo 私钥进行备注加密');
                    } else {
                        // memo 私钥不匹配，使用 active 私钥
                        console.log('[Transfer] memo 私钥不匹配账户 memo_key，使用 active 私钥');
                        memoPrivateKey = activePrivateKey;
                    }
                } catch (error) {
                    console.warn('[Transfer] 解析 memo 私钥失败，使用 active 私钥:', error);
                    memoPrivateKey = activePrivateKey;
                }
            } else {
                // 没有 memo 私钥，使用 active 私钥
                memoPrivateKey = activePrivateKey;
            }

            // 6. 执行转账
            await chainServiceMgr.transfer({
                fromAccountId: fromAccount.id,
                toAccountId: toAccountInfo.id,
                assetId: asset.id,
                amount: amountValue,
                memo: memo.trim() || undefined,
                toMemoKey,
                feeAssetId: CORE_ASSET_ID,
            }, activePrivateKey, memoPrivateKey);

            BlockView.hide();

            // 成功提示
            Toast.success(`已成功转账 ${amount} ${selectedAsset.symbol} 到 ${receiverAccount}`);

            // 返回上一页
            setTimeout(() => {
                navigation.goBack();
            }, 1000);

        } catch (error: any) {
            BlockView.hide();
            console.error('[Transfer] 转账失败:', error);
            Toast.error(formatGrapheneError(error));
        }
    };

    // 处理确认提交
    const handleSubmit = () => {
        if (!currentAccount) {
            Toast.error('请先登录');
            return;
        }

        setShowConfirmModal(false);

        // 弹出解锁弹窗
        UnlockModal.show({
            accountId: currentAccount.id,
            accountName: currentAccount.name,
            onSuccess: (keys: UnlockedKeys) => {
                executeTransfer(keys);
            },
            onCancel: () => {
                Toast.info('已取消转账');
            },
        });
    };

    // 格式化余额显示
    const formatBalance = (value: number, precision: number = 6): string => {
        if (value === 0) return '0';
        if (value < 0.000001) return value.toFixed(8);
        if (value < 0.01) return value.toFixed(6);
        if (value < 1) return value.toFixed(4);
        return value.toFixed(precision > 4 ? 4 : precision);
    };

    // 渲染头部
    const renderHeader = () => (
        <View style={styles.header}>
            <TouchableOpacity
                style={styles.backButton}
                onPress={() => navigation.goBack()}
            >
                <Icon name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>转账</Text>
            <View style={styles.headerRight} />
        </View>
    );

    // 渲染资产选择器
    const renderAssetPicker = () => (
        <Modal
            visible={showAssetPicker}
            transparent
            animationType="slide"
            onRequestClose={() => setShowAssetPicker(false)}
        >
            <TouchableOpacity
                style={styles.modalOverlay}
                activeOpacity={1}
                onPress={() => setShowAssetPicker(false)}
            >
                <View style={styles.assetPickerContainer}>
                    <Text style={styles.assetPickerTitle}>选择代币</Text>
                    <ScrollView style={styles.assetPickerList} showsVerticalScrollIndicator={false}>
                        {assetOptions.map((asset) => (
                            <TouchableOpacity
                                key={asset.id}
                                style={styles.assetPickerItem}
                                onPress={() => {
                                    setSelectedAsset(asset);
                                    setShowAssetPicker(false);
                                    setAmount(''); // 清空金额
                                }}
                            >
                                <View style={[styles.assetIcon, { backgroundColor: asset.color }]}>
                                    <Text style={styles.assetIconText}>{asset.symbol.charAt(0)}</Text>
                                </View>
                                <View style={styles.assetPickerItemInfo}>
                                    <Text style={styles.assetPickerItemText}>{asset.symbol}</Text>
                                    <Text style={styles.assetPickerItemBalance}>
                                        可用: {formatBalance(asset.available)}
                                    </Text>
                                </View>
                                {selectedAsset.id === asset.id && (
                                    <Icon name="check" size={20} color="#00D094" />
                                )}
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            </TouchableOpacity>
        </Modal>
    );

    // 渲染二次确认弹窗
    const renderConfirmModal = () => (
        <Modal
            visible={showConfirmModal}
            transparent
            animationType="slide"
            onRequestClose={() => setShowConfirmModal(false)}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.confirmModalContainer}>
                    <Text style={styles.confirmModalTitle}>转账预览</Text>

                    <View style={styles.confirmRow}>
                        <Text style={styles.confirmLabel}>发送者</Text>
                        <Text style={styles.confirmValue}>{currentAccount?.name}</Text>
                    </View>

                    <View style={styles.confirmDivider} />

                    <View style={styles.confirmRow}>
                        <Text style={styles.confirmLabel}>接收账户</Text>
                        <Text style={styles.confirmValue}>{receiverAccount}</Text>
                    </View>

                    <View style={styles.confirmDivider} />

                    <View style={styles.confirmRow}>
                        <Text style={styles.confirmLabel}>转账代币</Text>
                        <Text style={styles.confirmValue}>{selectedAsset.symbol}</Text>
                    </View>

                    <View style={styles.confirmDivider} />

                    <View style={styles.confirmRow}>
                        <Text style={styles.confirmLabel}>转账金额</Text>
                        <Text style={styles.confirmValue}>{amount} {selectedAsset.symbol}</Text>
                    </View>

                    <View style={styles.confirmDivider} />

                    <View style={styles.confirmRow}>
                        <Text style={styles.confirmLabel}>可用余额</Text>
                        <Text style={styles.confirmValue}>{formatBalance(availableBalance)} {selectedAsset.symbol}</Text>
                    </View>

                    <View style={styles.confirmDivider} />

                    <View style={styles.confirmRow}>
                        <Text style={styles.confirmLabel}>{CORE_ASSET_SYMBOL}余额</Text>
                        <Text style={styles.confirmValue}>{formatBalance(coreAssetBalance)} {CORE_ASSET_SYMBOL}</Text>
                    </View>

                    {memo ? (
                        <>
                            <View style={styles.confirmDivider} />
                            <View style={styles.confirmRow}>
                                <Text style={styles.confirmLabel}>备注</Text>
                                <Text style={[styles.confirmValue, { maxWidth: 200 }]} numberOfLines={2}>
                                    {memo}
                                </Text>
                            </View>
                        </>
                    ) : null}

                    <View style={styles.confirmButtons}>
                        <TouchableOpacity
                            style={styles.cancelButton}
                            onPress={() => setShowConfirmModal(false)}
                        >
                            <Text style={styles.cancelButtonText}>取消</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.submitButton}
                            onPress={handleSubmit}
                        >
                            <Text style={styles.submitButtonText}>确认提交</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

            {renderHeader()}

            <KeyboardAvoidingView
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* 发送者 */}
                    <View style={styles.formGroup}>
                        <Text style={styles.formLabel}>发送者</Text>
                        <View style={styles.readOnlyInput}>
                            <Text style={styles.readOnlyText}>
                                {currentAccount?.name || '未登录'}
                            </Text>
                        </View>
                    </View>

                    {/* 转账代币 */}
                    <View style={styles.formGroup}>
                        <Text style={styles.formLabel}>转账代币</Text>
                        <TouchableOpacity
                            style={styles.assetSelector}
                            onPress={() => setShowAssetPicker(true)}
                        >
                            <View style={[styles.assetIcon, { backgroundColor: selectedAsset.color }]}>
                                <Text style={styles.assetIconText}>{selectedAsset.symbol.charAt(0)}</Text>
                            </View>
                            <View style={styles.assetSelectorInfo}>
                                <Text style={styles.assetSelectorText}>{selectedAsset.symbol}</Text>
                                <Text style={styles.assetSelectorBalance}>
                                    可用: {formatBalance(selectedAsset.available)}
                                </Text>
                            </View>
                            <Icon name="chevron-down" size={20} color="#888888" />
                        </TouchableOpacity>
                    </View>

                    {/* 接收账户 */}
                    <View style={styles.formGroup}>
                        <Text style={styles.formLabel}>接收账户</Text>
                        <View style={styles.inputWrapper}>
                            <TextInput
                                style={styles.input}
                                value={receiverAccount}
                                onChangeText={setReceiverAccount}
                                placeholder="请输入接收账户名"
                                placeholderTextColor="#666666"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            {isCheckingReceiver && (
                                <Text style={styles.checkingText}>验证中...</Text>
                            )}
                            {!isCheckingReceiver && receiverValid === true && (
                                <Icon name="check-circle" size={20} color="#00D094" style={styles.inputIcon} />
                            )}
                            {!isCheckingReceiver && receiverValid === false && (
                                <Icon name="close-circle" size={20} color="#FF4757" style={styles.inputIcon} />
                            )}
                            <TouchableOpacity onPress={handlePaste}>
                                <Text style={styles.pasteButton}>粘贴</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* 转账金额 */}
                    <View style={styles.formGroup}>
                        <Text style={styles.formLabel}>转账金额</Text>
                        <View style={styles.inputWrapper}>
                            <TextInput
                                style={[styles.input, styles.amountInput]}
                                value={amount}
                                onChangeText={handleAmountChange}
                                placeholder="0.00"
                                placeholderTextColor="#666666"
                                keyboardType="decimal-pad"
                                autoCorrect={false}
                                autoComplete="off"
                                textContentType="none"
                                inputMode="decimal"
                            />
                            <TouchableOpacity
                                style={styles.allButton}
                                onPress={handleSetAllAmount}
                            >
                                <Text style={styles.allButtonText}>全部</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* 备注 */}
                    <View style={styles.formGroup}>
                        <Text style={styles.formLabel}>备注（可选）</Text>
                        <View style={styles.inputWrapper}>
                            <TextInput
                                style={styles.input}
                                value={memo}
                                onChangeText={setMemo}
                                placeholder="输入备注信息"
                                placeholderTextColor="#666666"
                                autoCapitalize="none"
                            />
                        </View>
                    </View>

                    {/* 余额信息 */}
                    <View style={styles.balanceInfo}>
                        <View style={styles.balanceRow}>
                            <Text style={styles.balanceLabel}>可用余额</Text>
                            <Text style={styles.balanceValue}>
                                {formatBalance(availableBalance)} {selectedAsset.symbol}
                            </Text>
                        </View>
                        <View style={[styles.balanceRow, styles.balanceRowLast]}>
                            <Text style={styles.balanceLabel}>{CORE_ASSET_SYMBOL}余额（手续费）</Text>
                            <Text style={styles.balanceValue}>{formatBalance(coreAssetBalance)} {CORE_ASSET_SYMBOL}</Text>
                        </View>
                    </View>

                    {/* 确认转账按钮 */}
                    <TouchableOpacity
                        style={styles.confirmButton}
                        onPress={handleConfirmPress}
                    >
                        <Text style={styles.confirmButtonText}>确认转账</Text>
                    </TouchableOpacity>

                    {/* 操作提示 */}
                    <View style={styles.tipContainer}>
                        <Icon name="information-outline" size={18} color="#F7931A" />
                        <View style={styles.tipContent}>
                            <Text style={styles.tipTitle}>操作提示</Text>
                            <Text style={styles.tipText}>
                                此操作为区块链上实时操作，一旦确认转账资金将实时达到对方账户。属于不可逆操作，请仔细核对收款账户信息及金额信息。
                            </Text>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            {renderAssetPicker()}
            {renderConfirmModal()}
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0D0D0D',
    },
    keyboardView: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingBottom: 20,
    },

    // 头部
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#1A1A1A',
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    headerRight: {
        width: 40,
    },

    // 表单
    formGroup: {
        marginBottom: 20,
    },
    formLabel: {
        fontSize: 14,
        color: '#888888',
        marginBottom: 8,
    },
    readOnlyInput: {
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    readOnlyText: {
        fontSize: 16,
        color: '#FFFFFF',
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        paddingHorizontal: 16,
    },
    input: {
        flex: 1,
        fontSize: 16,
        color: '#FFFFFF',
        paddingVertical: 16,
    },
    amountInput: {
        fontSize: 24,
        fontWeight: '600',
    },
    inputIcon: {
        marginRight: 8,
    },
    checkingText: {
        fontSize: 12,
        color: '#888888',
        marginRight: 8,
    },
    pasteButton: {
        fontSize: 14,
        color: '#2196F3',
        fontWeight: '500',
    },
    allButton: {
        backgroundColor: '#2196F3',
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    allButtonText: {
        fontSize: 14,
        color: '#FFFFFF',
        fontWeight: '500',
    },

    // 资产选择器
    assetSelector: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    assetIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    assetIconText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#FFFFFF',
    },
    assetSelectorInfo: {
        flex: 1,
    },
    assetSelectorText: {
        fontSize: 16,
        color: '#FFFFFF',
    },
    assetSelectorBalance: {
        fontSize: 12,
        color: '#888888',
        marginTop: 2,
    },

    // 余额信息
    balanceInfo: {
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    balanceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#2A2A2A',
    },
    balanceRowLast: {
        borderBottomWidth: 0,
    },
    balanceLabel: {
        fontSize: 14,
        color: '#888888',
    },
    balanceValue: {
        fontSize: 14,
        color: '#FFFFFF',
    },

    // 确认按钮
    confirmButton: {
        backgroundColor: '#F7931A',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
        marginBottom: 16,
    },

    // 操作提示
    tipContainer: {
        flexDirection: 'row',
        backgroundColor: 'rgba(247, 147, 26, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(247, 147, 26, 0.3)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    tipContent: {
        flex: 1,
        marginLeft: 12,
    },
    tipTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#F7931A',
        marginBottom: 4,
    },
    tipText: {
        fontSize: 12,
        color: '#888888',
        lineHeight: 18,
    },
    confirmButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#0D0D0D',
    },

    // 弹窗遮罩
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'flex-end',
    },

    // 资产选择器弹窗
    assetPickerContainer: {
        backgroundColor: '#1A1A1A',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingTop: 20,
        paddingBottom: 40,
        maxHeight: '60%',
    },
    assetPickerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#FFFFFF',
        textAlign: 'center',
        marginBottom: 20,
    },
    assetPickerList: {
        paddingHorizontal: 20,
    },
    assetPickerItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#2A2A2A',
    },
    assetPickerItemInfo: {
        flex: 1,
        marginLeft: 12,
    },
    assetPickerItemText: {
        fontSize: 16,
        color: '#FFFFFF',
    },
    assetPickerItemBalance: {
        fontSize: 12,
        color: '#888888',
        marginTop: 2,
    },

    // 确认弹窗
    confirmModalContainer: {
        backgroundColor: '#1A1A1A',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingTop: 20,
        paddingHorizontal: 20,
        paddingBottom: 40,
    },
    confirmModalTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#FFFFFF',
        textAlign: 'center',
        marginBottom: 24,
    },
    confirmRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
    },
    confirmLabel: {
        fontSize: 14,
        color: '#888888',
    },
    confirmValue: {
        fontSize: 14,
        color: '#FFFFFF',
        fontWeight: '500',
    },
    confirmDivider: {
        height: 1,
        backgroundColor: '#2A2A2A',
    },
    confirmButtons: {
        flexDirection: 'row',
        marginTop: 24,
        gap: 12,
    },
    cancelButton: {
        flex: 1,
        backgroundColor: '#333333',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    submitButton: {
        flex: 1,
        backgroundColor: '#F7931A',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    submitButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#0D0D0D',
    },
});

export default TransferScreen;
