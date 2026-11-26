const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // Watch workspace packages linked from this app by pnpm.
  watchFolders: [path.resolve(__dirname, '../..')],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../../node_modules'),
    ],
    // 添加 html 到资源扩展名列表，使其可以被 require() 加载
    assetExts: [...defaultConfig.resolver.assetExts, 'html'],
    extraNodeModules: {
      // Node.js polyfills for React Native
      assert: require.resolve('assert'),
      buffer: require.resolve('buffer'),
      process: require.resolve('process'),
      stream: require.resolve('stream-browserify'),
      events: require.resolve('events'),
      crypto: require.resolve('react-native-get-random-values'),
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
