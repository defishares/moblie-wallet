/**
 * 应用主导航器
 * 管理启动页、主 Tab 导航和其他全屏页面
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// 导入页面和导航器
import {
  LaunchScreen,
  LoginScreen,
  RegisterScreen,
  KLineScreen,
  SettingsScreen,
  AboutScreen,
  SetupPinScreen,
  TransferScreen,
  WebViewScreen,
  InvitationScreen,
  DailyCheckinScreen,
} from '../screens';
import TabNavigator from './TabNavigator';
import type { RootStackParamList } from '../types';

// 创建 Stack 导航器
const Stack = createNativeStackNavigator<RootStackParamList>();

// 超快速动画配置 - 接近原生 App 的速度感
const fastSlideAnimation = {
  animation: 'slide_from_right' as const,
  animationDuration: 100, // 极短动画时长，接近瞬间切换
};

const fastFadeAnimation = {
  animation: 'fade' as const,
  animationDuration: 80,
};

const fastModalAnimation = {
  animation: 'slide_from_bottom' as const,
  animationDuration: 120,
  presentation: 'modal' as const,
};

// 无动画配置 - 完全瞬间切换（如果上面还是慢可以用这个）
const noAnimation = {
  animation: 'none' as const,
};

const AppNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Launch"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: 100, // 全局快速动画
          // 禁用手势动画的弹性效果，让返回更干脆
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      >
        {/* 启动页 - 用于初始化数据 */}
        <Stack.Screen
          name="Launch"
          component={LaunchScreen}
          options={{
            gestureEnabled: false,
            ...fastFadeAnimation,
          }}
        />

        {/* 登录页 - 钱包登录 */}
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{
            gestureEnabled: false,
            ...fastSlideAnimation,
          }}
        />

        {/* 注册页 - 创建新账户 */}
        <Stack.Screen
          name="Register"
          component={RegisterScreen}
          options={{
            gestureEnabled: true,
            ...fastSlideAnimation,
          }}
        />

        {/* 设置 PIN 码页面 - 登录成功后设置 */}
        <Stack.Screen
          name="SetupPin"
          component={SetupPinScreen}
          options={{
            gestureEnabled: false,
            ...fastSlideAnimation,
          }}
        />

        {/* 主 Tab 导航 - 包含底部导航栏的主页面 */}
        <Stack.Screen
          name="MainTabs"
          component={TabNavigator}
          options={{
            gestureEnabled: false, // 禁用手势返回
            fullScreenGestureEnabled: false, // 禁用全屏手势
            ...fastFadeAnimation,
          }}
        />

        {/* K线详情页 - 从市场列表点击进入 */}
        <Stack.Screen
          name="KLine"
          component={KLineScreen}
          options={{
            gestureEnabled: true,
            ...fastSlideAnimation,
          }}
        />

        {/* 设置页面 */}
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            gestureEnabled: true,
            ...fastSlideAnimation,
          }}
        />

        {/* 关于页面 */}
        <Stack.Screen
          name="About"
          component={AboutScreen}
          options={{
            gestureEnabled: true,
            ...fastSlideAnimation,
          }}
        />

        {/* 转账页面 */}
        <Stack.Screen
          name="Transfer"
          component={TransferScreen}
          options={{
            gestureEnabled: true,
            ...fastSlideAnimation,
          }}
        />

        {/* 内置网页查看页面 */}
        <Stack.Screen
          name="WebView"
          component={WebViewScreen}
          options={{
            gestureEnabled: true,
            ...fastSlideAnimation,
          }}
        />

        {/* 邀请计划页面 */}
        <Stack.Screen
          name="Invitation"
          component={InvitationScreen}
          options={{
            gestureEnabled: true,
            ...fastSlideAnimation,
          }}
        />

        {/* 每日签到页面 */}
        <Stack.Screen
          name="DailyCheckin"
          component={DailyCheckinScreen}
          options={{
            gestureEnabled: true,
            ...fastSlideAnimation,
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
