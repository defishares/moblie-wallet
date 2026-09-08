/**
 * Toast 提示组件
 * 在屏幕顶部中央显示轻量级提示消息
 * 
 * 支持四种类型：
 * - success: 绿色风格，表示成功
 * - warning: 黄色风格，表示警告
 * - info: 深色风格，表示信息
 * - error: 红色风格，表示错误
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Text,
    StyleSheet,
    Animated,
    Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export type ToastType = 'info' | 'success' | 'warning' | 'error';

// Toast 类型配置
const TOAST_CONFIG: Record<ToastType, {
    backgroundColor: string;
    textColor: string;
    iconName: string;
    iconColor: string;
}> = {
    success: {
        backgroundColor: 'rgba(0, 208, 148, 0.95)',
        textColor: '#FFFFFF',
        iconName: 'check-circle',
        iconColor: '#FFFFFF',
    },
    warning: {
        backgroundColor: 'rgba(255, 193, 7, 0.95)',
        textColor: '#1A1A1A',
        iconName: 'alert-circle',
        iconColor: '#1A1A1A',
    },
    info: {
        backgroundColor: 'rgba(40, 40, 40, 0.95)',
        textColor: '#FFFFFF',
        iconName: 'information',
        iconColor: '#888888',
    },
    error: {
        backgroundColor: 'rgba(255, 71, 87, 0.95)',
        textColor: '#FFFFFF',
        iconName: 'close-circle',
        iconColor: '#FFFFFF',
    },
};

interface ToastConfig {
    message: string;
    type?: ToastType;
    duration?: number;
}

interface ToastState extends ToastConfig {
    visible: boolean;
}

// Toast 管理器 - 全局单例
class ToastManager {
    private static instance: ToastManager;
    private showToastCallback: ((config: ToastConfig) => void) | null = null;

    static getInstance(): ToastManager {
        if (!ToastManager.instance) {
            ToastManager.instance = new ToastManager();
        }
        return ToastManager.instance;
    }

    setShowCallback(callback: (config: ToastConfig) => void) {
        this.showToastCallback = callback;
    }

    show(config: ToastConfig) {
        if (this.showToastCallback) {
            this.showToastCallback(config);
        }
    }
}

export const toastManager = ToastManager.getInstance();

// 便捷方法
export const Toast = {
    show: (message: string, type: ToastType = 'info', duration: number = 2000) => {
        toastManager.show({ message, type, duration });
    },
    info: (message: string, duration?: number) => {
        toastManager.show({ message, type: 'info', duration });
    },
    success: (message: string, duration?: number) => {
        toastManager.show({ message, type: 'success', duration });
    },
    warning: (message: string, duration?: number) => {
        toastManager.show({ message, type: 'warning', duration });
    },
    error: (message: string, duration?: number) => {
        toastManager.show({ message, type: 'error', duration });
    },
};

// Toast 容器组件 - 需要在 App 顶层渲染
export const ToastContainer: React.FC = () => {
    const [toast, setToast] = useState<ToastState>({
        visible: false,
        message: '',
        type: 'info',
        duration: 2000,
    });

    const translateY = useRef(new Animated.Value(-50)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(0.9)).current;
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hideToast = useCallback(() => {
        Animated.parallel([
            Animated.timing(translateY, {
                toValue: -50,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.timing(scale, {
                toValue: 0.9,
                duration: 200,
                useNativeDriver: true,
            }),
        ]).start(() => {
            setToast(prev => ({ ...prev, visible: false }));
        });
    }, [translateY, opacity, scale]);

    const showToast = useCallback((config: ToastConfig) => {
        // 清除之前的定时器
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // 重置动画值
        translateY.setValue(-50);
        opacity.setValue(0);
        scale.setValue(0.9);

        // 设置新的 toast 状态
        setToast({
            visible: true,
            message: config.message,
            type: config.type || 'info',
            duration: config.duration || 2000,
        });

        // 显示动画
        Animated.parallel([
            Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
                tension: 100,
                friction: 12,
            }),
            Animated.timing(opacity, {
                toValue: 1,
                duration: 150,
                useNativeDriver: true,
            }),
            Animated.spring(scale, {
                toValue: 1,
                useNativeDriver: true,
                tension: 100,
                friction: 12,
            }),
        ]).start();

        // 设置自动隐藏
        timeoutRef.current = setTimeout(() => {
            hideToast();
        }, config.duration || 2000);
    }, [translateY, opacity, scale, hideToast]);

    useEffect(() => {
        toastManager.setShowCallback(showToast);
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [showToast]);

    if (!toast.visible) {
        return null;
    }

    const config = TOAST_CONFIG[toast.type || 'info'];

    return (
        <Animated.View
            style={[
                styles.container,
                {
                    backgroundColor: config.backgroundColor,
                    transform: [
                        { translateY },
                        { scale },
                    ],
                    opacity,
                },
            ]}
            pointerEvents="none"
        >
            <Icon
                name={config.iconName}
                size={16}
                color={config.iconColor}
                style={styles.icon}
            />
            <Text
                style={[styles.message, { color: config.textColor }]}
                numberOfLines={2}
            >
                {toast.message}
            </Text>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 80,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 24,
        maxWidth: SCREEN_WIDTH - 80,
        zIndex: 9999,
        elevation: 9999,
    },
    icon: {
        marginRight: 8,
    },
    message: {
        fontSize: 14,
        fontWeight: '500',
        textAlign: 'center',
    },
});

export default Toast;

