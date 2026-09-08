/**
 * 注册页面组件
 * 支持密码注册方式
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Clipboard,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PrivateKey } from 'bitsharesjs';
import { ChainConfig } from 'bitsharesjs-ws';

import type { RootStackParamList } from '../types';
import { useChainConfigStore } from '../store/useChainConfigStore';
import { chainServiceMgr } from '../services/chainservice_mgr';
import { CURRENT_CHANNEL } from '../config';
import Toast from '../components/Toast';
import { Buffer } from 'buffer';

// ============================================
// 常量定义
// ============================================

// 密码字符集
const PASSWORD_CHARS = {
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // 排除 I, O 避免混淆
  lowercase: 'abcdefghjkmnpqrstuvwxyz',  // 排除 i, l, o 避免混淆
  numbers: '23456789',                    // 排除 0, 1 避免混淆
  symbols: '!@#$%&*+-=?',
};

// 密码长度
const PASSWORD_LENGTH = 32;

// 账户名长度限制
const ACCOUNT_NAME_MIN_LENGTH = 3;
const ACCOUNT_NAME_MAX_LENGTH = 32;

const DEFI_SHARES_FAUCET_URL = 'https://api.defishares.org/faucet/api/v1/accounts';
const DEFI_SHARES_ADDRESS_PREFIX = 'DFS';
const DEFI_SHARES_FAUCET_REFERRER = 'dfs-faucet';

// ============================================
// 账户名验证规则
// ============================================

interface AccountNameRule {
  id: string;
  label: string;
  check: (name: string) => boolean;
}

const ACCOUNT_NAME_RULES: AccountNameRule[] = [
  {
    id: 'chars',
    label: '由字母、数字或短横线组成',
    check: (name: string) => name.length > 0 && /^[a-z0-9-]+$/.test(name),
  },
  {
    id: 'startWithLetter',
    label: '必须以字母开头',
    check: (name: string) => /^[a-z]/.test(name),
  },
  {
    id: 'endWithLetterOrNumber',
    label: '必须以字母或数字结尾',
    check: (name: string) => name.length > 0 && /[a-z0-9]$/.test(name),
  },
  {
    id: 'containsNumber',
    label: '必须包含数字',
    check: (name: string) => /[0-9]/.test(name),
  },
  {
    id: 'length',
    label: `长度${ACCOUNT_NAME_MIN_LENGTH}到${ACCOUNT_NAME_MAX_LENGTH}个字符`,
    check: (name: string) => name.length >= ACCOUNT_NAME_MIN_LENGTH && name.length <= ACCOUNT_NAME_MAX_LENGTH,
  },
];

// ============================================
// 辅助函数
// ============================================

/**
 * 生成随机强密码
 */
