/**
 * Node.js Polyfills for React Native
 * 必须在 index.js 最开头引入
 */

// 导入 react-native-get-random-values 来支持 crypto.getRandomValues
import 'react-native-get-random-values';

// Buffer polyfill
import { Buffer } from 'buffer';
global.Buffer = Buffer;

// Process polyfill
import process from 'process';
global.process = process;

// TextEncoder/TextDecoder polyfill
import { TextEncoder, TextDecoder } from 'text-encoding';
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

