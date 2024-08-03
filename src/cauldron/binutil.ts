import { hexToBin } from '@bitauth/libauth';
import type { PoolV0Parameters } from './types.js';

const POOLV0_PRE_PUBKEY_BIN: Buffer = Buffer.from(hexToBin('44746376a914'));
const POOLV0_PUBKEY_OFFSET: number = POOLV0_PRE_PUBKEY_BIN.length;
const POOLV0_PUBKEY_SIZE: number = 20;
const POOLV0_POST_PUBKEY_OFFSET: number = POOLV0_PUBKEY_OFFSET + POOLV0_PUBKEY_SIZE;
const POOLV0_POST_PUBKEY_BIN: Buffer = Buffer.from(hexToBin('88ac67c0d1c0ce88c25288c0cdc0c788c0c6c0d095c0c6c0cc9490539502e80396c0cc7c94c0d3957ca268'));
const POOLV0_SIZE: number = POOLV0_PUBKEY_OFFSET + POOLV0_PUBKEY_SIZE + 43;

export const extractInfoFromPoolV0UnlockingBytecode = (unlocking_bytecode: Uint8Array): { parameters: PoolV0Parameters, type: 'withdraw' | 'trade' } | null => {
  const unlocking_bytecode_buff = unlocking_bytecode instanceof Buffer ? unlocking_bytecode : Buffer.from(unlocking_bytecode);
  let offset = unlocking_bytecode_buff.length - POOLV0_SIZE;
  if (!unlocking_bytecode_buff.subarray(offset, offset + POOLV0_PUBKEY_OFFSET).equals(POOLV0_PRE_PUBKEY_BIN) ||
      !unlocking_bytecode_buff.subarray(offset + POOLV0_POST_PUBKEY_OFFSET, offset + POOLV0_SIZE).equals(POOLV0_POST_PUBKEY_BIN)) {
    return null;
  }
  return {
    parameters: {
      withdraw_pubkey_hash: unlocking_bytecode_buff.subarray(POOLV0_PUBKEY_OFFSET, POOLV0_POST_PUBKEY_OFFSET),
    },
    type: offset == 0 ? 'trade' : 'withdraw',
  };
};

export const buildPoolV0UnlockingBytecode = (parameters: PoolV0Parameters): Uint8Array => {
  const bytecode = Buffer.alloc(POOLV0_PRE_PUBKEY_BIN.length + POOLV0_PUBKEY_SIZE + POOLV0_POST_PUBKEY_BIN.length);
  POOLV0_PRE_PUBKEY_BIN.copy(bytecode, 0);
  Buffer.from(parameters.withdraw_pubkey_hash).copy(bytecode, POOLV0_PUBKEY_OFFSET);
  POOLV0_POST_PUBKEY_BIN.copy(bytecode, POOLV0_PUBKEY_OFFSET + POOLV0_PUBKEY_SIZE);
  return bytecode as Uint8Array; // Buffer is inherited from Uint8Array
};
