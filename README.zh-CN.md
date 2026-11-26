# DefiShares Wallet

[English](README.md) | **简体中文**

DefiShares 钱包客户端，包含 React Native 原生应用和面向移动浏览器的 React 应用。两个客户端在同一主分支维护，通过 pnpm Workspace 共享网络配置、链交互和业务计算模块。

[官方网站](https://defishares.org) · [问题反馈](https://github.com/defishares/moblie-wallet/issues)

## 项目结构

```text
moblie-wallet/
├── apps/
│   ├── mobile/          # React Native：Android / iOS
│   └── mobile-web/      # React + Vite：移动浏览器
├── packages/
│   └── core/            # 共享配置、RPC、金额与行情计算
├── patches/             # 原生依赖补丁
├── tests/               # 跨客户端一致性测试
├── scripts/             # 测试网络预检等工具
└── docs/                # 技术说明与发布流程
```

| 项目 | 包名 | 技术栈 | 开发说明 |
| --- | --- | --- | --- |
| 原生客户端 | `@defishares/mobile` | React Native 0.83 · React 19.2 · TypeScript | [mobile](apps/mobile/README.md) |
| 移动浏览器客户端 | `@defishares/mobile-web` | React 19.2 · Vite 7 · TypeScript | [mobile-web](apps/mobile-web/README.md) |
| 共享模块 | `@defishares/core` | TypeScript | [源码](packages/core/src/index.ts) |

两个客户端提供账户与资产管理、行情交易、借贷、闪兑及网关充提等功能。设备存储和认证分别由原生客户端与浏览器客户端实现，功能可用性取决于链上配置及配套服务。

## 安装

需要 Node.js **20.19.4 或更新版本**及 pnpm；仓库通过 `packageManager` 固定使用 pnpm **11.25.0**。

```bash
git clone https://github.com/defishares/moblie-wallet.git
cd moblie-wallet
pnpm install --frozen-lockfile
```

依赖在根目录统一安装，所有下列命令均从根目录执行。

## 启动客户端

### mobile-web

```bash
pnpm mobile-web
```

开发地址为 `http://localhost:5173`。需要自定义配置时，将 `apps/mobile-web/.env.example` 复制为同目录下的 `.env.local`。

```bash
pnpm mobile-web:build
pnpm mobile-web:preview
```

构建产物位于 `apps/mobile-web/dist/`，可部署到支持 SPA 路由回退的静态托管服务。构建产物不提交到 Git。

### mobile

Android 需要 JDK 17 与 Android SDK；iOS 需要 macOS、Xcode、Ruby、Bundler 与 CocoaPods。详细版本和发布签名配置见 [原生客户端说明](apps/mobile/README.md)。

```bash
# 终端一：Metro
pnpm mobile:start

# 终端二：Android 模拟器或已连接设备
pnpm mobile:android
```

iOS 首次运行：

```bash
cd apps/mobile
bundle install
cd ../..
pnpm mobile:ios:installdeps
pnpm mobile:ios
```

## 检查与构建

```bash
# 共享模块、浏览器、原生工具函数及跨客户端测试
pnpm test

# 共享模块与浏览器类型检查、浏览器生产构建
pnpm verify:mobile-web

# 原生工程类型检查
pnpm mobile:typecheck

# Android 主网发布 APK（需要本机签名配置）
pnpm mobile:build:android
```

## 配置与维护

- 共享网络、链 ID 和节点列表：`packages/core/src/config.ts`。
- 原生应用配置：`apps/mobile/src/config/constants.ts`。
- 浏览器运行参数：`apps/mobile-web/.env.example`。
- 测试网络只读预检：`pnpm testnet:preflight`，需提供 `E2E_WS_NODE` 与 `E2E_CHAIN_ID`。
- [浏览器发布流程](docs/mobile-web-release-runbook.md)与[浏览器认证说明](docs/mobile-web-biometric-vault.md)。

当前测试渠道与主网共用节点和链 ID。隔离测试前应配置独立测试链。签名密钥、账户私钥和真实凭据保存在本地或 CI 私密配置中。

共享逻辑修改应同时通过两个客户端相关检查。平台专属的导航、界面、存储和认证逻辑放在对应应用目录内。
