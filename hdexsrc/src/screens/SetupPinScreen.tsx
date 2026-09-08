/**
 * 设置 PIN 码界面
 * 登录成功后设置 PIN 码和可选的生物认证
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList, BiometricType } from '../types';
import { secureStorageService } from '../services/secure_storage_service';
import { useAccountStore } from '../store/useAccountStore';

type SetupPinScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SetupPin'>;
type SetupPinScreenRouteProp = RouteProp<RootStackParamList, 'SetupPin'>;

// 设置步骤
type SetupStep = 'pin' | 'confirm' | 'biometric';

const SetupPinScreen: React.FC = () => {
  const navigation = useNavigation<SetupPinScreenNavigationProp>();
  const route = useRoute<SetupPinScreenRouteProp>();

  const { accountId, accountName, privateKey } = route.params;
  const { addAccount } = useAccountStore();

  // 状态
  const [step, setStep] = useState<SetupStep>('pin');
  const [pinCode, setPinCode] = useState('');
  const [confirmPinCode, setConfirmPinCode] = useState('');
  const [showPinCode, setShowPinCode] = useState(false);
  const [showConfirmPinCode, setShowConfirmPinCode] = useState(false);
  const [pinError, setPinError] = useState('');

  // 生物认证相关
  const [biometricType, setBiometricType] = useState<BiometricType>('None');
  const [enableBiometric, setEnableBiometric] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // 检查生物认证支持
  useEffect(() => {
    checkBiometricSupport();
  }, []);

  const checkBiometricSupport = async () => {
    const type = await secureStorageService.getSupportedBiometricType();
    setBiometricType(type);
  };

  // 验证 PIN 码格式
  const validatePinFormat = (pin: string): boolean => {
    const validation = secureStorageService.validatePin(pin);
    if (!validation.valid) {
      setPinError(validation.message || 'PIN码格式不正确');
      return false;
    }
    setPinError('');
    return true;
  };

  // 处理下一步
  const handleNext = () => {
    if (step === 'pin') {
      // 验证 PIN 格式
      if (!validatePinFormat(pinCode)) {
        return;
      }
      setStep('confirm');
    } else if (step === 'confirm') {
      // 验证两次输入是否一致
      if (pinCode !== confirmPinCode) {
        setPinError('两次输入的PIN码不一致');
        return;
      }

      // 如果支持生物认证，进入生物认证设置步骤
      if (biometricType !== 'None') {
        setStep('biometric');
      } else {
        // 不支持生物认证，直接完成设置
        completeSetup();
      }
    }
  };

  // 完成设置
  const completeSetup = async () => {
    setIsLoading(true);
    setPinError('');

    try {
      // 1. 初始化账号安全存储（PIN + 私钥）
      const pinStored = await secureStorageService.initializeAccount(
        accountId,
        pinCode,
        { active: privateKey }
      );

      if (!pinStored) {
        setPinError('存储私钥失败，请重试');
        setIsLoading(false);
        return;
      }

      // 2. 处理生物认证配置
      if (biometricType !== 'None') {
        if (enableBiometric) {
          // 用户选择启用生物认证
          const biometricStored = await secureStorageService.enableBiometricStorage(
            accountId,
            privateKey
          );

          if (!biometricStored) {
            console.warn('[SetupPin] 生物认证存储失败，但 PIN 存储成功');
          }
        } else {
          // 用户选择不启用生物认证，显式保存配置为禁用状态
          await secureStorageService.disableBiometricStorage(accountId);
        }
      }

      // 3. 添加账号到 Store
      await addAccount(accountId, accountName, true);

      // 4. 显示成功提示并跳转
      Alert.alert(
        '设置成功',
        enableBiometric && biometricType !== 'None'
          ? `PIN码已设置，${getBiometricDisplayName()}已启用`
          : 'PIN码已设置',
        [
          {
            text: '确定',
            onPress: () => {
              // 跳转到主页
              navigation.reset({
                index: 0,
                routes: [{ name: 'MainTabs' }],
              });
            },
          },
        ]
      );
    } catch (error) {
      console.error('[SetupPin] 设置失败:', error);
      setPinError('设置失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  // 获取生物认证显示名称
  const getBiometricDisplayName = (): string => {
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
        return 'lock-outline';
    }
  };

  // 渲染 PIN 输入步骤
  const renderPinStep = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <Icon name="lock-outline" size={48} color="#00D094" />
        <Text style={styles.stepTitle}>设置解锁PIN码</Text>
        <Text style={styles.stepSubtitle}>
          设置一个强密码来保护您的钱包
        </Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>PIN码</Text>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={pinCode}
            onChangeText={(text) => {
              setPinCode(text);
              setPinError('');
            }}
            placeholder="请输入PIN码"
            placeholderTextColor="#666666"
            secureTextEntry={!showPinCode}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => setShowPinCode(!showPinCode)}
          >
            <Icon
              name={showPinCode ? 'eye-off-outline' : 'eye-outline'}
              size={24}
              color="#888888"
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.pinRequirement}>
          要求：10位以上，包含大写字母、小写字母、特殊符号
        </Text>
      </View>
    </View>
  );

  // 渲染确认 PIN 步骤
  const renderConfirmStep = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <Icon name="shield-check-outline" size={48} color="#00D094" />
        <Text style={styles.stepTitle}>确认PIN码</Text>
        <Text style={styles.stepSubtitle}>
          请再次输入PIN码以确认
        </Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>确认PIN码</Text>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={confirmPinCode}
            onChangeText={(text) => {
              setConfirmPinCode(text);
              setPinError('');
            }}
            placeholder="请再次输入PIN码"
            placeholderTextColor="#666666"
            secureTextEntry={!showConfirmPinCode}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => setShowConfirmPinCode(!showConfirmPinCode)}
          >
            <Icon
              name={showConfirmPinCode ? 'eye-off-outline' : 'eye-outline'}
              size={24}
              color="#888888"
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  // 渲染生物认证设置步骤
  const renderBiometricStep = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <Icon name={getBiometricIcon()} size={64} color="#00D094" />
        <Text style={styles.stepTitle}>启用{getBiometricDisplayName()}</Text>
        <Text style={styles.stepSubtitle}>
          使用{getBiometricDisplayName()}快速解锁钱包
        </Text>
      </View>

      <View style={styles.biometricOption}>
        <View style={styles.biometricOptionLeft}>
          <Icon
            name={getBiometricIcon()}
            size={32}
            color="#FFFFFF"
            style={styles.biometricOptionIcon}
          />
          <View>
            <Text style={styles.biometricOptionTitle}>
              启用{getBiometricDisplayName()}
            </Text>
            <Text style={styles.biometricOptionDesc}>
              无需输入PIN码即可快速解锁
            </Text>
          </View>
        </View>
        <Switch
          value={enableBiometric}
          onValueChange={setEnableBiometric}
          trackColor={{ false: '#333333', true: '#00D094' }}
          thumbColor="#FFFFFF"
        />
      </View>

      <Text style={styles.biometricNote}>
        {enableBiometric
          ? `启用后，您可以使用${getBiometricDisplayName()}或PIN码解锁钱包`
          : '您可以稍后在设置中启用'}
      </Text>
    </View>
  );

  // 获取当前步骤内容
  const renderCurrentStep = () => {
    switch (step) {
      case 'pin':
        return renderPinStep();
      case 'confirm':
        return renderConfirmStep();
      case 'biometric':
        return renderBiometricStep();
    }
  };

  // 获取按钮文字
  const getButtonText = (): string => {
    switch (step) {
      case 'pin':
        return '下一步';
      case 'confirm':
        return biometricType !== 'None' ? '下一步' : '完成设置';
      case 'biometric':
        return '完成设置';
    }
  };

  // 检查是否可以继续
  const canProceed = (): boolean => {
    if (isLoading) return false;
    switch (step) {
      case 'pin':
        // 使用与 validatePin 一致的验证逻辑
        return secureStorageService.validatePin(pinCode).valid;
      case 'confirm':
        // 确认步骤：检查确认码与原PIN是否一致
        return confirmPinCode.length > 0 && pinCode === confirmPinCode;
      case 'biometric':
        return true;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 进度指示器 */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressDot, styles.progressDotActive]} />
            <View
              style={[
                styles.progressDot,
                (step === 'confirm' || step === 'biometric') && styles.progressDotActive,
              ]}
            />
            {biometricType !== 'None' && (
              <View
                style={[
                  styles.progressDot,
                  step === 'biometric' && styles.progressDotActive,
                ]}
              />
            )}
          </View>

          {/* 账号信息 */}
          <View style={styles.accountBadge}>
            <Text style={styles.accountBadgeText}>账号: {accountName}</Text>
          </View>

          {/* 当前步骤内容 */}
          {renderCurrentStep()}

          {/* 错误消息 */}
          {pinError ? (
            <View style={styles.errorContainer}>
              <Icon name="alert-circle-outline" size={20} color="#FF6B6B" />
              <Text style={styles.errorText}>{pinError}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* 底部按钮 */}
        <View style={styles.footer}>
          {step !== 'pin' && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                if (step === 'confirm') setStep('pin');
                else if (step === 'biometric') setStep('confirm');
                setPinError('');
              }}
            >
              <Icon name="chevron-left" size={24} color="#888888" />
              <Text style={styles.backButtonText}>返回</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.nextButton,
              !canProceed() && styles.nextButtonDisabled,
            ]}
            onPress={step === 'biometric' ? completeSetup : handleNext}
            disabled={!canProceed()}
          >
            {isLoading ? (
              <ActivityIndicator color="#0D0D0D" size="small" />
            ) : (
              <Text style={styles.nextButtonText}>{getButtonText()}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },

  // 进度指示器
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333333',
  },
  progressDotActive: {
    backgroundColor: '#00D094',
    width: 24,
  },

  // 账号徽章
  accountBadge: {
    alignSelf: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  accountBadgeText: {
    fontSize: 14,
    color: '#888888',
  },

  // 步骤容器
  stepContainer: {
    flex: 1,
  },
  stepHeader: {
    alignItems: 'center',
    marginBottom: 40,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 16,
  },
  stepSubtitle: {
    fontSize: 14,
    color: '#888888',
    marginTop: 8,
    textAlign: 'center',
  },

  // 输入组
  inputGroup: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 14,
    color: '#888888',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 16,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    paddingVertical: 16,
  },
  toggleButton: {
    padding: 8,
  },
  pinRequirement: {
    fontSize: 12,
    color: '#666666',
    marginTop: 8,
  },

  // 生物认证选项
  biometricOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  biometricOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  biometricOptionIcon: {
    marginRight: 16,
  },
  biometricOptionTitle: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  biometricOptionDesc: {
    fontSize: 12,
    color: '#888888',
    marginTop: 4,
  },
  biometricNote: {
    fontSize: 12,
    color: '#666666',
    textAlign: 'center',
  },

  // 错误消息
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#FF6B6B',
    marginLeft: 8,
  },

  // 底部按钮
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 16,
  },
  backButtonText: {
    fontSize: 16,
    color: '#888888',
  },
  nextButton: {
    flex: 1,
    backgroundColor: '#00D094',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  nextButtonDisabled: {
    backgroundColor: '#333333',
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0D0D0D',
  },
});

export default SetupPinScreen;

