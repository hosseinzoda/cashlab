import type { Fraction, TokenId, Output } from './types.js';
import { NATIVE_BCH_TOKEN_ID } from './constants.js';
import { ValueError } from './exceptions.js';
import * as libauth from '@bitauth/libauth';
const { binToHex } = libauth;

export const ceilingValueOfBigIntDivision = (numerator: bigint, denominator: bigint) => {
  const v0 = numerator / denominator;
  return v0 + (v0 * denominator < numerator ? 1n : 0n);
};

export const convertFractionDenominator = (fraction: Fraction, target_denominator: bigint): Fraction => {
  return {
    numerator: target_denominator === fraction.denominator ? fraction.numerator :
      fraction.numerator * target_denominator / fraction.denominator,
    denominator: target_denominator,
  };
};

export const convertTokenIdToUint8Array = (value: TokenId): Uint8Array => {
  if (value == NATIVE_BCH_TOKEN_ID) {
    throw new ValueError('Cannot convert native bch token id to Uint8Array');
  }
  if (value.length != 64 || value.match(/[^0-9a-f]/) != null) {
    throw new ValueError('Expecting token id to be a 32 bytes data represented in hex string (lower case letters)');
  }
  const bytes = [];
  let counter = 0;
  while (counter < 32) {
    bytes.push(parseInt(value.slice(counter * 2, counter * 2 + 2), 16))
    counter++;
  }
  return Uint8Array.from(bytes);
};

export const uint8ArrayEqual = typeof Buffer != 'undefined' ?
  (a: Uint8Array, b: Uint8Array): boolean => (a instanceof Buffer ? a : Buffer.from(a)).equals(b) :
  (a: Uint8Array, b: Uint8Array): boolean => {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
      return false;
    }
    if (a.length != b.length) {
      return false;
    }
    let index = 0;
    while (index < a.length) {
      if (a[index] != b[index]) {
        return false;
      }
      index++;
    }
    return true;
  };

export const bigIntMax = (...args: bigint[]): bigint => {
  if (args.length == 0) {
    throw new ValueError('At least one argument is required!');
  }
  for (const arg of args) {
    if (typeof arg != 'bigint') {
      throw new ValueError(`bigIntMax requires all arguments to of type bigint`);
    }
  }
  let val: bigint = args[0] as bigint;
  let index = 1;
  while (index < args.length) {
    let val2 = args[index] as bigint;
    if (val2 > val) {
      val = val2;
    }
    index++;
  }
  return val;
};

export const bigIntMin = (...args: bigint[]): bigint => {
  if (args.length == 0) {
    throw new ValueError('At least one argument is required!');
  }
  for (const arg of args) {
    if (typeof arg != 'bigint') {
      throw new ValueError(`bigIntMax requires all arguments to of type bigint`);
    }
  }
  let val: bigint = args[0] as bigint;
  let index = 1;
  while (index < args.length) {
    let val2 = args[index] as bigint;
    if (val2 < val) {
      val = val2;
    }
    index++;
  }
  return val;
};

export const bigIntArraySortPolyfill = <T>(array: T[], callable: (a: T, b: T) => bigint): T[] => {
  return array.sort((a: any, b: any): number => {
    const value = callable(a, b)
    if (value == 0n) {
      return 0;
    } else if (value > 0n) {
      return 1;
    } else if (value < 0n) {
      return -1;
    } else {
      throw new ValueError('Expecting sort function to return a bigint value!')
    }
  });
}

export const walletTemplateP2pkhNonHd: libauth.WalletTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  description:
    'A standard single-factor wallet template that uses Pay-to-Public-Key-Hash (P2PKH), the most common authentication scheme in use on the network.\n\nThis P2PKH template uses BCH Schnorr signatures, reducing the size of transactions.',
  entities: {
    owner: {
      description: 'The individual who can spend from this wallet.',
      name: 'Owner',
      scripts: ['lock', 'unlock'],
      variables: {
        key: {
          description: 'The private key that controls this wallet.',
          name: 'Key',
          type: 'Key',
        },
      },
    },
  },
  name: 'Single Signature (P2PKH)',
  scripts: {
    lock: {
      lockingType: 'standard',
      name: 'P2PKH Lock',
      script:
        'OP_DUP\nOP_HASH160 <$(<key.public_key> OP_HASH160\n)> OP_EQUALVERIFY\nOP_CHECKSIG',
    },
    unlock: {
      name: 'Unlock',
      script: '<key.schnorr_signature.all_outputs>\n<key.public_key>',
      unlocks: 'lock',
    },
  },
  supported: ['BCH_2020_05', 'BCH_2021_05', 'BCH_2022_05'],
  version: 0,
};

export const publicKeyHashToP2pkhLockingBytecode = (pkh: Uint8Array) => {
  const compiler = libauth.walletTemplateToCompilerBCH({
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
    entities: { owner: { scripts: ['lock'], variables: { pkh: { name: 'pkh', type: 'AddressData' } } } },
    scripts: {
      lock: {
        lockingType: 'standard',
        name: 'P2PKH Lock',
        script:
        'OP_DUP\nOP_HASH160 <pkh> OP_EQUALVERIFY\nOP_CHECKSIG',
      },
    },
    supported: ['BCH_2023_05'],
    version: 0,
  });
  const locking_bytecode = compiler.generateBytecode({ data: { bytecode: { pkh } }, scriptId: 'lock' });
  if (!locking_bytecode.success) {
    throw new ValueError(libauth.formatError(libauth.P2pkhUtilityError.publicKeyToP2pkhLockingBytecodeCompilation, libauth.stringifyErrors(locking_bytecode.errors)));
  }
  return locking_bytecode.bytecode;
};

export const outputFromLibauthOutput = (la_output: libauth.Output): Output => {
  return {
    locking_bytecode: la_output.lockingBytecode,
    amount: la_output.valueSatoshis,
    token: la_output.token != null ? {
      amount: la_output.token.amount,
      token_id: binToHex(la_output.token.category),
      nft: la_output.token.nft != null ? {
        capability: la_output.token.nft.capability,
        commitment: la_output.token.nft.commitment,
      } : undefined,
    } : undefined,
  };
};

export const outputToLibauthOutput = (output: Output): libauth.Output => {
  return {
    lockingBytecode: output.locking_bytecode,
    valueSatoshis: output.amount,
    token: output.token != null ? {
      amount: output.token.amount,
      category: convertTokenIdToUint8Array(output.token.token_id),
      nft: output.token.nft != null ? {
        capability: output.token.nft.capability,
        commitment: output.token.nft.commitment,
      } : undefined,
    } : undefined,
  };
};
