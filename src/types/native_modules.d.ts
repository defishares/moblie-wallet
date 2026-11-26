/**
 * Native Modules 类型声明
 */

import { NativeModule } from 'react-native';

/**
 * AppConfig Native Module 接口
 * 用于从原生层获取构建配置信息
 */
export interface AppConfigModule extends NativeModule {
  // 常量（同步访问）
  CHANNEL_TYPE: string;
  APPLICATION_ID: string;
  BUILD_TYPE: string;
  DEBUG: boolean;
  VERSION_CODE: number;
  VERSION_NAME: string;
  
  // 方法
  getChannelType(): string;
  getChannelTypeAsync(): Promise<string>;
  isDebugBuild(): boolean;
}

// 声明 NativeModules 扩展
declare module 'react-native' {
  interface NativeModulesStatic {
    AppConfig: AppConfigModule;
  }
}

