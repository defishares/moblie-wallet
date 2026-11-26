/**
 * 预测页面组件
 * 底部导航栏第四个 Tab - 预测
 * 目前为空白占位页面
 */

import React from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';

const PredictScreen: React.FC = () => {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />
      <View style={styles.content}>
        <Text style={styles.title}>预测</Text>
        <Text style={styles.subtitle}>敬请期待</Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
  },
});

export default PredictScreen;

