/**
 * API 节点状态管理
 * 管理 API 接入点的选择、自动连接和自定义节点
 */

import { create } from 'zustand';
import { CURRENT_NETWORK } from '../config';
import { localCacheManager } from '../services';
import type { ApiNodeInfo, ApiNodeSettings, NodeTestResult } from '../types';
import { WsNodeConfig } from '../config/constants';

// 默认节点 ID 前缀
const BUILTIN_NODE_PREFIX = 'builtin_';
const CHAIN_NODE_PREFIX = 'chain_';

/**
 * 根据内置节点列表生成 ApiNodeInfo 数组
 */
const generateBuiltinNodes = (): ApiNodeInfo[] => {
  return CURRENT_NETWORK.wsNodes.map((node, index) => ({
    id: `${BUILTIN_NODE_PREFIX}${index}`,
    name: node.name,
    url: node.url,
    isBuiltin: true,
    isChainNode: false,
  }));
};

/**
 * 根据链动态节点列表生成 ApiNodeInfo 数组
 */
const generateChainNodes = (chainNodes: WsNodeConfig[]): ApiNodeInfo[] => {
  return chainNodes.map((node, index) => ({
    id: `${CHAIN_NODE_PREFIX}${index}`,
    name: node.name,
    url: node.url,
    isBuiltin: false,
    isChainNode: true,
  }));
};

// API 节点状态接口
interface ApiNodeState {
  // ========== 状态 ==========
  isLoaded: boolean;                    // 是否已加载设置
  autoSelect: boolean;                  // 是否自动选择节点
  selectedNodeId: string | null;        // 选中的节点 ID
  customNodes: ApiNodeInfo[];           // 自定义节点列表
  builtinNodes: ApiNodeInfo[];          // 内置节点列表
  chainNodes: ApiNodeInfo[];            // 链动态节点列表
  currentConnectedUrl: string | null;   // 当前连接的节点 URL
  isConnecting: boolean;                // 是否正在连接
  userNodeFailCount: number;            // 用户节点连续失败次数

  // ========== Actions ==========
  // 初始化
  loadSettings: () => Promise<void>;

  // 设置操作
  setAutoSelect: (value: boolean) => Promise<void>;
  selectNode: (nodeId: string) => Promise<void>;

  // 自定义节点操作
  addCustomNode: (name: string, url: string) => Promise<boolean>;
  removeCustomNode: (nodeId: string) => Promise<boolean>;
  updateCustomNode: (nodeId: string, name: string, url: string) => Promise<boolean>;

  // 链动态节点操作
  setChainNodes: (nodes: WsNodeConfig[]) => void;

  // 节点测试
  testNode: (url: string) => Promise<NodeTestResult>;

  // 连接操作
  setCurrentConnectedUrl: (url: string | null) => void;
  setIsConnecting: (value: boolean) => void;

  // 用户节点失败计数
  incrementUserNodeFailCount: () => number;
  resetUserNodeFailCount: () => void;

  // 获取所有节点
  getAllNodes: () => ApiNodeInfo[];

  // 获取内置节点（WsNodeConfig 格式）
  getBuiltinNodesConfig: () => WsNodeConfig[];

  // 获取链动态节点（WsNodeConfig 格式）
  getChainNodesConfig: () => WsNodeConfig[];

  // 获取用户自定义节点（WsNodeConfig 格式）
  getCustomNodesConfig: () => WsNodeConfig[];

  // 获取当前选中的节点
  getSelectedNode: () => ApiNodeInfo | null;

  // 获取应该使用的节点 URL（用于连接）
  getNodeUrlToConnect: () => string;
}

