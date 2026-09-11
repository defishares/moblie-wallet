/**
 * Defishares App 入口文件
 * 数字资产交易平台 React Native 应用
 * 
 * 技术栈：
 * - React Native + TypeScript
 * - Zustand 状态管理
 * - React Native Elements UI 框架
 * - React Navigation 导航
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, createTheme } from '@rneui/themed';

// 导入应用导航器
import { AppNavigator } from './src/navigation';
// 导入全局组件容器
import { ToastContainer } from './src/components/Toast';
import { BlockViewContainer } from './src/components/BlockView';
import { UnlockModalContainer } from './src/components/UnlockModal';
import { ActionSheetContainer } from './src/components/ActionSheet';
import { MoreFunctionsSheetContainer } from './src/components/MoreFunctionsSheet';

// 创建自定义主题
const theme = createTheme({
  // 设置暗色模式
  mode: 'dark',
  // 自定义颜色
  lightColors: {
    primary: '#00D094',
    secondary: '#1A1A1A',
    background: '#0D0D0D',
  },
  darkColors: {
    primary: '#00D094',
    secondary: '#1A1A1A',
    background: '#0D0D0D',
  },
  // 组件默认样式
  components: {
    Text: {
      style: {
        color: '#FFFFFF',
      },
    },
    Button: {
      buttonStyle: {
        borderRadius: 8,
      },
    },
  },
});

/**
 * App 根组件
 * 包装必要的 Provider 并渲染主导航器
 */
const App: React.FC = () => {
  return (
    // SafeAreaProvider - 处理安全区域（刘海屏、底部手势区域等）
    <SafeAreaProvider>
      {/* ThemeProvider - React Native Elements 主题提供者 */}
      <ThemeProvider theme={theme}>
        {/* AppNavigator - 应用主导航器 */}
        <AppNavigator />
        {/* Toast 全局提示容器 */}
        <ToastContainer />
        {/* BlockView 全局阻塞视图容器 */}
        <BlockViewContainer />
        {/* UnlockModal 全局解锁弹窗容器 */}
        <UnlockModalContainer />
        {/* ActionSheet 全局操作菜单容器 */}
        <ActionSheetContainer />
        {/* MoreFunctionsSheet 更多功能菜单容器 */}
        <MoreFunctionsSheetContainer />
      </ThemeProvider>
    </SafeAreaProvider>
  );
};

export default App;
