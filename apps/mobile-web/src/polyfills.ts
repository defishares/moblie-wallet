import { Buffer } from 'buffer';

// bitsharesjs was originally published for Node/React Native and reads
// process.env during module evaluation. Supply the minimal browser shape
// before the wallet crypto modules are imported.
const globalScope = globalThis as typeof globalThis & {
  process?: { env: Record<string, string | undefined>; browser?: boolean; version?: string };
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
};
if (!globalScope.process) globalScope.process = { env: {} } as typeof globalScope.process;
globalScope.process.browser = true;
globalScope.process.version ??= 'v18.0.0';
globalScope.Buffer ??= Buffer;
globalScope.global ??= globalThis;