const generateStrongPassword = (): string => {
  const allChars =
    PASSWORD_CHARS.uppercase +
    PASSWORD_CHARS.lowercase +
    PASSWORD_CHARS.numbers +
    PASSWORD_CHARS.symbols;

  let password = '';

  // 确保每种字符类型至少有一个
  password += PASSWORD_CHARS.uppercase[Math.floor(Math.random() * PASSWORD_CHARS.uppercase.length)];
  password += PASSWORD_CHARS.lowercase[Math.floor(Math.random() * PASSWORD_CHARS.lowercase.length)];
  password += PASSWORD_CHARS.numbers[Math.floor(Math.random() * PASSWORD_CHARS.numbers.length)];
  password += PASSWORD_CHARS.symbols[Math.floor(Math.random() * PASSWORD_CHARS.symbols.length)];

  // 填充剩余字符
  for (let i = password.length; i < PASSWORD_LENGTH; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // 打乱密码顺序
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
};

/**
 * 验证所有账户名规则是否通过
 */
const validateAllRules = (name: string): boolean => {
  return ACCOUNT_NAME_RULES.every(rule => rule.check(name));
};

/**
 * 根据账户名和密码生成私钥
 */
const generatePrivateKey = (accountName: string, password: string, role: string = 'active'): string => {
  const seed = `${accountName}${role}${password}`;
  const privateKey = PrivateKey.fromSeed(seed);
  return privateKey.toWif();
};

/**
 * 根据私钥获取公钥
 */
const getPublicKeyFromPrivate = (privateKeyWif: string): string => {
  const privateKey = PrivateKey.fromWif(privateKeyWif);
  return privateKey.toPublicKey().toString();
};

/**
 * 根据推荐人账户 ID 计算推荐码
 * @param accountId 推荐人账户 ID，如 "1.2.12345"
 * @returns Base64 URL-safe 编码的推荐码
 */
const calculateRefcode = (accountId: string): string => {
  try {
    // 根据 "." 分割 ID，取最后一部分
    const idParts = accountId.split('.');
    const lastPart = idParts.length > 0 ? idParts[idParts.length - 1] : '';

    if (!lastPart) {
      return '';
    }

    // 使用 Buffer 进行 Base64 URL-safe 编码
    const base64 = Buffer.from(lastPart, 'utf8').toString('base64');

    // 转换为 URL-safe 格式：+ -> -, / -> _, 移除 =
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (error) {
    console.error('[Register] 计算推荐码失败:', error);
    return '';
  }
};

// ============================================
// 错误码映射
// ============================================

const ERROR_MESSAGES: Record<number, string> = {
  10: '参数无效',
  20: '账户名格式不正确',
  30: '账户名已存在',
  40: '注册失败，请稍后重试',
  41: '该设备注册账户数量已达上限',
  42: '注册过于频繁，请稍后再试',
  999: '服务器维护中，请稍后再试',
};

// ============================================
// 子组件：账户名规则检查项
// ============================================

interface RuleCheckItemProps {
  label: string;
  passed: boolean;
}

const RuleCheckItem: React.FC<RuleCheckItemProps> = ({ label, passed }) => (
  <View style={styles.ruleItem}>
    <View style={[styles.ruleCheckbox, passed && styles.ruleCheckboxPassed]}>
      {passed && <Icon name="check" size={12} color="#FFFFFF" />}
    </View>
    <Text style={[styles.ruleLabel, passed && styles.ruleLabelPassed]}>{label}</Text>
  </View>
);

// ============================================
// 组件
// ============================================

const RegisterScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { appSettings } = useChainConfigStore();

  // 表单状态
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [referrer, setReferrer] = useState('');

  // UI 状态
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // 计算每个规则的验证状态
  const ruleResults = useMemo(() => {
    return ACCOUNT_NAME_RULES.map(rule => ({
      ...rule,
      passed: rule.check(accountName),
    }));
  }, [accountName]);

  // 所有规则是否都通过
  const allRulesPassed = useMemo(() => {
    return ruleResults.every(r => r.passed);
  }, [ruleResults]);

  // 组件挂载时生成初始密码
  useEffect(() => {
    setPassword(generateStrongPassword());
  }, []);

  /**
   * 刷新密码
   */
  const handleRefreshPassword = useCallback(() => {
    setPassword(generateStrongPassword());
    setErrorMessage('');
  }, []);

  /**
   * 复制密码到剪贴板
   */
  const handleCopyPassword = useCallback(() => {
    Clipboard.setString(password);
    Toast.show('密码已复制到剪贴板');
  }, [password]);

  /**
   * 处理账户名输入
   */
  const handleAccountNameChange = useCallback((text: string) => {
    // 自动转换为小写
    setAccountName(text.toLowerCase());
    setErrorMessage('');
  }, []);

  /**
   * 处理推荐人输入
   */
  const handleReferrerChange = useCallback((text: string) => {
    setReferrer(text.toLowerCase());
  }, []);

  /**
   * 调用水龙头 API 注册账户
   */
  const registerWithFaucet = async (
    name: string,
    ownerKey: string,
    activeKey: string,
    memoKey: string,
    refcode: string
  ): Promise<{ success: boolean; error?: string }> => {
    const faucet = {
      legacy: true,
      url: DEFI_SHARES_FAUCET_URL,
    };

    const channelId = CURRENT_CHANNEL.channelId;

    try {
      if (faucet.legacy) {
        // 遗产水龙头（官网水龙头）
        const args = {
          account: {
            name,
            owner_key: ownerKey,
            active_key: activeKey,
            memo_key: memoKey,
            // 水龙头接口要求无推荐人时传 null，而不是空字符串。
            refcode: refcode || null,
            referrer: DEFI_SHARES_FAUCET_REFERRER,
          },
        };

        const response = await fetch(faucet.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(args),
        });

        const data = await response.json();

        if (data.error) {
          const serverError = data.error?.base?.[0];
          if (serverError) {
            const lowerMsg = serverError.toLowerCase();
            if (lowerMsg.includes('account exists')) {
              return { success: false, error: '账户名已存在' };
            } else if (lowerMsg.includes('only one account per ip')) {
              return { success: false, error: '注册过于频繁，请稍后再试' };
            } else if (lowerMsg.includes('creating more accounts')) {
              return { success: false, error: '该设备注册账户数量已达上限' };
            }
            return { success: false, error: serverError };
          }
          return { success: false, error: '注册失败，请稍后重试' };
        }

        return { success: true };
      } else {
        // 新版水龙头
        const args = {
          account_name: name,
          owner_key: ownerKey,
          active_key: activeKey,
          memo_key: memoKey,
          chid: channelId,
          referrer_code: refcode,
        };

        const response = await fetch(faucet.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(args),
        });

        const data = await response.json();

        if (data.status !== 0) {
          const errorMsg = ERROR_MESSAGES[data.status] || data.msg || '注册失败，请稍后重试';
          return { success: false, error: errorMsg };
        }

        return { success: true };
      }
    } catch (error) {
      console.error('[Register] 注册请求失败:', error);
      return { success: false, error: '网络错误，请检查网络连接' };
    }
  };

  /**
   * 处理注册
   */
  const handleRegister = async () => {
    // 验证协议勾选
    if (!agreedToTerms) {
      setErrorMessage('请阅读并同意用户协议和隐私政策');
      return;
    }

    // 验证账户名规则
    if (!allRulesPassed) {
      setErrorMessage('账户名格式不正确，请检查上方规则');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      // bitsharesjs 默认使用 CBA/BTS 前缀；DeFiShares 水龙头只接受 DFS 公钥。
      ChainConfig.setPrefix(DEFI_SHARES_ADDRESS_PREFIX);

      // 1. 确保已连接到区块链
      let connected = chainServiceMgr.getIsConnected();
      if (!connected) {
        connected = await chainServiceMgr.initChain();
      }
      if (!connected) {
        setErrorMessage('网络连接失败，请稍后重试');
        setIsLoading(false);
        return;
      }

      // 2. 检查账户名是否已存在
      const existingAccount = await chainServiceMgr.getAccountByName(accountName);
      if (existingAccount) {
        setErrorMessage('账户名已存在');
        setIsLoading(false);
        return;
      }

      // 3. 生成各种角色的密钥
      const ownerKeyWif = generatePrivateKey(accountName, password, 'owner');
      const activeKeyWif = generatePrivateKey(accountName, password, 'active');
      const memoKeyWif = generatePrivateKey(accountName, password, 'memo');

      const ownerPubKey = getPublicKeyFromPrivate(ownerKeyWif);
      const activePubKey = getPublicKeyFromPrivate(activeKeyWif);
      const memoPubKey = getPublicKeyFromPrivate(memoKeyWif);

      // 4. 计算推荐码
      let refcode = '';
      const referrerName = referrer.trim();
      if (referrerName) {
        const referrerAccount = await chainServiceMgr.getAccountByName(referrerName);
        if (referrerAccount && referrerAccount.id) {
          refcode = calculateRefcode(referrerAccount.id);
          console.log('[Register] 推荐人账户:', referrerName, '-> ID:', referrerAccount.id, '-> refcode:', refcode);
        } else {
          console.log('[Register] 推荐人账户不存在:', referrerName);
        }
      }

      console.log('[Register] 开始注册账户:', accountName);

      // 5. 调用水龙头注册（传递推荐码）
      const result = await registerWithFaucet(
        accountName,
        ownerPubKey,
        activePubKey,
        memoPubKey,
        refcode
      );

      if (!result.success) {
        setErrorMessage(result.error || '注册失败');
        setIsLoading(false);
        return;
      }

      console.log('[Register] 注册成功');

      // 6. 获取新注册账户的 ID
      const newAccount = await chainServiceMgr.getAccountByName(accountName);
      if (!newAccount) {
        // 账户可能需要一点时间同步，等待后重试
        await new Promise<void>(resolve => setTimeout(resolve, 2000));
        const retryAccount = await chainServiceMgr.getAccountByName(accountName);
        if (!retryAccount) {
          setErrorMessage('注册成功，但获取账户信息失败，请稍后登录');
          setIsLoading(false);
          return;
        }
      }

      const accountId = newAccount?.id || '';

      // 7. 跳转到设置 PIN 码页面
      navigation.replace('SetupPin', {
        accountId,
        accountName,
        privateKey: activeKeyWif,
      });

    } catch (error) {
      console.error('[Register] 注册失败:', error);
      setErrorMessage('注册失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 返回登录页面
   */
  const handleBackToLogin = () => {
    navigation.goBack();
  };

  /**
   * 打开用户协议
   */
  const handleOpenUserAgreement = useCallback(() => {
    const { getAppDynamicLang } = useChainConfigStore.getState();
    const url = getAppDynamicLang('link.docs.agreement');
    if (url && url !== 'link.docs.agreement') {
      navigation.navigate('WebView', {
        url,
        title: '用户协议',
      });
    }
  }, [navigation]);

  /**
   * 打开隐私政策
   */
  const handleOpenPrivacyPolicy = useCallback(() => {
    // 暂时也使用用户协议的链接
    const { getAppDynamicLang } = useChainConfigStore.getState();
    const url = getAppDynamicLang('link.docs.agreement');
    if (url && url !== 'link.docs.agreement') {
      navigation.navigate('WebView', {
        url,
        title: '隐私政策',
      });
    }
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* 返回按钮和页面标题 */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={handleBackToLogin}>
              <Icon name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>创建账户</Text>
            <View style={styles.headerPlaceholder} />
          </View>

          {/* 表单内容 */}
          <View style={styles.formContainer}>
            {/* 错误消息 */}
            {errorMessage ? (
              <View style={styles.errorContainer}>
                <Icon name="alert-circle-outline" size={20} color="#FF6B6B" />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* 账户名输入框 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>账号</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={accountName}
                  onChangeText={handleAccountNameChange}
                  placeholder="请输入账户名"
                  placeholderTextColor="#666666"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                />
              </View>

              {/* 账户名规则检查列表 */}
              <View style={styles.rulesContainer}>
                {ruleResults.map(rule => (
                  <RuleCheckItem
                    key={rule.id}
                    label={rule.label}
                    passed={rule.passed}
                  />
                ))}
              </View>
            </View>

            {/* 密码区域 */}
            <View style={styles.inputGroup}>
              <View style={styles.passwordHeader}>
                <Text style={styles.inputLabel}>安全密码</Text>
                <TouchableOpacity
                  style={styles.refreshButton}
                  onPress={handleRefreshPassword}
                  disabled={isLoading}
                >
                  <Icon name="refresh" size={20} color="#00D094" />
                  <Text style={styles.refreshText}>刷新</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  editable={false}
                  multiline={true}
                  numberOfLines={2}
                />
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={handleCopyPassword}
                >
                  <Icon name="content-copy" size={22} color="#888888" />
                </TouchableOpacity>
              </View>
              <Text style={styles.passwordHint}>
                <Icon name="alert-circle" size={14} color="#FF9500" />
                {' '}请妥善保存此密码！密码丢失将无法找回账户！
              </Text>
            </View>

            {/* 推荐人输入框 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>推荐人账号（可选）</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={referrer}
                  onChangeText={handleReferrerChange}
                  placeholder="请输入推荐人账号"
                  placeholderTextColor="#666666"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                />
              </View>
            </View>

            {/* 用户协议 */}
            <TouchableOpacity
              style={styles.termsContainer}
              onPress={() => setAgreedToTerms(!agreedToTerms)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                {agreedToTerms && <Icon name="check" size={14} color="#FFFFFF" />}
              </View>
              <Text style={styles.termsText}>
                我已阅读并同意
                <Text style={styles.termsLink} onPress={handleOpenUserAgreement}>
                  《用户协议》
                </Text>
                和
                <Text style={styles.termsLink} onPress={handleOpenPrivacyPolicy}>
                  《隐私政策》
                </Text>
              </Text>
            </TouchableOpacity>

            {/* 注册按钮 */}
            <TouchableOpacity
              style={[
                styles.registerButton,
                (!agreedToTerms || !allRulesPassed || isLoading) && styles.registerButtonDisabled,
              ]}
              onPress={handleRegister}
              disabled={!agreedToTerms || !allRulesPassed || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.registerButtonText}>注册</Text>
              )}
            </TouchableOpacity>

            {/* 返回登录 */}
            <TouchableOpacity
              style={styles.loginLinkContainer}
              onPress={handleBackToLogin}
            >
              <Text style={styles.loginLinkText}>已有账户？</Text>
              <Text style={styles.loginLink}>立即登录</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ============================================
// 样式
// ============================================

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
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // 头部
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 24,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerPlaceholder: {
    width: 40,
  },

  // 表单
  formContainer: {
    flex: 1,
  },
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
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    paddingVertical: 8,
  },

  // 账户名规则检查
  rulesContainer: {
    marginTop: 12,
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  ruleCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#666666',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  ruleCheckboxPassed: {
    backgroundColor: '#00D094',
    borderColor: '#00D094',
  },
  ruleLabel: {
    fontSize: 13,
    color: '#666666',
  },
  ruleLabelPassed: {
    color: '#00D094',
  },

  // 密码区域
  passwordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  refreshText: {
    fontSize: 14,
    color: '#00D094',
    marginLeft: 4,
  },
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#333333',
  },
  passwordInput: {
    flex: 1,
    fontSize: 14,
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 20,
  },
  copyButton: {
    padding: 8,
    marginLeft: 8,
  },
  passwordHint: {
    fontSize: 12,
    color: '#FF9500',
    marginTop: 12,
    lineHeight: 18,
  },

  // 错误消息
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#FF6B6B',
    marginLeft: 8,
    flex: 1,
  },

  // 用户协议
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#666666',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  checkboxChecked: {
    backgroundColor: '#00D094',
    borderColor: '#00D094',
  },
  termsText: {
    fontSize: 14,
    color: '#888888',
    flex: 1,
    lineHeight: 20,
  },
  termsLink: {
    color: '#00D094',
  },

  // 注册按钮
  registerButton: {
    backgroundColor: '#00D094',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  registerButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  registerButtonDisabled: {
    backgroundColor: '#333333',
  },

  // 登录链接
  loginLinkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  loginLinkText: {
    fontSize: 14,
    color: '#888888',
  },
  loginLink: {
    fontSize: 14,
    color: '#00D094',
    fontWeight: '600',
    marginLeft: 4,
  },
});

export default RegisterScreen;
