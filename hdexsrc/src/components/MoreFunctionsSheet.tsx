/**
 * 更多功能底部弹窗
 * 网格布局的功能菜单，图标在上、名字在下
 * 类似微信/支付宝的底部功能面板
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// 每行显示的图标数量
const ITEMS_PER_ROW = 4;

// 功能项类型
export interface MoreFunctionItem {
  key: string;                    // 唯一标识
  label: string;                  // 显示文本
  icon: string;                   // 图标名称（MaterialCommunityIcons）
  iconColor?: string;             // 图标颜色
  iconBgColor?: string;           // 图标背景颜色
  onPress: () => void;            // 点击回调
}

// 配置类型
export interface MoreFunctionsConfig {
  title?: string;                 // 标题（可选）
  items: MoreFunctionItem[];      // 功能项列表
  cancelText?: string;            // 取消按钮文本，默认"取消"
  onCancel?: () => void;          // 取消回调
}

interface MoreFunctionsState extends MoreFunctionsConfig {
  visible: boolean;
}

// 管理器 - 全局单例
class MoreFunctionsManager {
  private static instance: MoreFunctionsManager;
  private showCallback: ((config: MoreFunctionsConfig) => void) | null = null;
  private hideCallback: (() => void) | null = null;

  static getInstance(): MoreFunctionsManager {
    if (!MoreFunctionsManager.instance) {
      MoreFunctionsManager.instance = new MoreFunctionsManager();
    }
    return MoreFunctionsManager.instance;
  }

  setCallbacks(
    showCallback: (config: MoreFunctionsConfig) => void,
    hideCallback: () => void
  ) {
    this.showCallback = showCallback;
    this.hideCallback = hideCallback;
  }

  show(config: MoreFunctionsConfig) {
    if (this.showCallback) {
      this.showCallback(config);
    }
  }

  hide() {
    if (this.hideCallback) {
      this.hideCallback();
    }
  }
}

export const moreFunctionsManager = MoreFunctionsManager.getInstance();

// 便捷方法
export const MoreFunctionsSheet = {
  show: (config: MoreFunctionsConfig) => {
    moreFunctionsManager.show(config);
  },
  hide: () => {
    moreFunctionsManager.hide();
  },
};

// 容器组件 - 需要在 App 顶层渲染
export const MoreFunctionsSheetContainer: React.FC = () => {
  const [state, setState] = useState<MoreFunctionsState>({
    visible: false,
    items: [],
  });

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const hideSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setState(prev => ({ ...prev, visible: false }));
    });
  }, [translateY, backdropOpacity]);

  const showSheet = useCallback((config: MoreFunctionsConfig) => {
    // 重置动画值
    translateY.setValue(SCREEN_HEIGHT);
    backdropOpacity.setValue(0);

    setState({
      visible: true,
      ...config,
    });

    // 显示动画
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateY, backdropOpacity]);

  useEffect(() => {
    moreFunctionsManager.setCallbacks(showSheet, hideSheet);
  }, [showSheet, hideSheet]);

  const handleCancel = () => {
    hideSheet();
    state.onCancel?.();
  };

  const handleItemPress = (item: MoreFunctionItem) => {
    hideSheet();
    // 延迟执行回调，让动画先完成
    setTimeout(() => {
      item.onPress();
    }, 100);
  };

  if (!state.visible) {
    return null;
  }

  // 将功能项分行
  const rows: MoreFunctionItem[][] = [];
  for (let i = 0; i < state.items.length; i += ITEMS_PER_ROW) {
    rows.push(state.items.slice(i, i + ITEMS_PER_ROW));
  }

  return (
    <Modal
      visible={state.visible}
      transparent
      animationType="none"
      onRequestClose={handleCancel}
    >
      <View style={styles.container}>
        {/* 背景遮罩 */}
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleCancel}
          />
        </Animated.View>

        {/* 内容区域 */}
        <Animated.View
          style={[
            styles.content,
            { transform: [{ translateY }] },
          ]}
        >
          {/* 顶部拖拽指示条 */}
          <View style={styles.dragIndicator} />

          {/* 标题 */}
          {state.title && (
            <Text style={styles.title}>{state.title}</Text>
          )}

          {/* 功能网格 */}
          <View style={styles.gridContainer}>
            {rows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.gridRow}>
                {row.map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={styles.gridItem}
                    onPress={() => handleItemPress(item)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.iconContainer,
                        item.iconBgColor ? { backgroundColor: item.iconBgColor } : null,
                      ]}
                    >
                      <Icon
                        name={item.icon}
                        size={28}
                        color={item.iconColor || '#FFFFFF'}
                      />
                    </View>
                    <Text style={styles.itemLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
                {/* 填充空白项以保持对齐 */}
                {row.length < ITEMS_PER_ROW &&
                  Array(ITEMS_PER_ROW - row.length)
                    .fill(null)
                    .map((_, i) => (
                      <View key={`empty-${i}`} style={styles.gridItem} />
                    ))}
              </View>
            ))}
          </View>

          {/* 取消按钮 */}
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelText}>
              {state.cancelText || '取消'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  content: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 34,
    paddingHorizontal: 16,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#444444',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888888',
    textAlign: 'center',
    marginBottom: 20,
  },
  gridContainer: {
    paddingVertical: 8,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 20,
  },
  gridItem: {
    width: (SCREEN_WIDTH - 32) / ITEMS_PER_ROW,
    alignItems: 'center',
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#2D2D2D',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemLabel: {
    fontSize: 12,
    color: '#CCCCCC',
    textAlign: 'center',
  },
  cancelButton: {
    marginTop: 8,
    paddingVertical: 14,
    backgroundColor: '#2D2D2D',
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default MoreFunctionsSheet;

