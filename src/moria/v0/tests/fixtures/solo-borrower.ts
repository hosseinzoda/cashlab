import {
  generatePrivateKey, encodePrivateKeyWif, hash160, secp256k1, hexToBin,
  privateKeyToP2pkhLockingBytecode, privateKeyToP2pkhCashAddress,
} from '@bitauth/libauth';
import type { PayoutRule, SpendableCoin } from '../../../../common/types.js';
import { SpendableCoinType, PayoutAmountRuleType } from '../../../../common/constants.js';

export const PRIVATE_KEY = generatePrivateKey();
export const PRIVATE_KEY_WIF = encodePrivateKeyWif(PRIVATE_KEY, 'mainnet');
export const PUBLIC_KEY_COMPRESSED = secp256k1.derivePublicKeyCompressed(PRIVATE_KEY) as Uint8Array;
if (typeof PUBLIC_KEY_COMPRESSED == 'string') {
  throw new Error(PUBLIC_KEY_COMPRESSED);
}
export const PKH = hash160(PUBLIC_KEY_COMPRESSED);
export const P2PKH_LOCKING_BYTECODE = privateKeyToP2pkhLockingBytecode({ privateKey: PRIVATE_KEY });
export const P2PKH_ADDRESS = privateKeyToP2pkhCashAddress({ privateKey: PRIVATE_KEY });
export const PURE_BCH_INPUT_COINS: SpendableCoin[] = [
  10000n, 15000n, 20000n, 520000n, 1000000n, 20000000n, 100000000n, 1000000000n,
].map((amount, index) => ({
  type: SpendableCoinType.P2PKH,
  key: PRIVATE_KEY,
  outpoint: {
    txhash: hexToBin('00'.repeat(32)),
    index: index,
  },
  output: {
    locking_bytecode: P2PKH_LOCKING_BYTECODE,
    amount,
  },
}));
export const MUSD_INPUT_COINS: SpendableCoin[] = [
  10n, 100n, 200n, 1500n, 20000n, 30000n, 100000n
].map((amount, index) => ({
  type: SpendableCoinType.P2PKH,
  key: PRIVATE_KEY,
  outpoint: {
    txhash: hexToBin('01'.repeat(32)),
    index: index,
  },
  output: {
    locking_bytecode: P2PKH_LOCKING_BYTECODE,
    token: {
      amount,
      token_id: '4046913cba6b70b2214a048a3df92252849f481ffa1455ed7faf17243c36bf67',
    },
    amount: 1000n,
  },
}));

export const CHANGE_PAYOUT_RULE: PayoutRule = {
  locking_bytecode: P2PKH_LOCKING_BYTECODE,
  type: PayoutAmountRuleType.CHANGE,
};

/* NOTUSED
export const SAMPLE_LOAN_UTXO: UTXOWithNFT = {
  outpoint: {
    txhash: hexToBin('01' + '00'.repeat(31)),
    index: 2,
  },
  output: {
    locking_bytecode: hexToBin('aa20b758a71d99ea449f56cbdfb68516be858480fc320e8365b86917e8a7871b0f4387'),
    // collateral amount, 2bch
    amount: 200000000n,
    token: {
      amount: 0n,
      token_id: '4046913cba6b70b2214a048a3df92252849f481ffa1455ed7faf17243c36bf67',
      nft: {
        capability: NonFungibleTokenCapability.none,
        // loan_amount = 50000 // (50c3)
        commitment: new Uint8Array(Buffer.concat([ PKH, hexToBin('50c3') ])),
      },
    },
  },
};
*/
