/**
 * 币种图标工具函数
 * 提供币种图标加载和颜色计算功能
 */

import { ImageSourcePropType } from 'react-native';

// 定义一组用于圆圈背景的颜色
const COIN_COLORS = [
  '#F7931A', // 橙色 (Bitcoin 风格)
  '#627EEA', // 紫蓝色 (Ethereum 风格)
  '#26A17B', // 绿色 (Tether 风格)
  '#F3BA2F', // 金黄色 (Binance 风格)
  '#E84142', // 红色
  '#2775CA', // 蓝色
  '#8247E5', // 紫色
  '#00D395', // 青绿色
  '#FF6B6B', // 珊瑚红
  '#4ECDC4', // 薄荷绿
  '#45B7D1', // 天蓝色
  '#96CEB4', // 淡绿色
  '#FFEAA7', // 淡黄色
  '#DDA0DD', // 梅红色
  '#98D8C8', // 薄荷色
  '#F7DC6F', // 柠檬黄
];

// 支持的币种图标映射（全部小写作为 key）
const COIN_ICONS: Record<string, ImageSourcePropType> = {
  dfs: require('../assets/icon/coins/DFS.png'),
  aave: require('../assets/icon/coins/AAVE.png'),
  ada: require('../assets/icon/coins/ADA.png'),
  bnb: require('../assets/icon/coins/BNB.png'),
  btc: require('../assets/icon/coins/BTC.png'),
  doge: require('../assets/icon/coins/DOGE.png'),
  ena: require('../assets/icon/coins/ENA.png'),
  eth: require('../assets/icon/coins/ETH.png'),
  link: require('../assets/icon/coins/LINK.png'),
  ltc: require('../assets/icon/coins/LTC.png'),
  pump: require('../assets/icon/coins/PUMP.png'),
  sol: require('../assets/icon/coins/SOL.png'),
  sui: require('../assets/icon/coins/SUI.png'),
  trx: require('../assets/icon/coins/TRX.png'),
  usdt: require('../assets/icon/coins/USDT.png'),
  wlfi: require('../assets/icon/coins/WLFI.png'),
  xlm: require('../assets/icon/coins/XLM.png'),
  xrp: require('../assets/icon/coins/XRP.png'),
  zec: require('../assets/icon/coins/ZEC.png'),
  pinetwork: require('../assets/icon/coins/PINETWORK.png'),
};

/**
 * 根据资产名字计算固定的颜色
 * 使用简单的哈希算法确保同一资产总是映射到同一颜色
 * @param assetName 资产名称
 * @returns 颜色值
 */
export function getColorForAsset(assetName: string): string {
  const name = assetName.toLowerCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为32位整数
  }
  const index = Math.abs(hash) % COIN_COLORS.length;
  return COIN_COLORS[index];
}

/**
 * 获取币种图标（如果存在）
 * @param assetName 资产名称（不区分大小写）
 * @returns 图标源，如果不存在则返回 null
 */
export function getCoinIcon(assetName: string): ImageSourcePropType | null {
  const key = assetName.toLowerCase();
  return COIN_ICONS[key] || null;
}

/**
 * 检查是否有对应的币种图标
 * @param assetName 资产名称（不区分大小写）
 * @returns 是否有图标
 */
export function hasCoinIcon(assetName: string): boolean {
  const key = assetName.toLowerCase();
  return key in COIN_ICONS;
}
