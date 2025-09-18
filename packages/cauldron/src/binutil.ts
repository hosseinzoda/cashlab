import { hexToBin, uint8ArrayConcat, uint8ArrayEqual } from '@cashlab/common/util.js';
import { ValueError } from '@cashlab/common/exceptions.js';
import type { PoolV0Parameters } from './types.js';

const POOLV0_PRE_PUBKEY_BIN: Uint8Array = hexToBin('44746376a914');
const POOLV0_PUBKEY_OFFSET: number = POOLV0_PRE_PUBKEY_BIN.length;
const POOLV0_PUBKEY_SIZE: number = 20;
const POOLV0_POST_PUBKEY_OFFSET: number = POOLV0_PUBKEY_OFFSET + POOLV0_PUBKEY_SIZE;
const POOLV0_POST_PUBKEY_BIN: Uint8Array = hexToBin('88ac67c0d1c0ce88c25288c0cdc0c788c0c6c0d095c0c6c0cc9490539502e80396c0cc7c94c0d3957ca268');
const POOLV0_SIZE: number = POOLV0_PUBKEY_OFFSET + POOLV0_PUBKEY_SIZE + 43;

/**
 * Reads the type of the transaction and the pool's parameters from a p2sh unlocking bytecode if the locking bytecode is a PoolV0.
 * @param unlocking_bytecode the unlocking bytecode of a transaction input.
 * @returns the result of the extracted data or null if the bytecode is not PoolV0
 */
export const extractInfoFromPoolV0UnlockingBytecode = (unlocking_bytecode: Uint8Array): { parameters: PoolV0Parameters, type: 'withdraw' | 'trade' } | null => {
  let offset = unlocking_bytecode.length - POOLV0_SIZE;
  if (!uint8ArrayEqual(unlocking_bytecode.subarray(offset, offset + POOLV0_PUBKEY_OFFSET), POOLV0_PRE_PUBKEY_BIN) ||
      !uint8ArrayEqual(unlocking_bytecode.subarray(offset + POOLV0_POST_PUBKEY_OFFSET, offset + POOLV0_SIZE), POOLV0_POST_PUBKEY_BIN)) {
    return null;
  }
  return {
    parameters: {
      withdraw_pubkey_hash: unlocking_bytecode.subarray(POOLV0_PUBKEY_OFFSET, POOLV0_POST_PUBKEY_OFFSET),
    },
    type: offset == 0 ? 'trade' : 'withdraw',
  };
};

/**
 * Generates PoolV0 redeem script from given parameters.
 * @param parameters `{ withdraw_pubkey_hash }`
 * @returns unlocking bytecode
 */
export const buildPoolV0RedeemScriptBytecode = (parameters: PoolV0Parameters): Uint8Array => {
  if (parameters.withdraw_pubkey_hash.length != 20) {
    throw new ValueError('The size of parameters.withdraw_pubkey_hash should be 20 bytes');
  }
  return uint8ArrayConcat([
    POOLV0_PRE_PUBKEY_BIN.slice(1), // exclude OP_PUSH
    parameters.withdraw_pubkey_hash,
    POOLV0_POST_PUBKEY_BIN
  ]);
};

/**
 * Generates a bytecode for PoolV0 exchange unlocking.
 * @param parameters `{ withdraw_pubkey_hash }`
 * @returns unlocking bytecode
 */
export const buildPoolV0UnlockingBytecode = (parameters: PoolV0Parameters): Uint8Array => {
  if (parameters.withdraw_pubkey_hash.length != 20) {
    throw new ValueError('The size of parameters.withdraw_pubkey_hash should be 20 bytes');
  }
  return uint8ArrayConcat([ POOLV0_PRE_PUBKEY_BIN, parameters.withdraw_pubkey_hash, POOLV0_POST_PUBKEY_BIN ]);
};