// 生成唯一 ID
const generateUUID = (): string => {
  return 'custom_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// 创建 Store
export const useApiNodeStore = create<ApiNodeState>((set, get) => ({
  // ========== 初始状态 ==========
  isLoaded: false,
  autoSelect: true,
  selectedNodeId: null,
  customNodes: [],
  builtinNodes: generateBuiltinNodes(),
  chainNodes: [],
  currentConnectedUrl: null,
  isConnecting: false,
  userNodeFailCount: 0,

  // ========== 初始化 ==========
  loadSettings: async () => {
    try {
      // 从内存同步读取（数据已在 localCacheManager.initialize() 时加载）
      const settings = localCacheManager.loadApiNodeSettings();
      const chainWsNodes = localCacheManager.loadChainWsNodes();

      if (settings) {
        set({
          autoSelect: settings.autoSelect,
          selectedNodeId: settings.selectedNodeId,
          customNodes: settings.customNodes,
          chainNodes: generateChainNodes(chainWsNodes),
          isLoaded: true,
        });
        console.log('[ApiNodeStore] 已加载节点设置');
      } else {
        // 使用默认设置
        set({
          chainNodes: generateChainNodes(chainWsNodes),
          isLoaded: true,
        });
        console.log('[ApiNodeStore] 使用默认节点设置');
      }
    } catch (error) {
      console.error('[ApiNodeStore] 加载节点设置失败:', error);
      set({ isLoaded: true });
    }
  },

  // ========== 设置操作 ==========
  setAutoSelect: async (value: boolean) => {
    const { customNodes, selectedNodeId } = get();
    set({ autoSelect: value });

    // 保存设置（同步写入内存和磁盘）
    localCacheManager.saveApiNodeSettings({
      autoSelect: value,
      selectedNodeId,
      customNodes,
    });
    console.log('[ApiNodeStore] 自动选择设置已更新:', value);
  },

  selectNode: async (nodeId: string) => {
    const { customNodes, autoSelect } = get();
    set({ selectedNodeId: nodeId });

    // 保存设置（同步写入内存和磁盘）
    localCacheManager.saveApiNodeSettings({
      autoSelect,
      selectedNodeId: nodeId,
      customNodes,
    });
    console.log('[ApiNodeStore] 已选择节点:', nodeId);
  },

  // ========== 自定义节点操作 ==========
  addCustomNode: async (name: string, url: string) => {
    const { customNodes, autoSelect, selectedNodeId } = get();

    // 检查 URL 是否已存在
    const allNodes = get().getAllNodes();
    if (allNodes.some(node => node.url === url)) {
      console.log('[ApiNodeStore] 节点 URL 已存在');
      return false;
    }

    const newNode: ApiNodeInfo = {
      id: generateUUID(),
      name,
      url,
      isBuiltin: false,
    };

    const newCustomNodes = [...customNodes, newNode];
    set({ customNodes: newCustomNodes });

    // 保存设置（同步写入内存和磁盘）
    localCacheManager.saveApiNodeSettings({
      autoSelect,
      selectedNodeId,
      customNodes: newCustomNodes,
    });

    console.log('[ApiNodeStore] 已添加自定义节点:', name, url);
    return true;
  },

  removeCustomNode: async (nodeId: string) => {
    const { customNodes, autoSelect, selectedNodeId } = get();

    const newCustomNodes = customNodes.filter(node => node.id !== nodeId);

    // 如果删除的是当前选中的节点，重置选择
    let newSelectedNodeId = selectedNodeId;
    if (selectedNodeId === nodeId) {
      newSelectedNodeId = null;
    }

    set({
      customNodes: newCustomNodes,
      selectedNodeId: newSelectedNodeId,
    });

    // 保存设置（同步写入内存和磁盘）
    localCacheManager.saveApiNodeSettings({
      autoSelect,
      selectedNodeId: newSelectedNodeId,
      customNodes: newCustomNodes,
    });

    console.log('[ApiNodeStore] 已删除自定义节点:', nodeId);
    return true;
  },

  updateCustomNode: async (nodeId: string, name: string, url: string) => {
    const { customNodes, autoSelect, selectedNodeId, builtinNodes } = get();

    // 检查 URL 是否已被其他节点使用
    const otherNodes = [...builtinNodes, ...customNodes.filter(n => n.id !== nodeId)];
    if (otherNodes.some(node => node.url === url)) {
      console.log('[ApiNodeStore] 节点 URL 已被使用');
      return false;
    }

    const newCustomNodes = customNodes.map(node =>
      node.id === nodeId ? { ...node, name, url } : node
    );

    set({ customNodes: newCustomNodes });

    // 保存设置（同步写入内存和磁盘）
    localCacheManager.saveApiNodeSettings({
      autoSelect,
      selectedNodeId,
      customNodes: newCustomNodes,
    });

    console.log('[ApiNodeStore] 已更新自定义节点:', nodeId);
    return true;
  },

  // ========== 链动态节点操作 ==========
  setChainNodes: (nodes: WsNodeConfig[]) => {
    // 保存到本地缓存
    localCacheManager.saveChainWsNodes(nodes);
    // 更新状态
    set({ chainNodes: generateChainNodes(nodes) });
    console.log('[ApiNodeStore] 已更新链动态节点:', nodes.length);
  },

  // ========== 节点测试 ==========
  testNode: async (url: string): Promise<NodeTestResult> => {
    // 动态导入以避免循环依赖
    const { chainServiceMgr } = await import('../services/chainservice_mgr');
    return chainServiceMgr.testNodeConnection(url);
  },

  // ========== 连接操作 ==========
  setCurrentConnectedUrl: (url: string | null) => {
    set({ currentConnectedUrl: url });
  },

  setIsConnecting: (value: boolean) => {
    set({ isConnecting: value });
  },

  // ========== 用户节点失败计数 ==========
  incrementUserNodeFailCount: () => {
    const { userNodeFailCount } = get();
    const newCount = userNodeFailCount + 1;
    set({ userNodeFailCount: newCount });
    console.log(`[ApiNodeStore] 用户节点连续失败次数: ${newCount}`);
    return newCount;
  },

  resetUserNodeFailCount: () => {
    set({ userNodeFailCount: 0 });
  },

  // ========== 获取节点 ==========
  getAllNodes: () => {
    const { builtinNodes, chainNodes, customNodes } = get();
    return [...builtinNodes, ...chainNodes, ...customNodes];
  },

  // 获取内置节点（WsNodeConfig 格式）
  getBuiltinNodesConfig: (): WsNodeConfig[] => {
    return CURRENT_NETWORK.wsNodes;
  },

  // 获取链动态节点（WsNodeConfig 格式）
  getChainNodesConfig: (): WsNodeConfig[] => {
    return localCacheManager.loadChainWsNodes();
  },

  // 获取用户自定义节点（WsNodeConfig 格式）
  getCustomNodesConfig: (): WsNodeConfig[] => {
    const { customNodes } = get();
    return customNodes.map(node => ({
      name: node.name,
      url: node.url,
    }));
  },

  getSelectedNode: () => {
    const { selectedNodeId, builtinNodes, chainNodes, customNodes } = get();
    if (!selectedNodeId) return null;

    const allNodes = [...builtinNodes, ...chainNodes, ...customNodes];
    return allNodes.find(node => node.id === selectedNodeId) || null;
  },

  getNodeUrlToConnect: () => {
    const { autoSelect, builtinNodes } = get();
    const selectedNode = get().getSelectedNode();

    if (autoSelect || !selectedNode) {
      // 自动选择模式，返回第一个内置节点
      return builtinNodes[0]?.url || CURRENT_NETWORK.defaultWsNode;
    }

    return selectedNode.url;
  },
}));

export default useApiNodeStore;

