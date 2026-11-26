# DefiShares Wallet

**English** | [简体中文](README.zh-CN.md)

A DefiShares wallet monorepo with a React Native app for Android and iOS, a React client for mobile browsers, and a shared TypeScript core. Both clients are maintained on the same main branch using pnpm Workspaces.

[Website](https://defishares.org) · [Issues](https://github.com/defishares/moblie-wallet/issues)

## Repository structure

```text
moblie-wallet/
├── apps/
│   ├── mobile/          # React Native: Android / iOS
│   └── mobile-web/      # React + Vite: mobile browsers
├── packages/
│   └── core/            # Shared configuration, RPC, amounts and market data
├── patches/             # Native dependency patches
├── tests/               # Cross-client compatibility tests
├── scripts/             # Testnet preflight and development tools
└── docs/                # Technical notes and release procedures
```

| Project | Package | Stack | Guide |
| --- | --- | --- | --- |
| Native app | `@defishares/mobile` | React Native 0.83 · React 19.2 · TypeScript | [mobile](apps/mobile/README.md) (Chinese) |
| Mobile browser app | `@defishares/mobile-web` | React 19.2 · Vite 7 · TypeScript | [mobile-web](apps/mobile-web/README.md) (Chinese) |
| Shared core | `@defishares/core` | TypeScript | [Source](packages/core/src/index.ts) |

The clients include account and asset management, market data, trading, transfers, lending, liquidity-pool swaps, and gateway deposits and withdrawals. Each client implements its own storage and authentication. Feature availability depends on on-chain configuration and supporting services.

## Installation

Use Node.js **20.19.4 or later** and pnpm. The repository pins pnpm **11.25.0** through the `packageManager` field.

```bash
git clone https://github.com/defishares/moblie-wallet.git
cd moblie-wallet
pnpm install --frozen-lockfile
```

Install dependencies once at the repository root. Run the commands below from the root unless specified otherwise.

## Run the clients

### mobile-web

```bash
pnpm mobile-web
```

The development server runs at `http://localhost:5173`. To customize its configuration, copy `apps/mobile-web/.env.example` to `.env.local` in the same directory.

```bash
pnpm mobile-web:build
pnpm mobile-web:preview
```

Production files are generated in `apps/mobile-web/dist/`. Deploy them to a static host that supports SPA route fallback. Generated builds are excluded from Git.

### mobile

Android requires JDK 17 and the Android SDK. iOS requires macOS, Xcode, Ruby, Bundler and CocoaPods. See the [native app guide](apps/mobile/README.md) for SDK versions and release signing configuration.

```bash
# Terminal 1: Metro
pnpm mobile:start

# Terminal 2: Android emulator or connected device
pnpm mobile:android
```

For the first iOS run:

```bash
cd apps/mobile
bundle install
cd ../..
pnpm mobile:ios:installdeps
pnpm mobile:ios
```

## Tests and builds

```bash
# Shared core, browser, native utility and cross-client tests
pnpm test

# Shared core and browser type checks, then a browser production build
pnpm verify:mobile-web

# Native app type check
pnpm mobile:typecheck

# Android mainnet release APK; local signing configuration is required
pnpm mobile:build:android
```

## Configuration and maintenance

- Shared networks, chain IDs and WebSocket nodes: `packages/core/src/config.ts`.
- Native configuration: `apps/mobile/src/config/constants.ts`.
- Browser environment variables: `apps/mobile-web/.env.example`.
- Read-only testnet preflight: `pnpm testnet:preflight`, with `E2E_WS_NODE` and `E2E_CHAIN_ID` set.
- [Browser release procedure](docs/mobile-web-release-runbook.md) and [browser authentication notes](docs/mobile-web-biometric-vault.md) (Chinese).

The test channel currently shares the mainnet nodes and chain ID. Configure an independent test chain before isolated testing. Keep signing keys, account private keys and real credentials in local or CI secret configuration.

Validate shared logic changes against both clients. Keep platform-specific navigation, UI, storage and authentication in the corresponding app directory.
