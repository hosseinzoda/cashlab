import { hexToBin } from '@cashlab/common/libauth.js';
import type { UTXO, UTXOWithNFT } from '@cashlab/common/types.js';
import { NonFungibleTokenCapability } from '@cashlab/common/constants.js';
import { generateRandomBytes } from '@cashlab/common/libauth.js';

function mkDummyUTXO <OutputType>(output: OutputType): UTXO<OutputType> {
  return {
    outpoint: {
      txhash: generateRandomBytes(32),
      index: 0,
    },
    output,
  };
}

export const MORIA_UTXO: UTXOWithNFT = mkDummyUTXO({
  locking_bytecode: hexToBin('aa204ca6c7c5e1a38241e15beec09220bdb49fdcc3e7c2ae3bf1ea62a1a24e58b7e587'),
  amount: 1000n,
  token: {
    amount: 4503599619912696n,
    token_id: 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366',
    nft: {
      capability: NonFungibleTokenCapability.minting,
      commitment: hexToBin('4cdc11'),
    },
  },
});

export const DELPHI_UTXO: UTXOWithNFT = mkDummyUTXO({
  locking_bytecode: hexToBin('aa20ed67309b36424c1b3f25e08f19d8ead4eade917c476e5b16520deac63d65d4a987'),
  amount: 1000n,
  token: {
    amount: 0n,
    token_id: 'd0d46f5cbd82188acede0d3e49c75700c19cb8331a30101f0bb6a260066ac972',
    nft: {
      capability: NonFungibleTokenCapability.mutable,
      commitment: hexToBin('8f3e44680000e8034cdc1100779e0000'),
    },
  },
});

export const DELPHI_UTXO_1YR_IN_FUTURE: UTXOWithNFT = mkDummyUTXO({
  locking_bytecode: hexToBin('aa20ed67309b36424c1b3f25e08f19d8ead4eade917c476e5b16520deac63d65d4a987'),
  amount: 1000n,
  token: {
    amount: 0n,
    token_id: 'd0d46f5cbd82188acede0d3e49c75700c19cb8331a30101f0bb6a260066ac972',
    nft: {
      capability: NonFungibleTokenCapability.mutable,
      commitment: hexToBin('0f72256a0000e803b0dc1100779e0000'),
    },
  },
});

export const DELPHI_UTXO_LOW_PRICE: UTXOWithNFT = mkDummyUTXO({
  locking_bytecode: hexToBin('aa20ed67309b36424c1b3f25e08f19d8ead4eade917c476e5b16520deac63d65d4a987'),
  amount: 1000n,
  token: {
    amount: 0n,
    token_id: 'd0d46f5cbd82188acede0d3e49c75700c19cb8331a30101f0bb6a260066ac972',
    nft: {
      capability: NonFungibleTokenCapability.mutable,
      commitment: hexToBin('8f3e44680000e8034cdc110010270000'),
    },
  },
});

export const DELPHI_GP_UPDATER_UTXO: UTXOWithNFT = mkDummyUTXO({
  locking_bytecode: hexToBin('aa203b71bed23bf7e606d2f9178d85e15170d68c45a10a9e86db520ac08e3ef41f6a87'),
  amount: 1000n,
  token: {
    amount: 0n,
    token_id: '5e437326449aba7855da3f5922fd65cfee6eab17c6869e0636016300b0f1c3c1',
    nft: {
      capability: NonFungibleTokenCapability.none,
      commitment: new Uint8Array(0),
    },
  },
});

export const BPORACLE_UTXO: UTXOWithNFT = mkDummyUTXO({
  locking_bytecode: hexToBin('aa20837516486ec8625f76378f8840528cf21eb125d6da99247b948f8f50bcf944b187'),
  amount: 1000n,
  token: {
    amount: 0n,
    token_id: '01711e39e7bf3b8ca0d9a6fc6ea32e340caa1d64dc7d1dc51fae20fd66755558',
    nft: {
      capability: NonFungibleTokenCapability.mutable,
      commitment: hexToBin('8f3e44680000e8037800'),
    },
  },
});

export const BATONMINTER_UTXO: UTXOWithNFT = mkDummyUTXO({
  locking_bytecode: hexToBin('aa206298ff3e09c5434b76ddcb6b372209f110c69be7e44eb304cd64eca8914fa77087'),
  amount: 1000n,
  token: {
    amount: 0n,
    token_id: '9c8362ec067e2d516064b6184b6ef0c9a6e5daa7dfb4693e9764de48460b3d9b',
    nft: {
      capability: NonFungibleTokenCapability.minting,
      commitment: hexToBin('03'),
    },
  },
});


