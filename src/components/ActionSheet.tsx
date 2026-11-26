/**
 * ActionSheet 组件
 * 底部弹出的操作菜单，支持自定义操作项
 * 
 * 使用方式：
 * 1. 在 App 顶层渲染 <ActionSheetContainer />
 * 2. 调用 ActionSheet.show({ title, subtitle, actions }) 显示
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

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// 操作项类型
export interface ActionSheetAction {
  key: string;                    // 唯一标识
  label: string;                  // 显示文本
  icon?: string;                  // 图标名称（MaterialCommunityIcons）
  iconColor?: string;             // 图标颜色
  textColor?: string;             // 文本颜色
  danger?: boolean;               // 是否危险操作（红色样式）
  onPress: () => void;            // 点击回调
}

// 配置类型
export interface ActionSheetConfig {
  title?: string;                 // 标题
  subtitle?: string;              // 副标题
  actions: ActionSheetAction[];   // 操作项列表
  cancelText?: string;            // 取消按钮文本，默认"取消"
  onCancel?: () => void;          // 取消回调
}

interface ActionSheetState extends ActionSheetConfig {
  visible: boolean;
}

// ActionSheet 管理器 - 全局单例
class ActionSheetManager {
  private static instance: ActionSheetManager;
  private showCallback: ((config: ActionSheetConfig) => void) | null = null;
  private hideCallback: (() => void) | null = null;

  static getInstance(): ActionSheetManager {
    if (!ActionSheetManager.instance) {
      ActionSheetManager.instance = new ActionSheetManager();
    }
    return ActionSheetManager.instance;
  }

  setCallbacks(
    showCallback: (config: ActionSheetConfig) => void,
    hideCallback: () => void
  ) {
    this.showCallback = showCallback;
    this.hideCallback = hideCallback;
  }

  show(config: ActionSheetConfig) {
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

export const actionSheetManager = ActionSheetManager.getInstance();

// 便捷方法
export const ActionSheet = {
  show: (config: ActionSheetConfig) => {
    actionSheetManager.show(config);
  },
  hide: () => {
    actionSheetManager.hide();
  },
};

// ActionSheet 容器组件 - 需要在 App 顶层渲染
export const ActionSheetContainer: React.FC = () => {
  const [state, setState] = useState<ActionSheetState>({
    visible: false,
    actions: [],
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

  const showSheet = useCallback((config: ActionSheetConfig) => {
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
    actionSheetManager.setCallbacks(showSheet, hideSheet);
  }, [showSheet, hideSheet]);

  const handleCancel = () => {
    hideSheet();
    state.onCancel?.();
  };

  const handleActionPress = (action: ActionSheetAction) => {
    hideSheet();
    // 延迟执行回调，让动画先完成
    setTimeout(() => {
      action.onPress();
    }, 100);
  };

  if (!state.visible) {
    return null;
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
          {/* 标题区域 */}
          {(state.title || state.subtitle) && (
            <View style={styles.header}>
              {state.title && (
                <Text style={styles.title}>{state.title}</Text>
              )}
              {state.subtitle && (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {state.subtitle}
                </Text>
              )}
            </View>
          )}

          {/* 操作项列表 */}
          <View style={styles.actionList}>
            {state.actions.map((action, index) => {
              const isLast = index === state.actions.length - 1;
              const textColor = action.danger
                ? '#FF6B6B'
                : action.textColor || '#FFFFFF';
              const iconColor = action.danger
                ? '#FF6B6B'
                : action.iconColor || '#FFFFFF';

              return (
                <TouchableOpacity
                  key={action.key}
                  style={[
                    styles.actionItem,
                    !isLast && styles.actionItemBorder,
                  ]}
                  onPress={() => handleActionPress(action)}
                  activeOpacity={0.7}
                >
                  {action.icon && (
                    <Icon
                      name={action.icon}
                      size={22}
                      color={iconColor}
                      style={styles.actionIcon}
                    />
                  )}
                  <Text style={[styles.actionText, { color: textColor }]}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
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
    paddingTop: 8,
    paddingBottom: 34,
    paddingHorizontal: 16,
  },
  header: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D2D',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#888888',
    textAlign: 'center',
    marginTop: 4,
  },
  actionList: {
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  actionItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D2D',
  },
  actionIcon: {
    marginRight: 12,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '500',
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 16,
    backgroundColor: '#333333',
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default ActionSheet;

