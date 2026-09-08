/**
 * BlockView 全局阻塞视图组件
 * 用于在耗时操作（如区块链交易）时显示全屏加载遮罩
 * 阻止用户交互，操作完成后自动隐藏
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Modal,
} from 'react-native';

interface BlockViewConfig {
  message?: string;
}

interface BlockViewState {
  visible: boolean;
  message: string;
}

// BlockView 管理器 - 全局单例
class BlockViewManager {
  private static instance: BlockViewManager;
  private showCallback: ((config: BlockViewConfig) => void) | null = null;
  private hideCallback: (() => void) | null = null;

  static getInstance(): BlockViewManager {
    if (!BlockViewManager.instance) {
      BlockViewManager.instance = new BlockViewManager();
    }
    return BlockViewManager.instance;
  }

  setCallbacks(
    showCallback: (config: BlockViewConfig) => void,
    hideCallback: () => void
  ) {
    this.showCallback = showCallback;
    this.hideCallback = hideCallback;
  }

  show(message?: string) {
    if (this.showCallback) {
      this.showCallback({ message });
    }
  }

  hide() {
    if (this.hideCallback) {
      this.hideCallback();
    }
  }
}

export const blockViewManager = BlockViewManager.getInstance();

// 便捷方法
export const BlockView = {
  /**
   * 显示阻塞视图
   * @param message 显示的提示文字，默认为 "请求中..."
   */
  show: (message: string = '请求中...') => {
    blockViewManager.show(message);
  },

  /**
   * 隐藏阻塞视图
   */
  hide: () => {
    blockViewManager.hide();
  },

  /**
   * 执行异步操作并自动管理阻塞视图
   * @param asyncFn 异步函数
   * @param message 显示的提示文字
   * @returns 异步函数的返回值
   */
  async wrap<T>(asyncFn: () => Promise<T>, message: string = '请求中...'): Promise<T> {
    try {
      blockViewManager.show(message);
      const result = await asyncFn();
      return result;
    } finally {
      blockViewManager.hide();
    }
  },
};

// BlockView 容器组件 - 需要在 App 顶层渲染
export const BlockViewContainer: React.FC = () => {
  const [state, setState] = useState<BlockViewState>({
    visible: false,
    message: '请求中...',
  });

  // 旋转动画值
  const spinValue = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  // 显示阻塞视图
  const show = useCallback((config: BlockViewConfig) => {
    setState({
      visible: true,
      message: config.message || '请求中...',
    });
  }, []);

  // 隐藏阻塞视图
  const hide = useCallback(() => {
    setState(prev => ({ ...prev, visible: false }));
  }, []);

  // 注册回调
  useEffect(() => {
    blockViewManager.setCallbacks(show, hide);
  }, [show, hide]);

  // 启动/停止旋转动画
  useEffect(() => {
    if (state.visible) {
      // 重置动画值
      spinValue.setValue(0);

      // 启动旋转动画
      animationRef.current = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      animationRef.current.start();
    } else {
      // 停止动画
      if (animationRef.current) {
        animationRef.current.stop();
        animationRef.current = null;
      }
    }

    return () => {
      if (animationRef.current) {
        animationRef.current.stop();
      }
    };
  }, [state.visible, spinValue]);

  // 计算旋转角度
  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (!state.visible) {
    return null;
  }

  return (
    <Modal
      visible={state.visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        // 阻止返回键关闭
      }}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* 旋转加载指示器 */}
          <Animated.View
            style={[
              styles.spinner,
              { transform: [{ rotate: spin }] },
            ]}
          />
          {/* 提示文字 */}
          <Text style={styles.message}>{state.message}</Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 48,
    alignItems: 'center',
    minWidth: 160,
    // 阴影效果
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  spinner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#333333',
    borderTopColor: '#00D094',
    marginBottom: 20,
  },
  message: {
    fontSize: 15,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});

export default BlockView;

