declare module 'bitsharesjs' {
  export interface PrivateKeyLike {
    toWif(): string;
    toPublicKey(): { toString(): string; toPublicKeyString(): string };
  }

  export const PrivateKey: {
    fromSeed(seed: string): PrivateKeyLike;
    fromWif(wif: string): PrivateKeyLike;
  };

  export const Aes: {
    encrypt_with_checksum(privateKey: PrivateKeyLike, publicKey: string, nonce: string, message: unknown): unknown;
  };
  export const TransactionHelper: {
    unique_nonce_uint64(): string;
  };

  export class TransactionBuilder {
    ref_block_num: number;
    ref_block_prefix: number;
    expiration: number;
    add_type_operation(name: string, operation: Record<string, unknown>): void;
    finalize(): Promise<void>;
    add_signer(privateKey: PrivateKeyLike, publicKey: string): void;
    sign(chainId: string): void;
    serialize(): Record<string, unknown>;
  }
}

declare module 'bitsharesjs-ws' {
  export const ChainConfig: {
    setPrefix(prefix: string): void;
  };
  const defaultExport: { ChainConfig: typeof ChainConfig };
  export default defaultExport;
}
