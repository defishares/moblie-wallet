# DefiShares Mobile Web

面向移动浏览器的 DefiShares 钱包，基于 React、TypeScript 和 Vite 构建。通过 `@defishares/core` 复用网络配置、RPC 和业务计算，包含行情、交易、资产、转账、借贷、闪兑及网关充提页面。

## 开发

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm mobile-web
```

默认地址：`http://localhost:5173`。

## 环境配置

将 `.env.example` 复制为本目录下的 `.env.local`，按需配置：

| 变量 | 用途 |
| --- | --- |
| `VITE_CHANNEL_TYPE` | 渠道，默认 `hdexmain`；可选值定义在共享模块中 |
| `VITE_WS_PROXY_URL` | 可选 WebSocket 代理入口，例如 `/ws` |
| `VITE_WS_PROXY_TARGET` | 开发服务器代理目标 |
| `VITE_RELEASE_VERSION` | 构建版本标识，建议使用提交 SHA |
| `VITE_ERROR_REPORT_URL` | 可选错误上报地址，部署前需同步配置 CSP 允许的目标 |

`VITE_*` 变量会进入浏览器产物，不能用于保存秘密。节点及链 ID 的默认配置位于 `../../packages/core/src/config.ts`。测试渠道当前与主网共用配置，隔离测试需先配置独立测试链。

## 检查与构建

在仓库根目录执行：

```bash
pnpm mobile-web:test
pnpm mobile-web:typecheck
pnpm mobile-web:build
pnpm mobile-web:preview
```

产物位于 `dist/`，包含 SPA 路由回退页面、Web App Manifest、图标和版本信息。静态托管服务需要将页面路由回退到应用入口；仓库提供 `_redirects` 与 `404.html`。

浏览器密钥库和认证说明见 [认证文档](../../docs/mobile-web-biometric-vault.md)，发布与回滚步骤见 [发布文档](../../docs/mobile-web-release-runbook.md)。
