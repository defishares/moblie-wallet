/**
 * 底部 Tab 导航器
 * 包含 5 个 Tab: 首页、市场、交易、借贷、资产
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// 导入页面组件
import {
  HomeScreen,
  MarketScreen,
  TradeScreen,
  LendingScreen,
  AssetsScreen,
} from '../screens';
import type { MainTabParamList } from '../types';

// 创建 Tab 导航器
const Tab = createBottomTabNavigator<MainTabParamList>();

// Tab 配置
const tabConfig = [
  {
    name: 'Home' as const,
    component: HomeScreen,
    label: '首页',
    icon: 'view-dashboard-outline',
    iconActive: 'view-dashboard',
  },
  {
    name: 'Market' as const,
    component: MarketScreen,
    label: '市场',
    icon: 'chart-line',
    iconActive: 'chart-line',
  },
  {
    name: 'Trade' as const,
    component: TradeScreen,
    label: '交易',
    icon: 'swap-horizontal',
    iconActive: 'swap-horizontal',
  },
  {
    name: 'Predict' as const,
    component: LendingScreen,
    label: '借贷',
    icon: 'bank-outline',
    iconActive: 'bank',
  },
  {
    name: 'Assets' as const,
    component: AssetsScreen,
    label: '资产',
    icon: 'wallet-outline',
    iconActive: 'wallet',
  },
];

const TabNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      // Tab 页面按返回键不切换 Tab，直接退出应用
      backBehavior="none"
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#666666',
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      {tabConfig.map((tab) => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={tab.component}
          options={{
            tabBarLabel: tab.label,
            tabBarIcon: ({ focused, color, size }) => (
              <Icon
                name={focused ? tab.iconActive : tab.icon}
                size={24}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0D0D0D',
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
    height: 60,
    paddingBottom: 8,
    paddingTop: 8,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});

export default TabNavigator;
