/**
 * 节点相关工具函数
 * 包含 ping 节点、排序节点等功能
 */

import type { PingResult, SortedNodeInfo } from '../types';
import { WsNodeConfig } from '../config/constants';

// 默认 ping 超时时间（毫秒）
const DEFAULT_PING_TIMEOUT = 5000;

/**
 * 将 WebSocket URL 转换为 HTTP URL 用于 ping
 * ws:// -> http://
 * wss:// -> https://
 */
function wsUrlToHttpUrl(wsUrl: string): string {
  if (wsUrl.startsWith('wss://')) {
    return wsUrl.replace('wss://', 'https://');
  }
  if (wsUrl.startsWith('ws://')) {
    return wsUrl.replace('ws://', 'http://');
  }
  return wsUrl;
}

/**
 * 使用 fetch HEAD 请求 ping 单个节点
 * @param url WebSocket URL
 * @param timeout 超时时间（毫秒）
 * @returns Promise<PingResult>
 */
export async function pingNode(url: string, timeout: number = DEFAULT_PING_TIMEOUT): Promise<PingResult> {
  const httpUrl = wsUrlToHttpUrl(url);
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // 使用 HEAD 请求，比 GET 更轻量
    // 注意：React Native 的 fetch 不支持 cache 选项
    await fetch(httpUrl, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    return {
      url,
      success: true,
      latency,
    };
  } catch (error: any) {
    const latency = Date.now() - startTime;

    // 如果是超时或网络错误，返回失败
    return {
      url,
      success: false,
      latency: Infinity,
      error: error.name === 'AbortError' ? '连接超时' : (error.message || '连接失败'),
    };
  }
}

/**
 * 并发 ping 多个节点
 * @param urls WebSocket URL 列表
 * @param timeout 单个节点超时时间（毫秒）
 * @returns Promise<PingResult[]> 所有节点的 ping 结果
 */
export async function pingNodes(urls: string[], timeout: number = DEFAULT_PING_TIMEOUT): Promise<PingResult[]> {
  if (urls.length === 0) {
    return [];
  }

  console.log(`[NodeUtils] 开始并发 ping ${urls.length} 个节点，超时: ${timeout}ms`);

  // 并发执行所有 ping 请求
  const results = await Promise.all(
    urls.map(url => pingNode(url, timeout))
  );

  // 统计成功和失败数量
  const successCount = results.filter(r => r.success).length;
  console.log(`[NodeUtils] Ping 完成: ${successCount}/${urls.length} 个节点可用`);

  return results;
}

/**
 * 按延迟排序节点列表
 * @param nodes 节点配置列表
 * @param pingResults ping 结果
 * @returns 排序后的节点列表（延迟从低到高）
 */
export function sortNodesByLatency(
  nodes: WsNodeConfig[],
  pingResults: PingResult[]
): SortedNodeInfo[] {
  // 创建 URL -> PingResult 的映射
  const resultMap = new Map<string, PingResult>();
  for (const result of pingResults) {
    resultMap.set(result.url, result);
  }

  // 将节点与延迟关联
  const nodesWithLatency: SortedNodeInfo[] = nodes.map(node => {
    const pingResult = resultMap.get(node.url);
    return {
      name: node.name,
      url: node.url,
      latency: pingResult?.success ? pingResult.latency : Infinity,
    };
  });

  // 按延迟排序（成功的在前，失败的在后）
  nodesWithLatency.sort((a, b) => a.latency - b.latency);

  return nodesWithLatency;
}

/**
 * Ping 并排序节点列表
 * 综合工具函数：ping 所有节点并按延迟排序返回
 * @param nodes 节点配置列表
 * @param timeout ping 超时时间（毫秒）
 * @returns Promise<SortedNodeInfo[]> 排序后的节点列表
 */
export async function pingAndSortNodes(
  nodes: WsNodeConfig[],
  timeout: number = DEFAULT_PING_TIMEOUT
): Promise<SortedNodeInfo[]> {
  if (nodes.length === 0) {
    return [];
  }

  // 提取 URL 列表
  const urls = nodes.map(n => n.url);

  // 并发 ping
  const pingResults = await pingNodes(urls, timeout);

  // 排序并返回
  const sortedNodes = sortNodesByLatency(nodes, pingResults);

  // 打印排序结果
  console.log('[NodeUtils] 节点排序结果:');
  sortedNodes.forEach((node, index) => {
    const latencyStr = node.latency === Infinity ? '失败' : `${node.latency}ms`;
    console.log(`  ${index + 1}. ${node.name} (${node.url}) - ${latencyStr}`);
  });

  return sortedNodes;
}

/**
 * 合并并去重节点列表
 * 按优先级：内置节点 > 链动态节点 > 用户自定义节点
 * 相同 URL 的节点只保留第一个
 * @param builtinNodes 内置节点
 * @param chainNodes 链动态节点
 * @param customNodes 用户自定义节点
 * @returns 去重后的节点列表
 */
export function mergeAndDeduplicateNodes(
  builtinNodes: WsNodeConfig[],
  chainNodes: WsNodeConfig[],
  customNodes: WsNodeConfig[]
): WsNodeConfig[] {
  const seenUrls = new Set<string>();
  const result: WsNodeConfig[] = [];

  // 依次处理三个列表，保持优先级
  const allNodes = [...builtinNodes, ...chainNodes, ...customNodes];

  for (const node of allNodes) {
    if (!seenUrls.has(node.url)) {
      seenUrls.add(node.url);
      result.push(node);
    }
  }

  console.log(`[NodeUtils] 合并节点: 内置${builtinNodes.length} + 链动态${chainNodes.length} + 自定义${customNodes.length} = ${result.length} (去重后)`);

  return result;
}

