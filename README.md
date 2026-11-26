# DefiShares Mobile

DefiShares 移动端钱包与交易客户端，基于 React Native 和 TypeScript 构建，提供账户管理、资产转账、行情交易及借贷等功能，包含 Android 与 iOS 原生工程。

[官方网站](https://defishares.org) · [问题反馈](https://github.com/defishares/mobile-app/issues)

## 主要功能

- **账户与资产**：账户注册、登录、余额查询、转账及交易记录。
- **市场与交易**：交易对行情、K 线、订单簿、限价委托及订单管理。
- **借贷与兑换**：链上借贷及流动性池闪兑。
- **网关充提**：BNB Chain USDT 充值、提币地址校验及充提记录查询。
- **钱包解锁**：PIN、生物识别及按账户隔离的解锁会话。
- **应用配置**：节点选择、自定义节点、链上配置和公告管理。

部分功能依赖链上配置及配套服务，可用性以实际部署环境为准。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 应用框架 | React Native 0.83 · React 19.2 · TypeScript |
| 导航与状态 | React Navigation 7 · Zustand 5 |
| 链交互 | bitsharesjs · bitsharesjs-ws |
| 本地存储 | MMKV · AsyncStorage · react-native-keychain |
| 图表 | WebView + 本地 K 线页面 |
| 依赖管理 | pnpm 及锁文件；包含 Keychain 原生补丁 |

## 快速开始

### 环境要求

- Node.js **20.19.4 或更新版本**，pnpm **10 或更新版本**。
- Android：JDK 17、Android SDK Platform 36、Build Tools 34.0.0、NDK 27.1.12297006；最低支持 Android 7.0（API 24）。
- iOS：macOS、Xcode、Ruby、Bundler 与 CocoaPods；原生依赖由 `Gemfile` 和 `Podfile` 管理。

### 安装依赖

```bash
git clone https://github.com/defishares/mobile-app.git
cd mobile-app
pnpm install --frozen-lockfile
```

使用 pnpm 安装，以应用 `pnpm-workspace.yaml` 中声明的 Keychain 补丁。

### 运行 Android

先启动模拟器或连接已开启 USB 调试的设备。

```bash
# 终端一：启动 Metro
pnpm start

# 终端二：编译并运行主网调试版
pnpm android
```

项目通过 Gradle Product Flavors 区分渠道：

| Flavor | 用途 | Application ID |
| --- | --- | --- |
| `defiShares` | 主网 | `org.defishares.hdexapp` |
| `hdexmainadmin` | 主网管理 | `org.defishares.hdexapp.admin` |
| `hdextest` | 测试渠道 | `org.defishares.hdexapp.testnet` |
| `hdextestadmin` | 测试管理渠道 | `org.defishares.hdexapp.testnet.admin` |

### 运行 iOS

在仓库根目录执行：

```bash
bundle install
pnpm ios:installdeps
pnpm start
# 在另一终端执行
pnpm ios
```

也可使用 Xcode 打开 `ios/HdexApp.xcworkspace`，配置签名后运行。iOS 原生渠道注入尚未实现，当前开发构建默认使用 `hdextest`，发布构建默认使用 `hdexmain`。

## 网络与服务配置

| 配置入口 | 内容 |
| --- | --- |
| `src/config/constants.ts` | 链 ID、WebSocket 节点、核心资产、渠道与链上配置账户 |
| `src/services/gateway_api.ts` | 网关 API、充提币种及链上网关账户 |
| `src/screens/RegisterScreen.tsx` | 账户注册 Faucet 地址 |
| `src/config/announcementAdmins.ts` | 公告管理配置 |
| `android/app/build.gradle` | Android 渠道、应用 ID 和签名配置 |

**测试渠道当前与主网使用相同的节点和链 ID。** 进行隔离测试前，需先配置独立的测试链与配套服务。

## 构建与检查

以下命令均在仓库根目录执行。

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm exec node --test tests/*.test.cjs
```

### Android 发布包

在本机 `~/.gradle/gradle.properties` 或 CI 的私密配置中提供签名参数：

```properties
HDEX_RELEASE_STORE_FILE=/absolute/path/to/release.keystore
HDEX_RELEASE_KEY_ALIAS=your-key-alias
HDEX_RELEASE_STORE_PASSWORD=your-store-password
HDEX_RELEASE_KEY_PASSWORD=your-key-password
```

```bash
# 构建主网发布 APK
pnpm android:main:dist
```

输出目录：`android/app/build/outputs/apk/defiShares/release/`。

当前 `android/app/build.gradle` 的 `hermesCommand` 指向 Windows 可执行文件。在 macOS、Linux 或不同依赖布局下构建发布包前，需移除此硬编码配置以采用 React Native 默认工具链，或将其调整为本机构建工具路径。

## 目录结构

```text
mobile-app/
├── README.md
├── App.tsx                     # 应用入口
├── android/                    # Android 原生工程与构建配置
├── ios/                        # iOS 原生工程
├── patches/                    # 原生依赖补丁
├── src/
│   ├── assets/                 # 图片与 K 线资源
│   ├── components/             # 通用组件
│   ├── config/                 # 网络、渠道与常量
│   ├── hooks/                  # 业务 Hooks
│   ├── navigation/             # 页面导航
│   ├── screens/                # 业务页面
│   ├── services/               # 链交互、网关与安全存储
│   ├── store/                  # 状态管理
│   ├── types/                  # 类型定义
│   └── utils/                  # 工具函数
└── tests/                      # 存储、流动性池和解锁会话测试
```

## 贡献

请通过 Issue 描述问题或建议。提交 Pull Request 时，请说明修改目的、影响范围和验证结果。签名密钥、账户私钥及真实凭据应保存在本地或 CI 私密配置中。
