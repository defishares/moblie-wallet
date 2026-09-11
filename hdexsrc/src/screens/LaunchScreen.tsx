/**
 * 启动页组件
 * 应用启动时显示，用于初始化数据
 * 数据加载完成后自动跳转到主页
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Easing,
  StatusBar,
  Alert,
  Image,
} from 'react-native';
import { Text } from '@rneui/themed';
import { useAppStore } from '../store/useAppStore';
import { useAccountStore } from '../store/useAccountStore';
import { useApiNodeStore } from '../store/useApiNodeStore';
import { checkAppVersion } from '../store/useChainConfigStore';
import { chainServiceMgr, localCacheManager } from '../services';
import {
  showVersionUpdateAlert,
  mergeAndDeduplicateNodes,
  pingAndSortNodes,
} from '../utils';
import { CURRENT_NETWORK } from '../config';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList, SortedNodeInfo } from '../types';
import { WsNodeConfig } from '../config/constants';

// 定义导航属性类型
type LaunchScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Launch'
>;

interface LaunchScreenProps {
  navigation: LaunchScreenNavigationProp;
}

// 加载阶段枚举
type LoadingStage = 'init' | 'pinging' | 'connecting' | 'loading_chain' | 'finalizing';

// 用户节点最大连续失败次数，超过后切换到自动选择模式
const MAX_USER_NODE_FAIL_COUNT = 3;

// Ping 超时时间（毫秒）
const PING_TIMEOUT = 3000;

const LaunchScreen: React.FC<LaunchScreenProps> = ({ navigation }) => {
  // 从 store 获取状态和方法
  const { isInitialized, initializeApp } = useAppStore();
  const { loadAccounts, currentAccount, isLoaded: accountsLoaded } = useAccountStore();
  const loadApiNodeSettings = useApiNodeStore(state => state.loadSettings);
  const setCurrentConnectedUrl = useApiNodeStore(state => state.setCurrentConnectedUrl);
  const setChainNodes = useApiNodeStore(state => state.setChainNodes);
  const getBuiltinNodesConfig = useApiNodeStore(state => state.getBuiltinNodesConfig);
  const getChainNodesConfig = useApiNodeStore(state => state.getChainNodesConfig);
  const getCustomNodesConfig = useApiNodeStore(state => state.getCustomNodesConfig);
  const autoSelect = useApiNodeStore(state => state.autoSelect);
  const setAutoSelect = useApiNodeStore(state => state.setAutoSelect);
  const getSelectedNode = useApiNodeStore(state => state.getSelectedNode);
  const incrementUserNodeFailCount = useApiNodeStore(state => state.incrementUserNodeFailCount);
  const resetUserNodeFailCount = useApiNodeStore(state => state.resetUserNodeFailCount);

  // 链初始化状态
  const [chainInitialized, setChainInitialized] = useState(false);
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('init');

  // 版本检测状态
  const [versionCheckDone, setVersionCheckDone] = useState(false);

  // 排序后的节点列表（用于自动选择模式的重试）
  const sortedNodesRef = useRef<SortedNodeInfo[]>([]);

  // 动画值 - 使用 useRef 避免重新创建
  const spinValue = useRef(new Animated.Value(0)).current;

  /**
   * 显示错误弹窗
   */
  const showErrorAlert = useCallback((onRetry: () => void) => {
    Alert.alert(
      '连接失败',
      '无法连接到区块链网络，请检查网络连接后重试。',
      [
        {
          text: '重试',
          onPress: onRetry,
        },
      ],
      { cancelable: false }
    );
  }, []);

  /**
   * 自动选择模式：遍历排序后的节点列表依次尝试连接
   * @param sortedNodes 排序后的节点列表
   * @param skipPing 是否跳过 ping（重试时使用）
   * @returns 连接成功返回节点 URL，全部失败返回 null
   */
  const connectWithAutoSelect = useCallback(async (
    sortedNodes: SortedNodeInfo[],
  ): Promise<string | null> => {
    console.log('[Launch] 自动选择模式，依次尝试连接...');

    for (let i = 0; i < sortedNodes.length; i++) {
      const node = sortedNodes[i];
      // 跳过 ping 失败的节点（latency 为 Infinity）
      if (node.latency === Infinity) {
        console.log(`[Launch] 跳过 ping 失败的节点: ${node.name} (${node.url})`);
        continue;
      }

      console.log(`[Launch] 尝试连接节点 ${i + 1}/${sortedNodes.length}: ${node.name} (${node.url}), 延迟: ${node.latency}ms`);

      try {
        const success = await chainServiceMgr.initChain(node.url);
        if (success) {
          console.log(`[Launch] 成功连接到节点: ${node.name}`);
          return node.url;
        }
      } catch (error) {
        console.log(`[Launch] 连接节点失败: ${node.name}`, error);
      }
    }

    // 所有有效节点都失败了，再尝试 ping 失败的节点（可能网络恢复了）
    for (const node of sortedNodes) {
      if (node.latency !== Infinity) continue;

      console.log(`[Launch] 尝试之前 ping 失败的节点: ${node.name} (${node.url})`);
      try {
        const success = await chainServiceMgr.initChain(node.url);
        if (success) {
          console.log(`[Launch] 成功连接到节点: ${node.name}`);
          return node.url;
        }
      } catch (error) {
        console.log(`[Launch] 连接节点失败: ${node.name}`, error);
      }
    }

    return null;
  }, []);

  /**
   * 用户选择模式：直接连接用户指定的节点
   * @param nodeUrl 用户选择的节点 URL
   * @returns 连接是否成功
   */
  const connectWithUserNode = useCallback(async (nodeUrl: string): Promise<boolean> => {
    console.log(`[Launch] 用户选择模式，连接到: ${nodeUrl}`);
    try {
      const success = await chainServiceMgr.initChain(nodeUrl);
      if (success) {
        resetUserNodeFailCount();
        return true;
      }
      return false;
    } catch (error) {
      console.error('[Launch] 连接用户节点失败:', error);
      return false;
    }
  }, [resetUserNodeFailCount]);

  /**
   * 处理连接成功后的流程
   */
  const handleConnectionSuccess = useCallback(async (connectedUrl: string) => {
    setCurrentConnectedUrl(connectedUrl);
    setChainInitialized(true);

    // 从链上加载市场配置
    setLoadingStage('loading_chain');
    console.log('[Launch] 从链上加载市场配置...');

    // 初始化应用数据
    await initializeApp();

    // 获取链动态配置中的节点列表并保存
    const marketConfig = localCacheManager.loadMarketConfig();
    // TODO: 从 marketConfig 中提取 ws_nodes 并保存（当 useMarketStore 加载动态配置后）

    setLoadingStage('finalizing');

    // 检查版本更新
    const versionResult = checkAppVersion();
    if (versionResult && versionResult.hasUpdate) {
      console.log('[Launch] 发现新版本:', versionResult.latestVersion);
      showVersionUpdateAlert(versionResult, () => setVersionCheckDone(true));
    } else {
      setVersionCheckDone(true);
    }
  }, [initializeApp, setCurrentConnectedUrl]);

  /**
   * 自动选择模式的重试逻辑（不再 ping，直接从第一个开始尝试）
   */
  const retryAutoSelect = useCallback(async () => {
    setLoadingStage('connecting');

    const connectedUrl = await connectWithAutoSelect(sortedNodesRef.current);
    if (connectedUrl) {
      await handleConnectionSuccess(connectedUrl);
    } else {
      // 全部失败，继续弹框
      showErrorAlert(retryAutoSelect);
    }
  }, [connectWithAutoSelect, handleConnectionSuccess, showErrorAlert]);

  /**
   * 用户选择模式的重试逻辑
   */
  const retryUserNode = useCallback(async () => {
    const selectedNode = getSelectedNode();
    if (!selectedNode) {
      // 用户节点不存在，切换到自动选择
      console.log('[Launch] 用户节点不存在，切换到自动选择模式');
      await setAutoSelect(true);
      retryAutoSelect();
      return;
    }

    setLoadingStage('connecting');

    const success = await connectWithUserNode(selectedNode.url);
    if (success) {
      await handleConnectionSuccess(selectedNode.url);
    } else {
      // 失败，增加计数
      const failCount = incrementUserNodeFailCount();

      if (failCount >= MAX_USER_NODE_FAIL_COUNT) {
        // 连续失败达到阈值，自动切换到自动选择模式
        console.log(`[Launch] 用户节点连续失败 ${failCount} 次，自动切换到自动选择模式`);
        await setAutoSelect(true);
        resetUserNodeFailCount();

        // 需要重新获取节点并 ping
        await initChainConnection();
      } else {
        // 弹框让用户重试
        showErrorAlert(retryUserNode);
      }
    }
  }, [
    getSelectedNode,
    setAutoSelect,
    connectWithUserNode,
    handleConnectionSuccess,
    incrementUserNodeFailCount,
    resetUserNodeFailCount,
    showErrorAlert,
  ]);

  /**
   * 初始化区块链连接（主入口）
   */
  const initChainConnection = useCallback(async () => {
    setLoadingStage('init');

    try {
      // 0. 初始化本地缓存管理器
      await localCacheManager.initialize();
      console.log('[Launch] 本地缓存初始化完成');

      // 1. 加载本地账号数据和节点设置
      loadAccounts();
      loadApiNodeSettings();
      console.log('[Launch] 账号数据和节点设置加载完成');

      // 2. 获取最新的节点设置
      const nodeStore = useApiNodeStore.getState();

      // 3. 根据模式选择连接方式
      if (!nodeStore.autoSelect) {
        // 用户选择模式
        const selectedNode = nodeStore.getSelectedNode();
        if (selectedNode) {
          setLoadingStage('connecting');
          const success = await connectWithUserNode(selectedNode.url);
          if (success) {
            await handleConnectionSuccess(selectedNode.url);
          } else {
            const failCount = incrementUserNodeFailCount();
            if (failCount >= MAX_USER_NODE_FAIL_COUNT) {
              console.log(`[Launch] 用户节点连续失败 ${failCount} 次，自动切换到自动选择模式`);
              await setAutoSelect(true);
              resetUserNodeFailCount();
              // 继续执行自动选择流程
            } else {
              showErrorAlert(retryUserNode);
              return;
            }
          }
        }
        // 如果没有选中节点或切换到自动模式，继续执行自动选择流程
        if (!nodeStore.autoSelect && nodeStore.getSelectedNode()) {
          return; // 已经在处理用户节点
        }
      }

      // 自动选择模式
      console.log('[Launch] 自动选择模式启动...');

      // 获取所有节点配置
      const builtinNodes = nodeStore.getBuiltinNodesConfig();
      const chainNodes = nodeStore.getChainNodesConfig();
      const customNodes = nodeStore.getCustomNodesConfig();

      // 合并去重
      const allNodes = mergeAndDeduplicateNodes(builtinNodes, chainNodes, customNodes);

      if (allNodes.length === 0) {
        // 没有节点，使用默认节点
        console.log('[Launch] 没有可用节点，使用默认节点');
        setLoadingStage('connecting');
        const success = await chainServiceMgr.initChain(CURRENT_NETWORK.defaultWsNode);
        if (success) {
          await handleConnectionSuccess(CURRENT_NETWORK.defaultWsNode);
        } else {
          showErrorAlert(() => initChainConnection());
        }
        return;
      }

      // Ping 所有节点
      setLoadingStage('pinging');
      console.log(`[Launch] 开始 ping ${allNodes.length} 个节点...`);
      const sortedNodes = await pingAndSortNodes(allNodes, PING_TIMEOUT);
      sortedNodesRef.current = sortedNodes;

      // 依次尝试连接
      setLoadingStage('connecting');
      const connectedUrl = await connectWithAutoSelect(sortedNodes);

      if (connectedUrl) {
        await handleConnectionSuccess(connectedUrl);
      } else {
        // 全部失败，弹框重试
        showErrorAlert(retryAutoSelect);
      }
    } catch (error) {
      console.error('[Launch] 链初始化异常:', error);
      showErrorAlert(() => initChainConnection());
    }
  }, [
    loadAccounts,
    loadApiNodeSettings,
    connectWithUserNode,
    handleConnectionSuccess,
    incrementUserNodeFailCount,
    setAutoSelect,
    resetUserNodeFailCount,
    showErrorAlert,
    retryUserNode,
    connectWithAutoSelect,
    retryAutoSelect,
  ]);

  // 启动旋转动画
  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [spinValue]);

  // 启动时初始化链连接
  useEffect(() => {
    initChainConnection();
  }, []);

  // 监听初始化完成，根据账号状态跳转
  useEffect(() => {
    if (chainInitialized && isInitialized && accountsLoaded && versionCheckDone) {
      const timer = setTimeout(() => {
        if (currentAccount) {
          console.log('[Launch] 已有登录账号，跳转到主页');
          navigation.replace('MainTabs');
        } else {
          console.log('[Launch] 无登录账号，跳转到登录页');
          navigation.replace('Login');
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [chainInitialized, isInitialized, accountsLoaded, currentAccount, navigation, versionCheckDone]);

  // 计算旋转角度
  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // 获取加载状态文本
  const getLoadingText = () => {
    switch (loadingStage) {
      case 'init':
        return '正在初始化...';
      case 'pinging':
        return '正在自动选择节点...';
      case 'connecting':
        return '正在连接区块链...';
      case 'loading_chain':
        return '正在加载数据...';
      case 'finalizing':
        return '即将完成...';
      default:
        return '正在加载...';
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      {/* Logo 区域 */}
      <View style={styles.logoContainer}>
        <View style={styles.logoIcon}>
          <Image
            source={require('../assets/defishares-icon.png')}
            style={styles.logoImage}
            resizeMode="cover"
          />
        </View>
        <Text style={styles.appName}>Defishares</Text>
        <Text style={styles.tagline}>数字资产交易平台</Text>
      </View>

      {/* 加载指示器 */}
      <View style={styles.loadingContainer}>
        <Animated.View
          style={[
            styles.spinner,
            { transform: [{ rotate: spin }] },
          ]}
        />
        <Text style={styles.loadingText}>{getLoadingText()}</Text>
      </View>

      {/* 底部版权信息 */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>© 2026 Defishares. All rights reserved.</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 60,
  },
  logoIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    marginBottom: 20,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  appName: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 4,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    color: '#666666',
    letterSpacing: 1,
  },
  loadingContainer: {
    alignItems: 'center',
  },
  spinner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: '#333333',
    borderTopColor: '#00D094',
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 14,
    color: '#888888',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
  },
  footerText: {
    fontSize: 12,
    color: '#444444',
  },
});

export default LaunchScreen;
