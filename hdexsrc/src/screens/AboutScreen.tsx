/**
 * 关于页面
 * 展示应用介绍、版本信息和联系方式
 */

import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Linking,
  ScrollView,
  Platform,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import {
  APP_VERSION,
  CURRENT_NETWORK_TYPE,
} from '../config/constants';

// 官网地址
const OFFICIAL_WEBSITE = 'https://rwacn.org';

const AboutScreen: React.FC = () => {
  const navigation = useNavigation();

  // 打开官网链接
  const handleOpenWebsite = async () => {
    try {
      const supported = await Linking.canOpenURL(OFFICIAL_WEBSITE);
      if (supported) {
        await Linking.openURL(OFFICIAL_WEBSITE);
      }
    } catch (error) {
      console.error('[About] 打开链接失败:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      {/* 头部导航栏 */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>关于</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo 区域 */}
        <View style={styles.logoSection}>
          <View style={styles.logoContainer}>
            <View style={styles.logoInner}>
              <Text style={styles.logoText}>H</Text>
            </View>
          </View>
          <Text style={styles.appName}>Hdex v{APP_VERSION}</Text>
        </View>

        {/* 产品介绍 */}
        <View style={styles.descriptionSection}>
          <Text style={styles.descriptionText}>
            Hdex 是一款安全、高效的去中心化交易平台。基于石墨烯区块链技术打造，为您提供媲美中心化交易所的流畅体验，同时确保资产完全由您掌控。
          </Text>
        </View>

        {/* 联系我们 */}
        <View style={styles.contactSection}>
          <Text style={styles.contactTitle}>联系我们</Text>
          <TouchableOpacity
            style={styles.contactItem}
            onPress={handleOpenWebsite}
            activeOpacity={0.7}
          >
            <Text style={styles.contactLabel}>官网：</Text>
            <Text style={styles.contactLink}>{OFFICIAL_WEBSITE}</Text>
          </TouchableOpacity>
        </View>

        {/* 底部构建信息 */}
        <View style={styles.footer}>
          <View style={styles.buildInfo}>
            <Text style={styles.buildLabel}>网络：</Text>
            <Text style={[
              styles.buildValue,
              CURRENT_NETWORK_TYPE === 'testnet' && { color: '#FFA500' }
            ]}>
              {CURRENT_NETWORK_TYPE === 'mainnet' ? '主网' : '测试网'}
            </Text>
            <Text style={styles.buildSeparator}>|</Text>
            <Text style={styles.buildLabel}>模式：</Text>
            <Text style={[
              styles.buildValue,
              __DEV__ ? { color: '#FFA500' } : { color: '#00D094' }
            ]}>
              {__DEV__ ? 'Debug' : 'Release'}
            </Text>
          </View>
          <Text style={styles.footerVersion}>Hdex v{APP_VERSION}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },

  // 头部样式
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerRight: {
    width: 40,
  },

  // 内容区域
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 40,
    flexGrow: 1,
  },

  // Logo 区域
  logoSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoContainer: {
    width: 80,
    height: 80,
    backgroundColor: '#2D2D2D',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoInner: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 42,
    fontWeight: '700',
    color: '#D4A84B',
    fontFamily: Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif-medium',
  },
  appName: {
    fontSize: 16,
    color: '#888888',
    fontWeight: '500',
  },

  // 产品介绍
  descriptionSection: {
    marginBottom: 32,
  },
  descriptionText: {
    fontSize: 16,
    lineHeight: 28,
    color: '#CCCCCC',
    textAlign: 'left',
  },

  // 联系我们
  contactSection: {
    marginBottom: 48,
  },
  contactTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactLabel: {
    fontSize: 15,
    color: '#CCCCCC',
  },
  contactLink: {
    fontSize: 15,
    color: '#00D094',
  },

  // 底部
  footer: {
    alignItems: 'flex-start',
    flex: 1,
    justifyContent: 'flex-end',
    minHeight: 60,
  },
  buildInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  buildLabel: {
    fontSize: 13,
    color: '#666666',
  },
  buildValue: {
    fontSize: 13,
    color: '#00D094',
    fontWeight: '500',
  },
  buildSeparator: {
    fontSize: 13,
    color: '#444444',
    marginHorizontal: 10,
  },
  footerVersion: {
    fontSize: 14,
    color: '#666666',
  },
});

export default AboutScreen;

