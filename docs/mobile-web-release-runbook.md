# Web 发布与回滚清单

## 发布前

1. 使用 `VITE_RELEASE_VERSION`（推荐填 Git commit SHA）执行 `pnpm verify:mobile-web`、`pnpm cross:test`，并确认 `pnpm audit --prod` 为 0 vulnerabilities。
2. 检查 `dist/version.json`、`dist/index.html` 的 CSP 和内容哈希静态资源。
3. 在桌面 Chrome、平板和移动浏览器分别打开首页、市场、交易、借贷、闪兑、资产、订单和设置页，确认节点状态和布局无溢出。
4. 先设置真实 Testnet 的 `E2E_WS_NODE`、`E2E_CHAIN_ID`（可选 `E2E_ACCOUNT`）并运行 `pnpm testnet:preflight`；该命令只读校验链 ID、区块高度、流动性池和账户，不会广播。
5. 在 Testnet 用专用测试账户完成登录、预览、签名、广播、转账回执、限价单、撤单、借贷、流动性和 BSC bridge 流程。
6. 配置 `VITE_ERROR_REPORT_URL` 时仅接收脱敏错误，不接收密码、WIF、memo 或账户对象。

## 回滚

- 保留最近两个带 `version.json` 的 dist 构建目录。
- 发现节点协议、签名或 bridge 回执异常时，将静态托管指针切回上一个构建目录，并保留当前版本号和错误时间窗口。
- 回滚后重新检查登录页、节点连接和只读行情；不要自动重试任何广播。
