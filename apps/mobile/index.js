/**
 * @format
 */

// Node.js polyfills - 必须最先导入
import './shim';

// 启用 react-native-screens 原生视图优化 - 必须在导航相关代码之前调用
// 这对导航性能有显著提升，使用原生视图而不是 JS 视图
import { enableScreens } from 'react-native-screens';
enableScreens(true);

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
