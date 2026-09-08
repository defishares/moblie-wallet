/**
 * UnlockModal 全局解锁弹窗组件
 * 从底部弹出，占屏幕约40%高度
 * 支持生物认证（Face ID / Touch ID / 指纹）和 PIN 码解锁
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
  ActivityIndicator,
  Modal,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { Text } from '@rneui/themed';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { secureStorageService } from '../services/secure_storage_service';
import type { BiometricType } from '../types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MODAL_HEIGHT = SCREEN_HEIGHT * 0.45; // 45% 屏幕高度

// 私钥映射类型
export type UnlockedKeys = { [key: string]: string | undefined };

interface UnlockModalConfig {
  accountId: string;
  accountName: string;
  onSuccess: (keys: UnlockedKeys) => void;
  onCancel?: () => void;
}

interface UnlockModalState {
  visible: boolean;
  config: UnlockModalConfig | null;
}

// UnlockModal 管理器 - 全局单例
class UnlockModalManager {
  private static instance: UnlockModalManager;
  private showCallback: ((config: UnlockModalConfig) => void) | null = null;
  private hideCallback: (() => void) | null = null;

  static getInstance(): UnlockModalManager {
    if (!UnlockModalManager.instance) {
      UnlockModalManager.instance = new UnlockModalManager();
    }
    return UnlockModalManager.instance;
  }

  setCallbacks(
    showCallback: (config: UnlockModalConfig) => void,
    hideCallback: () => void
  ) {
    this.showCallback = showCallback;
    this.hideCallback = hideCallback;
  }

  show(config: UnlockModalConfig) {
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

export const unlockModalManager = UnlockModalManager.getInstance();

// 便捷方法
export const UnlockModal = {
  /**
   * 显示解锁弹窗
   */
  show: (config: UnlockModalConfig) => {
    unlockModalManager.show(config);
  },

  /**
   * 隐藏解锁弹窗
   */
  hide: () => {
    unlockModalManager.hide();
  },
};

