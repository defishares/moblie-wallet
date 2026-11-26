/**
 * 设置页面
 * 提供生物认证设置、清除缓存和查看版本号等功能
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Alert,
  ActivityIndicator,
  Switch,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Clipboard,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList, VersionCheckResult, ApiNodeInfo, NodeTestResult } from '../types';
import { localCacheManager, secureStorageService, chainServiceMgr, unlockSession } from '../services';
import { useAccountStore } from '../store/useAccountStore';
import { useMarketStore } from '../store/useMarketStore';
import { useApiNodeStore } from '../store/useApiNodeStore';
import { checkAppVersion } from '../store/useChainConfigStore';
import { showVersionUpdateAlert } from '../utils';
import { Toast, ActionSheet } from '../components';
import type { BiometricType } from '../types';
import { APP_VERSION, isAnnouncementAdmin } from '../config/constants';

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { currentAccount, logout, removeAccount } = useAccountStore();
  const [isClearing, setIsClearing] = useState(false);

  // 生物认证相关状态
  const [biometricType, setBiometricType] = useState<BiometricType>('None');
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);

  // PIN 验证弹窗状态
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [showPinCode, setShowPinCode] = useState(false);
  const [pinError, setPinError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [pinModalPurpose, setPinModalPurpose] = useState<'enableBiometric' | 'deleteAccount'>('enableBiometric');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // 版本检测状态
  const [versionCheckResult, setVersionCheckResult] = useState<VersionCheckResult | null>(null);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    versionTapCount.current = 0;
    return () => {
      if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
      versionTapCount.current = 0;
    };
  }, [currentAccount?.id, currentAccount?.name]);

  // API 节点相关状态
  const {
    autoSelect,
    selectedNodeId,
    customNodes,
    builtinNodes,
    chainNodes,
    currentConnectedUrl,
    setAutoSelect,
    selectNode,
    addCustomNode,
    removeCustomNode,
    testNode,
    loadSettings: loadApiNodeSettings,
    getAllNodes,
  } = useApiNodeStore();

  // API 节点弹窗状态
  const [showApiNodeModal, setShowApiNodeModal] = useState(false);
  const [showAddNodeModal, setShowAddNodeModal] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeUrl, setNewNodeUrl] = useState('');
  const [isTestingNode, setIsTestingNode] = useState(false);
  const [nodeTestResult, setNodeTestResult] = useState<NodeTestResult | null>(null);
  const [isAddingNode, setIsAddingNode] = useState(false);
  const [isSwitchingNode, setIsSwitchingNode] = useState(false);
  const [switchingNodeId, setSwitchingNodeId] = useState<string | null>(null);

  // 用于记录当前操作的节点（切换时使用）
  const actionTargetNodeRef = React.useRef<ApiNodeInfo | null>(null);

  const initializeBiometricState = useCallback(async () => {
    if (!currentAccount?.id) return;

    try {
      const type = await secureStorageService.getSupportedBiometricType();
      setBiometricType(type);

      const enabled = await secureStorageService.isBiometricsEnabled(currentAccount.id);
      setBiometricsEnabled(enabled);

      console.log(`[Settings] 生物认证状态 - 设备支持: ${type}, 账号已启用: ${enabled}`);
    } catch (error) {
      console.error('[Settings] 获取生物认证状态失败:', error);
    }
  }, [currentAccount?.id]);

  // 初始化生物认证状态
  useEffect(() => {
    initializeBiometricState();
  }, [initializeBiometricState]);

  // 检查版本更新
  useEffect(() => {
    const result = checkAppVersion();
    setVersionCheckResult(result);
  }, []);

  // 初始化加载节点设置
  useEffect(() => {
    loadApiNodeSettings();
  }, [loadApiNodeSettings]);

  // 获取生物认证显示名称
  const getBiometricDisplayName = (): string => {
    // Android devices may temporarily report no currently available strong
    // biometric (for example after a system security lock). Keep the settings
    // entry understandable while the user resolves the system state.
    if (biometricType === 'None' && Platform.OS === 'android') {
      return '指纹识别';
    }
    return secureStorageService.getBiometricDisplayName(biometricType);
  };

  // 获取生物认证图标
  const getBiometricIcon = (): string => {
    switch (biometricType) {
      case 'FaceID':
        return 'face-recognition';
      case 'TouchID':
      case 'Fingerprint':
        return 'fingerprint';
      case 'Iris':
        return 'eye-outline';
      default:
        return Platform.OS === 'android' ? 'fingerprint' : 'lock-outline';
    }
  };

  // 处理版本更新点击
  const handleVersionPress = () => {
    if (!versionCheckResult || !versionCheckResult.hasUpdate) {
      return; // 已是最新版，不处理点击
    }
    showVersionUpdateAlert(versionCheckResult);
  };

  // 获取版本状态显示文本
  const getVersionStatusText = (): string => {
    if (!versionCheckResult) {
      return `v${APP_VERSION}`;
    }
    if (versionCheckResult.hasUpdate) {
      return `v${APP_VERSION} (有更新)`;
    }
    return `v${APP_VERSION} (已是最新版本)`;
  };

  // 连续点击版本号 5 次进入隐藏公告管理
  const handleVersionTap = () => {
    if (!isAnnouncementAdmin(currentAccount)) {
      versionTapCount.current = 0;
      if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
      handleVersionPress();
      return;
    }
    versionTapCount.current += 1;
    if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
    if (versionTapCount.current >= 5) {
      versionTapCount.current = 0;
      navigation.navigate('AnnouncementAdmin');
      return;
    }
    // 等待连续点击结束，避免更新提示打断管理员的五次点击。
    versionTapTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
      handleVersionPress();
    }, 1800);
  };

  // 使用已建立的一小时解锁会话启用生物认证；只有没有会话时才要求输入 PIN。
  const enableBiometricWithKeys = async (keys: { [key: string]: string | undefined }) => {
    if (!currentAccount?.id) return;

    setIsVerifying(true);
    setPinError('');
    try {
      const enrollment = await secureStorageService.enableBiometricStorageWithResult(
        currentAccount.id,
        keys
      );

      if (enrollment.success) {
        setBiometricsEnabled(true);
        setShowPinModal(false);
        setPinCode('');
        Toast.success(`${getBiometricDisplayName()}已开启`);
      } else {
        setPinError(enrollment.error || '启用生物认证失败，请重试');
        Toast.error(enrollment.error || '启用生物认证失败，请重试');
      }
    } catch (error) {
      console.error('[Settings] 启用生物认证失败:', error);
      setPinError('操作失败，请重试');
    } finally {
      setIsVerifying(false);
    }
  };

  // 切换生物认证
  const handleToggleBiometric = async (newValue: boolean) => {
    if (!currentAccount?.id || isVerifying || isBiometricLoading) return;

    if (newValue) {
      // Re-check when the user taps the switch. A previous result may have
      // reflected Samsung's temporary strong-auth lock rather than hardware.
      if (biometricType === 'None') {
        setIsBiometricLoading(true);
        try {
          const detectedType = await secureStorageService.getSupportedBiometricType();
          setBiometricType(detectedType);
          if (detectedType === 'None') {
            Alert.alert(
              '暂时无法使用指纹',
              '请先用手机锁屏密码解锁一次，并确认已在系统设置中录入指纹，然后返回这里重试。',
            );
            return;
          }
        } finally {
          setIsBiometricLoading(false);
        }
      }

      // 启用生物认证 - 需要先验证 PIN 码获取私钥
      const cachedKeys = unlockSession.getKeys(currentAccount.id);
      if (cachedKeys) {
        await enableBiometricWithKeys(cachedKeys);
        return;
      }
      setPinModalPurpose('enableBiometric');
      setShowPinModal(true);
    } else {
      // 禁用生物认证
      Alert.alert(
        '关闭' + getBiometricDisplayName(),
        `确定要关闭${getBiometricDisplayName()}解锁吗？关闭后需要使用 PIN 码解锁。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确定',
            style: 'destructive',
            onPress: async () => {
              setIsBiometricLoading(true);
              try {
                const success = await secureStorageService.disableBiometricStorage(currentAccount.id);
                if (success) {
                  setBiometricsEnabled(false);
                  Toast.warning(`${getBiometricDisplayName()}已关闭`);
                } else {
                  Toast.error('操作失败，请重试');
                }
              } catch (error) {
                console.error('[Settings] 禁用生物认证失败:', error);
                Toast.error('操作失败，请重试');
              } finally {
                setIsBiometricLoading(false);
              }
            },
          },
        ]
      );
    }
  };

  // 完成注销账号：清除设备上的密钥和账号记录
  const finalizeAccountDeletion = async () => {
    if (!currentAccount?.id || isDeletingAccount) return;

    setIsDeletingAccount(true);
    try {
      const accountId = currentAccount.id;
      const cleared = await secureStorageService.clearAccountSecureData(accountId);
      if (!cleared) {
        setPinError('清除账号安全数据失败，请重试');
        return;
      }

      await removeAccount(accountId);
      setShowPinModal(false);
      setPinCode('');
      setPinError('');

      const nextAccount = useAccountStore.getState().currentAccount;
      navigation.reset({
        index: 0,
        routes: [{ name: nextAccount ? 'MainTabs' : 'Login' }],
      });
    } catch (error) {
      console.error('[Settings] 注销账号失败:', error);
      setPinError('注销账号失败，请重试');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  // 重要操作身份验证：优先使用指纹/面容，失败后使用 PIN
  const authenticateAccountDeletion = async () => {
    if (!currentAccount?.id || isDeletingAccount) return;

    if (unlockSession.isActive(currentAccount.id)) {
      await finalizeAccountDeletion();
      return;
    }

    if (biometricsEnabled && biometricType !== 'None') {
      setIsBiometricLoading(true);
      try {
        const result = await secureStorageService.retrieveAllKeysWithBiometric(currentAccount.id);
        if (result.success) {
          await finalizeAccountDeletion();
          return;
        }
      } catch (error) {
        console.warn('[Settings] 注销账号生物认证失败:', error);
      } finally {
        setIsBiometricLoading(false);
      }
    }

    setPinModalPurpose('deleteAccount');
    setPinError('');
    setShowPinModal(true);
  };

  // 注销账号入口
  const handleDeleteAccount = () => {
    if (!currentAccount) return;

    Alert.alert(
      '重要操作提示',
      `注销账号将从此设备移除“${currentAccount.name}”及其私钥，且无法恢复。链上账号不会被删除，请确认继续。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '继续注销', style: 'destructive', onPress: authenticateAccountDeletion },
      ],
    );
  };

  // 退出登录（保留设备上的账号和密钥）
  const handleLogout = () => {
    Alert.alert('退出登录', '退出后仍可在登录页选择此账号重新登录。', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出登录',
        style: 'destructive',
        onPress: async () => {
          await logout();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
  };

  // 验证 PIN 并执行当前操作
  const handleVerifyPin = async () => {
    if (isVerifying) return;
    if (!currentAccount?.id) {
      setPinError('请输入 PIN 码');
      return;
    }

    const cachedKeys = unlockSession.getKeys(currentAccount.id);
    if (!pinCode && !cachedKeys) {
      setPinError('请输入 PIN 码');
      return;
    }

    setIsVerifying(true);
    setPinError('');

    try {
      // 1. 使用 PIN 解密获取私钥
      const result = cachedKeys
        ? { success: true, keys: cachedKeys }
        : await secureStorageService.retrieveAllKeysWithPin(currentAccount.id, pinCode);

      if (!result.success || !result.keys) {
        setPinError(result.error || 'PIN 码错误');
        setIsVerifying(false);
        return;
      }

      if (pinModalPurpose === 'deleteAccount') {
        await finalizeAccountDeletion();
        return;
      }

      // 启用生物认证存储
      await enableBiometricWithKeys(result.keys);
    } catch (error) {
      console.error('[Settings] 启用生物认证失败:', error);
      setPinError('操作失败，请重试');
    } finally {
      setIsVerifying(false);
    }
  };

  // 关闭 PIN 验证弹窗
  const closePinModal = () => {
    setShowPinModal(false);
    setPinCode('');
    setPinError('');
    setShowPinCode(false);
    setPinModalPurpose('enableBiometric');
  };

  // ============================================
  // API 节点相关处理函数
  // ============================================

  // 获取当前选中的节点显示文本
  const getApiNodeDisplayText = (): string => {
    if (autoSelect) {
      return '自动选择';
    }
    const selectedNode = getAllNodes().find(n => n.id === selectedNodeId);
    if (selectedNode) {
      return selectedNode.name;
    }
    return '未设置';
  };

  // 获取当前连接状态显示
  const getConnectionStatusText = (): string => {
    if (currentConnectedUrl) {
      const connectedNode = getAllNodes().find(n => n.url === currentConnectedUrl);
      if (connectedNode) {
        return `已连接: ${connectedNode.name}`;
      }
      return `已连接: ${currentConnectedUrl}`;
    }
    return '未连接';
  };

  // 判断某个节点是否是当前选中的
  const isNodeSelected = (node: ApiNodeInfo): boolean => {
    if (autoSelect) return false;
    return selectedNodeId === node.id;
  };

  // 判断某个节点是否已连接
  const isNodeConnected = (node: ApiNodeInfo): boolean => {
    return currentConnectedUrl === node.url;
  };

  // 点击自动选择
  const handleAutoSelectClick = async () => {
    if (isSwitchingNode) return;

    // 如果已经是自动选择模式，不做任何操作
    if (autoSelect) return;

    setIsSwitchingNode(true);
    setSwitchingNodeId('auto');

    try {
      // 切换到自动选择模式
      await setAutoSelect(true);

      // 自动选择第一个可用节点
      const allNodes = getAllNodes();
      if (allNodes.length > 0) {
        const firstNode = allNodes[0];
        const success = await chainServiceMgr.switchNode(firstNode.url);
        if (success) {
          useApiNodeStore.getState().setCurrentConnectedUrl(firstNode.url);
        }
      }
    } catch (error) {
      console.error('[Settings] 切换自动选择失败:', error);
      Alert.alert('错误', '切换失败，请重试');
    } finally {
      setIsSwitchingNode(false);
      setSwitchingNodeId(null);
    }
  };

  // 点击节点 - 弹出操作菜单
  const handleNodeClick = (node: ApiNodeInfo) => {
    if (isSwitchingNode) return;

    // 保存当前操作的节点
    actionTargetNodeRef.current = node;

    // 构建操作列表
    const actions: Array<{
      key: string;
      label: string;
      icon: string;
      danger?: boolean;
      onPress: () => void;
    }> = [
        {
          key: 'switch',
          label: '切换到该节点',
          icon: 'swap-horizontal',
          onPress: handleSwitchToNode,
        },
        {
          key: 'copy',
          label: '复制链接',
          icon: 'content-copy',
          onPress: handleCopyNodeUrl,
        },
      ];

    // 自定义节点添加删除选项（链动态节点不可删除）
    if (!node.isBuiltin && !node.isChainNode) {
      actions.push({
        key: 'delete',
        label: '删除节点',
        icon: 'delete-outline',
        danger: true,
        onPress: handleDeleteNodeFromAction,
      });
    }

    ActionSheet.show({
      title: node.name,
      subtitle: node.url,
      actions,
    });
  };

  // 切换到指定节点
  const handleSwitchToNode = async () => {
    const node = actionTargetNodeRef.current;
    if (!node || isSwitchingNode) return;

    setSwitchingNodeId(node.id);
    setIsSwitchingNode(true);

    try {
      // 先切换连接
      const success = await chainServiceMgr.switchNode(node.url);
      if (success) {
        // 连接成功后才更新选择状态
        await setAutoSelect(false);
        await selectNode(node.id);
        useApiNodeStore.getState().setCurrentConnectedUrl(node.url);
        Toast.success(`已切换到节点: ${node.name}`);
      } else {
        Alert.alert('连接失败', `无法连接到节点: ${node.name}，请检查网络或尝试其他节点。`);
      }
    } catch (error) {
      console.error('[Settings] 切换节点失败:', error);
      Alert.alert('错误', '切换节点失败，请重试');
    } finally {
      setIsSwitchingNode(false);
      setSwitchingNodeId(null);
    }
  };

  // 复制节点链接
  const handleCopyNodeUrl = () => {
    const node = actionTargetNodeRef.current;
    if (!node) return;
    Clipboard.setString(node.url);
    Toast.success('链接已复制');
  };

  // 删除自定义节点（从操作菜单）
  const handleDeleteNodeFromAction = () => {
    const node = actionTargetNodeRef.current;
    if (!node) return;

    Alert.alert(
      '删除节点',
      `确定要删除节点 "${node.name}" 吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              // 检查是否是当前选中的节点
              const isCurrentSelected = !autoSelect && selectedNodeId === node.id;

              await removeCustomNode(node.id);

              // 如果删除的是当前选中的节点，自动切换为自动选择
              if (isCurrentSelected) {
                await setAutoSelect(true);
                Toast.success('节点已删除，已切换为自动选择');
              } else {
                Toast.success('节点已删除');
              }
            } catch (error) {
              console.error('[Settings] 删除节点失败:', error);
              Alert.alert('错误', '删除节点失败');
            }
          },
        },
      ]
    );
  };

  // 打开添加节点弹窗
  const openAddNodeModal = () => {
    setNewNodeName('');
    setNewNodeUrl('');
    setNodeTestResult(null);
    setShowAddNodeModal(true);
  };

  // 关闭添加节点弹窗
  const closeAddNodeModal = () => {
    setShowAddNodeModal(false);
    setNewNodeName('');
    setNewNodeUrl('');
    setNodeTestResult(null);
    setIsTestingNode(false);
    setIsAddingNode(false);
  };

  // 测试节点连接
  const handleTestNode = async () => {
    if (!newNodeUrl.trim()) {
      Alert.alert('提示', '请输入节点 URL');
      return;
    }

    // 验证 URL 格式
    if (!newNodeUrl.startsWith('ws://') && !newNodeUrl.startsWith('wss://')) {
      Alert.alert('提示', '请输入有效的 WebSocket URL（以 ws:// 或 wss:// 开头）');
      return;
    }

    setIsTestingNode(true);
    setNodeTestResult(null);

    try {
      const result = await testNode(newNodeUrl.trim());
      setNodeTestResult(result);
      if (!result.success) {
        Alert.alert('测试失败', result.error || '无法连接到该节点');
      }
    } catch (error: any) {
      setNodeTestResult({ success: false, error: error.message || '测试失败' });
      Alert.alert('测试失败', error.message || '无法连接到该节点');
    } finally {
      setIsTestingNode(false);
    }
  };

  // 添加自定义节点
  const handleAddNode = async () => {
    if (!newNodeName.trim()) {
      Alert.alert('提示', '请输入节点名称');
      return;
    }
    if (!newNodeUrl.trim()) {
      Alert.alert('提示', '请输入节点 URL');
      return;
    }

    // 验证 URL 格式
    if (!newNodeUrl.startsWith('ws://') && !newNodeUrl.startsWith('wss://')) {
      Alert.alert('提示', '请输入有效的 WebSocket URL（以 ws:// 或 wss:// 开头）');
      return;
    }

    // 如果没有测试或测试失败，先测试
    if (!nodeTestResult || !nodeTestResult.success) {
      Alert.alert('提示', '请先测试节点连接');
      return;
    }

    setIsAddingNode(true);

    try {
      const success = await addCustomNode(newNodeName.trim(), newNodeUrl.trim());
      if (success) {
        Alert.alert('成功', '节点添加成功');
        closeAddNodeModal();
      } else {
        Alert.alert('添加失败', '该节点 URL 已存在');
      }
    } catch (error) {
      console.error('[Settings] 添加节点失败:', error);
      Alert.alert('错误', '添加节点失败，请重试');
    } finally {
      setIsAddingNode(false);
    }
  };

  // 渲染节点列表项（官方/自定义节点）
  const renderNodeItem = (node: ApiNodeInfo) => {
    const isSelected = isNodeSelected(node);
    const isConnected = isNodeConnected(node);
    const isCurrentlySwitching = switchingNodeId === node.id;

    return (
      <TouchableOpacity
        key={node.id}
        style={[styles.nodeItem, isSelected && styles.nodeItemSelected]}
        onPress={() => handleNodeClick(node)}
        disabled={isSwitchingNode}
        activeOpacity={0.7}
      >
        {/* Radio 按钮 */}
        <View style={styles.radioContainer}>
          {isCurrentlySwitching ? (
            <ActivityIndicator size="small" color="#00D094" />
          ) : (
            <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
              {isSelected && <View style={styles.radioInner} />}
            </View>
          )}
        </View>

        {/* 节点信息 */}
        <View style={styles.nodeItemContent}>
          <View style={styles.nodeItemHeader}>
            <Text style={styles.nodeItemName}>{node.name}</Text>
            {node.isChainNode && (
              <View style={styles.customBadge}>
                <Text style={styles.customBadgeText}>动态</Text>
              </View>
            )}
            {!node.isBuiltin && !node.isChainNode && (
              <View style={styles.customBadge}>
                <Text style={styles.customBadgeText}>自定义</Text>
              </View>
            )}
            {isConnected && (
              <View style={styles.connectedBadge}>
                <Text style={styles.connectedBadgeText}>已连接</Text>
              </View>
            )}
          </View>
          <Text style={styles.nodeItemUrl} numberOfLines={1}>{node.url}</Text>
        </View>

        {/* 更多操作 */}
        <Icon name="chevron-right" size={20} color="#666666" />
      </TouchableOpacity>
    );
  };

  const officialBuiltinNodes = builtinNodes.filter(node => node.group !== 'community');
  const communityBuiltinNodes = builtinNodes.filter(node => node.group === 'community');

  // 清除本地缓存
  const handleClearCache = () => {
    Alert.alert(
      '清除缓存',
      '确定要清除所有本地缓存数据吗？此操作不可恢复。',
      [
        {
          text: '取消',
          style: 'cancel',
        },
        {
          text: '确定',
          style: 'destructive',
          onPress: async () => {
            setIsClearing(true);
            try {
              const success = localCacheManager.clearAll();
              if (success) {
                // 同步清理内存中的自定义交易对和收藏，避免清缓存后当前页面仍显示旧数据。
                useMarketStore.getState().reset();
                Alert.alert('成功', '本地缓存已清除');
              } else {
                Alert.alert('错误', '清除缓存失败，请重试');
              }
            } catch (error) {
              console.error('[Settings] 清除缓存失败:', error);
              Alert.alert('错误', '清除缓存失败，请重试');
            } finally {
              setIsClearing(false);
            }
          },
        },
      ],
    );
  };

  // 渲染设置项
  const renderSettingItem = (
    icon: string,
    title: string,
    subtitle?: string,
    onPress?: () => void,
    showArrow: boolean = true,
    rightContent?: React.ReactNode,
    titleColor?: string,
  ) => (
    <TouchableOpacity
      style={styles.settingItem}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={styles.settingItemLeft}>
        <View style={styles.settingIconContainer}>
          <Icon name={icon} size={22} color="#FFFFFF" />
        </View>
        <View style={styles.settingTextContainer}>
          <Text style={[styles.settingTitle, titleColor ? { color: titleColor } : null]}>{title}</Text>
          {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
        </View>
      </View>
      <View style={styles.settingItemRight}>
        {rightContent}
        {showArrow && <Icon name="chevron-right" size={24} color="#666666" />}
      </View>
    </TouchableOpacity>
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
        <Text style={styles.headerTitle}>设置</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 账号操作 */}
        {currentAccount && (
          <View style={styles.settingsSection}>
            <Text style={styles.sectionTitle}>账号</Text>
            <View style={styles.settingsList}>
              {renderSettingItem(
                'logout',
                '退出登录',
                '保留账号和密钥，下次可继续登录',
                handleLogout,
                true,
              )}
              <View style={styles.divider} />
              {renderSettingItem(
                'account-remove-outline',
                '注销账号',
                '从此设备移除账号及私钥，无法恢复',
                handleDeleteAccount,
                true,
                undefined,
                '#FF6B6B',
              )}
            </View>
          </View>
        )}

        {/* 应用设置 */}
        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>应用设置</Text>
          <View style={styles.settingsList}>
            {/* API 接入点 */}
            {renderSettingItem(
              'server-network',
              'API接入点',
              getConnectionStatusText(),
              () => setShowApiNodeModal(true),
              true,
              <Text style={styles.apiNodeText}>{getApiNodeDisplayText()}</Text>,
            )}

            {/* 分隔线 */}
            <View style={styles.divider} />

            {/* 联系人 TODO:TBD 暂时不开启，storage item 还有问题 */}
            {/* {currentAccount && renderSettingItem(
              'account-multiple',
              '联系人',
              '管理链上联系人地址',
              () => navigation.navigate('ContactList', undefined),
              true,
            )} */}
          </View>
        </View>

        {/* 安全设置 */}
        {currentAccount && (
          <View style={styles.settingsSection}>
            <Text style={styles.sectionTitle}>安全设置</Text>
            <View style={styles.settingsList}>
              {/* 生物认证开关 */}
              <View style={styles.settingItem}>
                <View style={styles.settingItemLeft}>
                  <View style={[styles.settingIconContainer, { backgroundColor: '#00D09420' }]}>
                    <Icon name={getBiometricIcon()} size={22} color="#00D094" />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingTitle}>{getBiometricDisplayName()}解锁</Text>
                    <Text style={styles.settingSubtitle}>
                      {biometricsEnabled
                        ? '已开启'
                        : biometricType === 'None'
                          ? '点击开关检测并开启指纹解锁'
                          : '使用' + getBiometricDisplayName() + '快速解锁'}
                    </Text>
                  </View>
                </View>
                <View style={styles.settingItemRight}>
                  {isBiometricLoading ? (
                    <ActivityIndicator size="small" color="#00D094" style={styles.loadingIndicator} />
                  ) : (
                    <Switch
                      value={biometricsEnabled}
                      onValueChange={handleToggleBiometric}
                      trackColor={{ false: '#333333', true: '#00D094' }}
                      thumbColor="#FFFFFF"
                    />
                  )}
                </View>
              </View>
            </View>
          </View>
        )}

        {/* 其他设置 */}
        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>其他</Text>
          <View style={styles.settingsList}>
            {/* 清除缓存 */}
            {renderSettingItem(
              'trash-can-outline',
              '清除本地缓存',
              '清除所有本地存储的数据',
              handleClearCache,
              true,
              isClearing ? (
                <ActivityIndicator size="small" color="#00D094" style={styles.loadingIndicator} />
              ) : null,
            )}

            {/* 分隔线 */}
            <View style={styles.divider} />

            {/* 版本号 */}
            {renderSettingItem(
              'information-outline',
              '版本号',
              undefined,
              handleVersionTap,
              false,
              <Text style={[
                styles.versionText,
                versionCheckResult?.hasUpdate && styles.versionUpdateText,
              ]}>
                {getVersionStatusText()}
              </Text>,
            )}

            {/* 分隔线 */}
            <View style={styles.divider} />

            {/* 关于 */}
            {renderSettingItem(
              'information-variant',
              '关于',
              undefined,
              () => navigation.navigate('About'),
              true,
            )}
          </View>
        </View>
      </ScrollView>

      {/* API 节点设置弹窗 */}
      <Modal
        visible={showApiNodeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowApiNodeModal(false)}
      >
        <View style={styles.apiModalOverlay}>
          <View style={styles.apiModalContent}>
            {/* 弹窗头部 */}
            <View style={styles.apiModalHeader}>
              <Text style={styles.apiModalTitle}>API接入点</Text>
              <TouchableOpacity
                style={styles.apiModalCloseButton}
                onPress={() => setShowApiNodeModal(false)}
              >
                <Icon name="close" size={24} color="#888888" />
              </TouchableOpacity>
            </View>

            {/* 节点列表 */}
            <ScrollView style={styles.nodeList} showsVerticalScrollIndicator={false}>
              {/* 自动选择节点 */}
              <Text style={styles.nodeGroupTitle}>自动选择</Text>
              <TouchableOpacity
                style={[styles.nodeItem, autoSelect && styles.nodeItemSelected]}
                onPress={handleAutoSelectClick}
                disabled={isSwitchingNode}
                activeOpacity={0.7}
              >
                <View style={styles.radioContainer}>
                  {switchingNodeId === 'auto' ? (
                    <ActivityIndicator size="small" color="#00D094" />
                  ) : (
                    <View style={[styles.radioOuter, autoSelect && styles.radioOuterSelected]}>
                      {autoSelect && <View style={styles.radioInner} />}
                    </View>
                  )}
                </View>
                <View style={styles.nodeItemContent}>
                  <View style={styles.nodeItemHeader}>
                    <Text style={styles.nodeItemName}>自动选择节点</Text>
                  </View>
                  <Text style={styles.nodeItemUrl}>启动时自动选择最快的可用节点</Text>
                </View>
              </TouchableOpacity>

              {/* 官方节点 */}
              <Text style={styles.nodeGroupTitle}>官方节点</Text>
              {officialBuiltinNodes.map(node => renderNodeItem(node))}

              {/* 社区节点 */}
              {communityBuiltinNodes.length > 0 && (
                <>
                  <Text style={styles.nodeGroupTitle}>社区节点</Text>
                  {communityBuiltinNodes.map(node => renderNodeItem(node))}
                </>
              )}

              {/* 链动态节点 */}
              {chainNodes.length > 0 && (
                <>
                  <Text style={styles.nodeGroupTitle}>动态节点</Text>
                  {chainNodes.map(node => renderNodeItem(node))}
                </>
              )}

              {/* 自定义节点 */}
              <Text style={styles.nodeGroupTitle}>自定义节点</Text>
              {customNodes.length > 0 ? (
                customNodes.map(node => renderNodeItem(node))
              ) : (
                <Text style={styles.emptyNodeHint}>暂无自定义节点</Text>
              )}
            </ScrollView>

            {/* 添加自定义节点按钮 */}
            <TouchableOpacity
              style={styles.addNodeButton}
              onPress={openAddNodeModal}
            >
              <Icon name="plus" size={20} color="#00D094" />
              <Text style={styles.addNodeButtonText}>添加自定义节点</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 添加节点弹窗 */}
      <Modal
        visible={showAddNodeModal}
        transparent
        animationType="fade"
        onRequestClose={closeAddNodeModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>添加自定义节点</Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={closeAddNodeModal}>
                <Icon name="close" size={24} color="#888888" />
              </TouchableOpacity>
            </View>

            {/* 节点名称输入 */}
            <Text style={styles.inputLabel}>节点名称</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.textInput}
                value={newNodeName}
                onChangeText={setNewNodeName}
                placeholder="例如：我的节点"
                placeholderTextColor="#666666"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isAddingNode}
              />
            </View>

            {/* 节点 URL 输入 */}
            <Text style={styles.inputLabel}>节点 URL</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.textInput}
                value={newNodeUrl}
                onChangeText={(text) => {
                  setNewNodeUrl(text);
                  setNodeTestResult(null);
                }}
                placeholder="ws:// 或 wss://"
                placeholderTextColor="#666666"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!isAddingNode}
              />
            </View>

            {/* 测试结果显示 */}
            {nodeTestResult && (
              <View style={[
                styles.testResultContainer,
                nodeTestResult.success ? styles.testResultSuccess : styles.testResultError,
              ]}>
                <Icon
                  name={nodeTestResult.success ? 'check-circle' : 'alert-circle'}
                  size={16}
                  color={nodeTestResult.success ? '#00D094' : '#FF6B6B'}
                />
                <Text style={[
                  styles.testResultText,
                  nodeTestResult.success ? styles.testResultTextSuccess : styles.testResultTextError,
                ]}>
                  {nodeTestResult.success
                    ? `连接成功，延迟: ${nodeTestResult.latency}ms`
                    : nodeTestResult.error || '连接失败'
                  }
                </Text>
              </View>
            )}

            {/* 按钮组 */}
            <View style={styles.addNodeButtons}>
              <TouchableOpacity
                style={[styles.testButton, isTestingNode && styles.buttonDisabled]}
                onPress={handleTestNode}
                disabled={isTestingNode || isAddingNode}
              >
                {isTestingNode ? (
                  <ActivityIndicator size="small" color="#00D094" />
                ) : (
                  <Text style={styles.testButtonText}>测试连接</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.addButton,
                  (!nodeTestResult?.success || isAddingNode) && styles.buttonDisabled,
                ]}
                onPress={handleAddNode}
                disabled={!nodeTestResult?.success || isAddingNode}
              >
                {isAddingNode ? (
                  <ActivityIndicator size="small" color="#0D0D0D" />
                ) : (
                  <Text style={styles.addButtonText}>添加</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* PIN 验证弹窗 */}
      <Modal
        visible={showPinModal}
        transparent
        animationType="fade"
        onRequestClose={closePinModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>验证身份</Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={closePinModal}>
                <Icon name="close" size={24} color="#888888" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {pinModalPurpose === 'deleteAccount'
                ? '请输入 PIN 码以确认注销账号'
                : `请输入 PIN 码以启用${getBiometricDisplayName()}`}
            </Text>

            <View style={styles.pinInputContainer}>
              <TextInput
                style={styles.pinInput}
                value={pinCode}
                onChangeText={(text) => {
                  setPinCode(text);
                  setPinError('');
                }}
                placeholder="输入 PIN 码"
                placeholderTextColor="#666666"
                secureTextEntry={!showPinCode}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isVerifying}
                onSubmitEditing={handleVerifyPin}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => setShowPinCode(!showPinCode)}
              >
                <Icon
                  name={showPinCode ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color="#888888"
                />
              </TouchableOpacity>
            </View>

            {pinError ? (
              <View style={styles.pinErrorContainer}>
                <Icon name="alert-circle-outline" size={16} color="#FF6B6B" />
                <Text style={styles.pinErrorText}>{pinError}</Text>
              </View>
            ) : null}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={closePinModal}
                disabled={isVerifying}
              >
                <Text style={styles.modalCancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmButton,
                  (!pinCode || isVerifying) && styles.modalButtonDisabled,
                ]}
                onPress={handleVerifyPin}
                disabled={!pinCode || isVerifying}
              >
                {isVerifying ? (
                  <ActivityIndicator color="#0D0D0D" size="small" />
                ) : (
                  <Text style={styles.modalConfirmButtonText}>确认</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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

  // 设置分组
  settingsSection: {
    marginTop: 20,
    marginHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    color: '#888888',
    marginBottom: 8,
    marginLeft: 4,
    fontWeight: '500',
  },
  sectionTitleAdmin: {
    fontSize: 13,
    color: '#F5A623',
    marginBottom: 8,
    marginLeft: 4,
    fontWeight: '500',
  },

  // 设置列表样式
  settingsList: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  settingItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#2D2D2D',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  settingSubtitle: {
    fontSize: 12,
    color: '#888888',
    marginTop: 2,
  },
  settingItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#2D2D2D',
    marginLeft: 64,
  },
  versionText: {
    fontSize: 14,
    color: '#888888',
    marginRight: 4,
  },
  versionUpdateText: {
    color: '#00D094',
  },
  loadingIndicator: {
    marginRight: 8,
  },

  // PIN 验证弹窗样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 340,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalCloseButton: {
    position: 'absolute',
    right: 0,
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 20,
  },
  pinInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 12,
    backgroundColor: '#0D0D0D',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  pinInput: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    paddingVertical: 14,
  },
  toggleButton: {
    padding: 8,
  },
  pinErrorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  pinErrorText: {
    fontSize: 13,
    color: '#FF6B6B',
    marginLeft: 8,
    flex: 1,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: '#333333',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalConfirmButton: {
    flex: 1,
    backgroundColor: '#00D094',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalConfirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0D0D0D',
  },
  modalButtonDisabled: {
    backgroundColor: '#333333',
  },

  // API 节点设置文本
  apiNodeText: {
    fontSize: 14,
    color: '#00D094',
    marginRight: 4,
  },

  // API 节点模态框样式
  apiModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  apiModalContent: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 34,
    maxHeight: '80%',
  },
  apiModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D2D',
    position: 'relative',
  },
  apiModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  apiModalCloseButton: {
    position: 'absolute',
    right: 16,
    padding: 4,
  },

  // 节点列表
  nodeList: {
    maxHeight: 400,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  nodeGroupTitle: {
    fontSize: 13,
    color: '#888888',
    marginTop: 16,
    marginBottom: 8,
    fontWeight: '500',
  },
  nodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2D2D2D',
  },
  nodeItemSelected: {
    borderColor: '#00D094',
    backgroundColor: 'rgba(0, 208, 148, 0.05)',
  },
  nodeItemContent: {
    flex: 1,
    marginRight: 8,
  },
  nodeItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  nodeItemName: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  nodeItemUrl: {
    fontSize: 12,
    color: '#888888',
  },
  emptyNodeHint: {
    fontSize: 13,
    color: '#666666',
    textAlign: 'center',
    paddingVertical: 16,
  },

  // Radio 按钮样式
  radioContainer: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#666666',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOuterSelected: {
    borderColor: '#00D094',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00D094',
  },

  // 节点标签
  customBadge: {
    backgroundColor: '#2D2D2D',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  customBadgeText: {
    fontSize: 10,
    color: '#888888',
  },
  connectedBadge: {
    backgroundColor: 'rgba(0, 208, 148, 0.15)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  connectedBadgeText: {
    fontSize: 10,
    color: '#00D094',
  },

  // 添加节点按钮
  addNodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(0, 208, 148, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00D094',
    borderStyle: 'dashed',
  },
  addNodeButtonText: {
    fontSize: 15,
    color: '#00D094',
    fontWeight: '500',
    marginLeft: 6,
  },

  // 添加节点表单
  inputLabel: {
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 8,
    marginTop: 16,
  },
  inputContainer: {
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333333',
  },
  textInput: {
    fontSize: 16,
    color: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  testResultContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  testResultSuccess: {
    backgroundColor: 'rgba(0, 208, 148, 0.1)',
  },
  testResultError: {
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
  },
  testResultText: {
    fontSize: 13,
    marginLeft: 8,
    flex: 1,
  },
  testResultTextSuccess: {
    color: '#00D094',
  },
  testResultTextError: {
    color: '#FF6B6B',
  },
  addNodeButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  testButton: {
    flex: 1,
    backgroundColor: '#333333',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addButton: {
    flex: 1,
    backgroundColor: '#00D094',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0D0D0D',
  },
  buttonDisabled: {
    backgroundColor: '#333333',
  },
});

export default SettingsScreen;
