import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
  plugins: [react(), {
    name: 'defishares-production-csp',
    transformIndexHtml: { order: 'post', handler: (html, context) => context.server ? html : html.replace('</head>', `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' wss: https://gate.defishares.org; frame-src https://defishares.org https://*.defishares.org; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action 'self'" /></head>`) },
  }],
  resolve: {
    // bitsharesjs depends on Node's stream implementation for create-hash.
    // Alias it explicitly so browser PrivateKey.fromSeed() uses the same
    // hashing path instead of Vite's empty Node-module externalization.
    alias: {
      stream: 'stream-browserify',
      util: 'util',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/ws': {
        target: env.VITE_WS_PROXY_TARGET || 'https://api.defishares.org',
        changeOrigin: true,
        secure: true,
        ws: true,
        rewrite: path => path === '/ws' ? '/ws/' : path,
      },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      plugins: [{
        name: 'defishares-release-manifest',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: process.env.VITE_RELEASE_VERSION || process.env.GIT_COMMIT_SHA || 'local', builtAt: new Date().toISOString() }, null, 2) });
        },
      }],
    },
  },
  };
});