// UnlockModal 容器组件 - 需要在 App 顶层渲染
export const UnlockModalContainer: React.FC = () => {
  const [state, setState] = useState<UnlockModalState>({
    visible: false,
    config: null,
  });

  // 使用 ref 保存 config，避免闭包捕获旧值问题
  const configRef = useRef<UnlockModalConfig | null>(null);

  // 内部状态
  const [biometricType, setBiometricType] = useState<BiometricType>('None');
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false); // 是否已完成初始化
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [pinCode, setPinCode] = useState('');
  const [showPinCode, setShowPinCode] = useState(false);
  const [isPinLoading, setIsPinLoading] = useState(false);

  // 动画值
  const slideAnim = useRef(new Animated.Value(MODAL_HEIGHT)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // 显示弹窗
  const show = useCallback((config: UnlockModalConfig) => {
    // 保存 config 到 ref（避免闭包问题）
    configRef.current = config;

    // 重置状态
    setErrorMessage('');
    setPinCode('');
    setShowPinCode(false);
    setIsBiometricLoading(false);
    setIsPinLoading(false);
    setBiometricsEnabled(false); // 重置生物认证状态
    setIsInitialized(false); // 重置初始化状态

    setState({
      visible: true,
      config,
    });

    // 初始化生物认证状态
    initializeBiometrics(config.accountId);

    // 弹出动画
    slideAnim.setValue(MODAL_HEIGHT);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [slideAnim]);

  // 隐藏弹窗
  const hide = useCallback(() => {
    Keyboard.dismiss();

    // 收起动画
    Animated.timing(slideAnim, {
      toValue: MODAL_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      // 清除 ref
      configRef.current = null;
      setState({
        visible: false,
        config: null,
      });
    });
  }, [slideAnim]);

  // 注册回调
  useEffect(() => {
    unlockModalManager.setCallbacks(show, hide);
  }, [show, hide]);

  // 初始化生物认证
  const initializeBiometrics = async (accountId: string) => {
    try {
      // 获取设备支持的生物认证类型
      const type = await secureStorageService.getSupportedBiometricType();
      setBiometricType(type);

      // 检查账号是否启用了生物认证
      const enabled = await secureStorageService.isBiometricsEnabled(accountId);
      setBiometricsEnabled(enabled);
      setIsInitialized(true);

      console.log(`[UnlockModal] 初始化完成 - 设备支持: ${type}, 账号已启用: ${enabled}`);

      // 只有当设备支持且账号已启用生物认证时，才自动尝试
      if (enabled && type !== 'None') {
        setTimeout(() => {
          attemptBiometricUnlock(accountId);
        }, 500);
      }
    } catch (error) {
      console.error('[UnlockModal] 初始化失败:', error);
      setIsInitialized(true); // 即使失败也标记为已初始化
    }
  };

  // 尝试生物认证解锁
  const attemptBiometricUnlock = async (accountId?: string) => {
    // 从 ref 获取 config（避免闭包问题）
    const id = accountId || configRef.current?.accountId;
    if (!id) return;

    setIsBiometricLoading(true);
    setErrorMessage('');

    try {
      // 使用获取所有私钥的方法
      const result = await secureStorageService.retrieveAllKeysWithBiometric(id);

      if (result.success && result.keys) {
        handleUnlockSuccess(result.keys);
      } else {
        setErrorMessage(result.error || '认证失败，请使用PIN码');
      }
    } catch (error) {
      console.error('[UnlockModal] 生物认证失败:', error);
      setErrorMessage('认证失败，请使用PIN码');
    } finally {
      setIsBiometricLoading(false);
    }
  };

  // 使用 PIN 码解锁
  const attemptPinUnlock = async () => {
    // 从 ref 获取 config（避免闭包问题）
    const config = configRef.current;

    if (!pinCode || !config) {
      setErrorMessage('请输入PIN码');
      shakeError();
      return;
    }

    setIsPinLoading(true);
    setErrorMessage('');

    try {
      // 使用获取所有私钥的方法
      const result = await secureStorageService.retrieveAllKeysWithPin(
        config.accountId,
        pinCode
      );

      if (result.success && result.keys) {
        handleUnlockSuccess(result.keys);
      } else {
        setErrorMessage(result.error || 'PIN码错误');
        shakeError();
        setPinCode('');
      }
    } catch (error) {
      console.error('[UnlockModal] PIN解锁失败:', error);
      setErrorMessage('解锁失败，请重试');
      shakeError();
    } finally {
      setIsPinLoading(false);
    }
  };

  // 解锁成功处理
  const handleUnlockSuccess = (keys: UnlockedKeys) => {
    // 从 ref 获取 config（避免闭包捕获旧值问题）
    const config = configRef.current;

    console.log('[UnlockModal] 解锁成功:', config?.accountName, '私钥类型:', Object.keys(keys));

    // 先隐藏弹窗
    hide();

    // 回调成功
    if (config?.onSuccess) {
      // 延迟一点执行回调，确保弹窗已经开始关闭
      setTimeout(() => {
        config.onSuccess(keys);
      }, 100);
    }
  };

  // 错误震动动画
  const shakeError = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  // 处理取消
  const handleCancel = () => {
    // 从 ref 获取 config（避免闭包问题）
    const config = configRef.current;
    if (config?.onCancel) {
      config.onCancel();
    }
    hide();
  };

  // 脉冲动画
  useEffect(() => {
    if (isBiometricLoading) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isBiometricLoading, pulseAnim]);

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
        return 'lock-outline';
    }
  };

  // 获取生物认证显示名称
  const getBiometricDisplayName = (): string => {
    return secureStorageService.getBiometricDisplayName(biometricType);
  };

  if (!state.visible) {
    return null;
  }

  return (
    <Modal
      visible={state.visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* 点击遮罩关闭 */}
        <TouchableWithoutFeedback onPress={handleCancel}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        {/* 弹窗内容 */}
        <Animated.View
          style={[
            styles.container,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* 顶部拖拽指示器 */}
          <View style={styles.dragIndicator} />

          {/* 头部 */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>验证身份</Text>
            <TouchableOpacity style={styles.closeButton} onPress={handleCancel}>
              <Icon name="close" size={24} color="#888888" />
            </TouchableOpacity>
          </View>

          {/* 账号信息 */}
          <View style={styles.accountInfo}>
            <View style={styles.avatarContainer}>
              <Text style={styles.avatarText}>
                {state.config?.accountName.substring(0, 2).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.accountName}>{state.config?.accountName}</Text>
          </View>

          {/* 错误消息 */}
          {errorMessage ? (
            <View style={styles.errorContainer}>
              <Icon name="alert-circle-outline" size={16} color="#FF6B6B" />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* 生物认证区域 - 只有在初始化完成且账号已启用生物认证时才显示 */}
          {isInitialized && biometricsEnabled && biometricType !== 'None' && (
            <View style={styles.biometricSection}>
              <TouchableOpacity
                style={styles.biometricButton}
                onPress={() => attemptBiometricUnlock()}
                disabled={isBiometricLoading}
              >
                <Animated.View
                  style={[
                    styles.biometricIconContainer,
                    { transform: [{ scale: pulseAnim }] },
                  ]}
                >
                  {isBiometricLoading ? (
                    <ActivityIndicator color="#00D094" size="large" />
                  ) : (
                    <Icon
                      name={getBiometricIcon()}
                      size={36}
                      color="#00D094"
                    />
                  )}
                </Animated.View>
                <Text style={styles.biometricText}>
                  {isBiometricLoading
                    ? `${getBiometricDisplayName()}验证中...`
                    : `使用${getBiometricDisplayName()}`}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 分隔线 */}
          {isInitialized && biometricsEnabled && biometricType !== 'None' && (
            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>或</Text>
              <View style={styles.dividerLine} />
            </View>
          )}

          {/* PIN 码输入区域 */}
          <Animated.View
            style={[
              styles.pinSection,
              { transform: [{ translateX: shakeAnim }] },
            ]}
          >
            <View style={styles.pinInputContainer}>
              <TextInput
                style={styles.pinInput}
                value={pinCode}
                onChangeText={setPinCode}
                placeholder="输入PIN码"
                placeholderTextColor="#666666"
                secureTextEntry={!showPinCode}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isPinLoading}
                onSubmitEditing={attemptPinUnlock}
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

            <TouchableOpacity
              style={[
                styles.unlockButton,
                (!pinCode || isPinLoading) && styles.unlockButtonDisabled,
              ]}
              onPress={attemptPinUnlock}
              disabled={!pinCode || isPinLoading}
            >
              {isPinLoading ? (
                <ActivityIndicator color="#0D0D0D" size="small" />
              ) : (
                <Text style={styles.unlockButtonText}>确认解锁</Text>
              )}
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  container: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 34, // 安全区域
    minHeight: MODAL_HEIGHT,
  },
  dragIndicator: {
    width: 40,
    height: 4,
    backgroundColor: '#444444',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },

  // 头部
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    position: 'relative',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  closeButton: {
    position: 'absolute',
    right: 0,
    padding: 4,
  },

  // 账号信息
  accountInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    marginBottom: 16,
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00D094',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0D0D0D',
  },
  accountName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
  },

  // 错误消息
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#FF6B6B',
    marginLeft: 8,
    flex: 1,
  },

  // 生物认证区域
  biometricSection: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  biometricIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 208, 148, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  biometricText: {
    fontSize: 15,
    color: '#FFFFFF',
  },

  // 分隔线
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2A2A2A',
  },
  dividerText: {
    fontSize: 13,
    color: '#666666',
    marginHorizontal: 16,
  },

  // PIN 码区域
  pinSection: {
    marginTop: 4,
  },
  pinInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 12,
    backgroundColor: '#0D0D0D',
    paddingHorizontal: 16,
    marginBottom: 16,
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

  // 解锁按钮
  unlockButton: {
    backgroundColor: '#00D094',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  unlockButtonDisabled: {
    backgroundColor: '#333333',
  },
  unlockButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0D0D0D',
  },
});

export default UnlockModal;

