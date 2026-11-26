/**
 * 登录页面组件
 * 支持多种登录方式：账户名登录、助记词登录、私钥登录
 */

import React, { useState } from 'react';
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
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { PrivateKey } from 'bitsharesjs';
import { ChainConfig } from 'bitsharesjs-ws';
import { chainServiceMgr } from '../services/chainservice_mgr';

// 登录方式类型
type LoginType = 'account' | 'mnemonic' | 'privateKey';

// DeFiShares 账户公钥使用 DFS 前缀。bitsharesjs 默认是 BTS，应用冷启动后
// 注册页设置的前缀不会保留，因此登录前必须显式恢复。
const DEFI_SHARES_ADDRESS_PREFIX = 'DFS';

// 登录方式 Tab 配置
const loginTabs: { key: LoginType; label: string }[] = [
  { key: 'account', label: '账户名登录' },
  { key: 'mnemonic', label: '助记词登录' },
  { key: 'privateKey', label: '私钥登录' },
];

const LoginScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // 当前登录方式
  const [loginType, setLoginType] = useState<LoginType>('account');

  // 账户名登录表单
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');

  // 密码显示状态
  const [showPassword, setShowPassword] = useState(false);

  // 加载状态
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  /**
   * 根据账户名和密码生成私钥
   * BitShares 使用 role + accountName + password 作为 seed
   */
  const generatePrivateKey = (accountName: string, pwd: string, role: string = 'active'): string => {
    try {
      const seed = `${accountName}${role}${pwd}`;
      // 从 seed 生成私钥
      const privateKey = PrivateKey.fromSeed(seed);
      // 返回 WIF 格式的私钥
      return privateKey.toWif();
    } catch (error) {
      console.error('[Login] 生成私钥失败:', error);
      throw error;
    }
  };

  /**
   * 验证私钥是否属于该账户
   */
  const verifyPrivateKey = async (accountName: string, privateKeyWif: string): Promise<{
    valid: boolean;
    accountId?: string;
    error?: string;
  }> => {
    try {
      // 获取账户信息
      const accountData = await chainServiceMgr.getAccountByName(accountName);

      if (!accountData) {
        return { valid: false, error: '账户不存在' };
      }

      // 从私钥计算公钥
      const privateKey = PrivateKey.fromWif(privateKeyWif);
      const publicKey = privateKey.toPublicKey().toString();

      // 检查公钥是否在账户的 active 权限中
      const activeKeys = accountData.active?.key_auths || [];
      const ownerKeys = accountData.owner?.key_auths || [];

      const allKeys = [...activeKeys, ...ownerKeys].map((auth: [string, number]) => auth[0]);

      if (allKeys.includes(publicKey)) {
        return { valid: true, accountId: accountData.id };
      }

      return { valid: false, error: '密码错误' };
    } catch (error) {
      console.error('[Login] 验证私钥失败:', error);
      return { valid: false, error: '验证失败，请检查网络连接' };
    }
  };

  // 处理登录
  const handleLogin = async () => {
    // 基本验证
    if (!account.trim()) {
      setErrorMessage('请输入账户名');
      return;
    }
    if (!password) {
      setErrorMessage('请输入密码');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
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

      // 确保从 seed 生成的公钥使用与链上账户一致的地址前缀。
      ChainConfig.setPrefix(DEFI_SHARES_ADDRESS_PREFIX);

      // 2. 根据账户名和密码生成私钥
      const privateKeyWif = generatePrivateKey(account.trim(), password, 'active');
      console.log('[Login] 已生成私钥');

      // 3. 验证私钥是否正确
      const verification = await verifyPrivateKey(account.trim(), privateKeyWif);

      if (!verification.valid) {
        setErrorMessage(verification.error || '登录失败');
        setIsLoading(false);
        return;
      }

      console.log('[Login] 私钥验证通过，账号ID:', verification.accountId);

      // 4. 登录成功，跳转到设置 PIN 码页面
      navigation.replace('SetupPin', {
        accountId: verification.accountId!,
        accountName: account.trim(),
        privateKey: privateKeyWif,
      });

    } catch (error) {
      console.error('[Login] 登录失败:', error);
      setErrorMessage('登录失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  // 处理创建账户
  const handleCreateAccount = () => {
    navigation.navigate('Register');
  };

  // 渲染登录方式 Tab
  const renderLoginTabs = () => (
    <View style={styles.tabsContainer}>
      {loginTabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={styles.tabItem}
          onPress={() => setLoginType(tab.key)}
        >
          <Text
            style={[
              styles.tabText,
              loginType === tab.key && styles.tabTextActive,
            ]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // 渲染账户名登录表单
  const renderAccountForm = () => (
    <View style={styles.formContainer}>
      {/* 错误消息 */}
      {errorMessage ? (
        <View style={styles.errorContainer}>
          <Icon name="alert-circle-outline" size={20} color="#FF6B6B" />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      {/* 账户输入框 */}
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>账户</Text>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={account}
            onChangeText={(text) => {
              setAccount(text);
              setErrorMessage('');
            }}
            placeholder="请输入账户名"
            placeholderTextColor="#666666"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
        </View>
      </View>

      {/* 密码输入框 */}
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>密码</Text>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setErrorMessage('');
            }}
            placeholder="请输入密码"
            placeholderTextColor="#666666"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => setShowPassword(!showPassword)}
          >
            <Icon
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={24}
              color="#888888"
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.pinHint}>
          密码用于验证账户身份，登录后需要设置PIN码保护私钥
        </Text>
      </View>

      {/* 登录按钮 */}
      <TouchableOpacity
        style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
        onPress={handleLogin}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.loginButtonText}>登录</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  // 渲染占位内容（助记词/私钥登录）
  const renderPlaceholder = () => (
    <View style={styles.placeholderContainer}>
      <Icon name="lock-outline" size={48} color="#333333" />
      <Text style={styles.placeholderText}>后续开放</Text>
      <Text style={styles.placeholderSubtext}>敬请期待</Text>
    </View>
  );

  // 渲染登录表单内容
  const renderContent = () => {
    if (loginType === 'account') {
      return renderAccountForm();
    }
    return renderPlaceholder();
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
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* 页面标题 */}
          <Text style={styles.pageTitle}>钱包登录</Text>

          {/* 登录方式 Tab */}
          {renderLoginTabs()}

          {/* 登录表单内容 */}
          {renderContent()}

          {/* 分隔线 */}
          <View style={styles.dividerLine} />

          {/* 底部创建账户链接 */}
          <TouchableOpacity
            style={styles.createAccountButton}
            onPress={handleCreateAccount}
          >
            <Text style={styles.createAccountText}>创建账户</Text>
          </TouchableOpacity>
        </ScrollView>
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
    paddingHorizontal: 20,
    paddingBottom: 20,
  },

  // 页面标题
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 16,
    marginBottom: 24,
  },

  // Tab 样式
  tabsContainer: {
    flexDirection: 'row',
    marginBottom: 32,
  },
  tabItem: {
    marginRight: 20,
  },
  tabText: {
    fontSize: 14,
    color: '#666666',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // 表单样式
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
  inputWrapperFocused: {
    borderBottomColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    paddingVertical: 8,
  },
  toggleButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  toggleButtonText: {
    fontSize: 14,
    color: '#888888',
  },
  pinHint: {
    fontSize: 12,
    color: '#666666',
    marginTop: 8,
  },

  // 登录按钮
  loginButton: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#333333',
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  loginButtonDisabled: {
    backgroundColor: '#333333',
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

  // 分隔线
  dividerLine: {
    height: 1,
    backgroundColor: '#1A1A1A',
    marginTop: 32,
  },

  // 占位内容样式
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
  },
  placeholderText: {
    fontSize: 18,
    color: '#666666',
    marginTop: 16,
  },
  placeholderSubtext: {
    fontSize: 14,
    color: '#444444',
    marginTop: 8,
  },

  // 创建账户按钮
  createAccountButton: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 24,
  },
  createAccountText: {
    fontSize: 16,
    color: '#00D094',
    fontWeight: '600',
  },
});

export default LoginScreen;
