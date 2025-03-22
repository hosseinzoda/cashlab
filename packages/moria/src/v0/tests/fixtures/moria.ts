import { generatePrivateKey, secp256k1, sha256, hexToBin } from '@cashlab/common/libauth.js';
import type { UTXOWithNFT } from '@cashlab/common/types.js';
import { NonFungibleTokenCapability } from '@cashlab/common/constants.js';

export const ORACLE_OWNER_PUBKEY = hexToBin('03341a6fb68e883fb2c5ce0d0d186e9e09792839479bfb14adda2f498fc2dfaacf');

export const MORIA_UTXO: UTXOWithNFT = {
  outpoint: {
    txhash: hexToBin('01' + '00'.repeat(31)),
    index: 0,
  },
  output: {
    locking_bytecode: hexToBin('aa20539be6c586e4f426a100e0bd56b3c0f765bea9d796e504f68f02ef992f26ac1487'),
    amount: 1000n,
    token: {
      amount: 97200000n,
      token_id: '4046913cba6b70b2214a048a3df92252849f481ffa1455ed7faf17243c36bf67',
      nft: {
        capability: NonFungibleTokenCapability.minting,
        commitment: hexToBin('35150e'),
      },
    },
  },
};
export const ORACLE_UTXO: UTXOWithNFT = {
  outpoint: {
    txhash: hexToBin('01' + '00'.repeat(31)),
    index: 1,
  },
  output: {
    locking_bytecode: hexToBin('aa2076fbc08f5ba4bd098f0c0da12a13d5b229b68c6d7e3cbd197c90ec01ae116ab987'),
    amount: 1000n,
    token: {
      amount: 0n,
      token_id: 'b0b6fc3d5cda81f4bb3fe464767dcc33e80b6356e4838f4dda40a1871a625950',
      nft: {
        capability: NonFungibleTokenCapability.mutable,
        commitment: hexToBin('763d932c30ca45715f9861dc205243f1520bfafa338461674d150e0035150e00edd10000'),
      },
    },
  },
};

export const ORACLE_UTXO_LOW_PRICE: UTXOWithNFT = {
  outpoint: {
    txhash: hexToBin('02' + '00'.repeat(31)),
    index: 1,
  },
  output: {
    locking_bytecode: hexToBin('aa2076fbc08f5ba4bd098f0c0da12a13d5b229b68c6d7e3cbd197c90ec01ae116ab987'),
    amount: 1000n,
    token: {
      amount: 0n,
      token_id: 'b0b6fc3d5cda81f4bb3fe464767dcc33e80b6356e4838f4dda40a1871a625950',
      nft: {
        capability: NonFungibleTokenCapability.mutable,
        commitment: hexToBin('763d932c30ca45715f9861dc205243f1520bfafa338461674d150e0035150e0008150000'),
      },
    },
  },
};

export const DUMMY_SUNSET_PRIVATE_KEY = generatePrivateKey();
export const DUMMY_SUNSET_PUBLIC_KEY = secp256k1.derivePublicKeyCompressed(DUMMY_SUNSET_PRIVATE_KEY) as Uint8Array;
if (typeof DUMMY_SUNSET_PUBLIC_KEY == 'string') {
  throw new Error(DUMMY_SUNSET_PUBLIC_KEY);
}
export const DUMMY_SUNSET_MESSAGE = (new TextEncoder()).encode('SUNSET!');
export const DUMMY_SUNSET_DATASIG = secp256k1.signMessageHashSchnorr(DUMMY_SUNSET_PRIVATE_KEY, sha256.hash(DUMMY_SUNSET_MESSAGE)) as Uint8Array;
if (typeof DUMMY_SUNSET_DATASIG == 'string') {
  throw new Error(DUMMY_SUNSET_DATASIG);
}
