import type { Fraction, TokenId, Output } from './types.js';
import { NATIVE_BCH_TOKEN_ID } from './constants.js';
import { ValueError } from './exceptions.js';
import type * as libauth from './libauth.js';

//
// binToHex & hexToBin are copied from @bitauth/libauth package
//

/**
 * Returns an array of incrementing values starting at `begin` and incrementing
 * by one for `length`.
 *
 * E.g.: `range(3)` → `[0, 1, 2]` and `range(3, 1)` → `[1, 2, 3]`
 *
 * @param length - the number of elements in the array
 * @param begin - the index at which the range starts (default: `0`)
 */
export const range = (length: number, begin = 0) => {
  return Array.from({ length }, (_, index) => begin + index);
}

/**
 * Split a string into an array of `chunkLength` strings. The final string may
 * have a length between 1 and `chunkLength`.
 *
 * E.g.: `splitEvery('abcde', 2)` → `['ab', 'cd', 'e']`
 */
export const splitEvery = (input: string, chunkLength: number) => {
  return range(Math.ceil(input.length / chunkLength))
    .map((index) => index * chunkLength)
    .map((begin) => input.slice(begin, begin + chunkLength));
}

const hexByteWidth = 2;
const hexadecimal = 16;

/**
 * Decode a hexadecimal-encoded string into a Uint8Array.
 *
 * E.g.: `hexToBin('2a64ff')` → `new Uint8Array([42, 100, 255])`
 *
 * Note, this method always completes. If `validHex` is not divisible by 2,
 * the final byte will be parsed as if it were prepended with a `0` (e.g. `aaa`
 * is interpreted as `aa0a`). If `validHex` is potentially malformed
 *
 * For the reverse, see {@link binToHex}.
 *
 * @param validHex - a string of valid, hexadecimal-encoded data
 */
export const hexToBin = (validHex: string): Uint8Array => {
  return Uint8Array.from(
    splitEvery(validHex, hexByteWidth).map((byte) =>
      parseInt(byte, hexadecimal),
    ),
  );
}

/**
 * Encode a Uint8Array into a hexadecimal-encoded string.
 *
 * E.g.: `binToHex(new Uint8Array([42, 100, 255]))` → `'2a64ff'`
 *
 * For the reverse, see {@link hexToBin}.
 *
 * @param bytes - a Uint8Array to encode
 */
export const binToHex = (bytes: Uint8Array): string => {
  return bytes.reduce(
    (str, byte) => str + byte.toString(hexadecimal).padStart(hexByteWidth, '0'),
    '',
  );
}


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

export const uint8ArrayConcat = (items: Uint8Array[]): Uint8Array => {
  const size = items.reduce((a, b) => a + b.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const item of items) {
    result.set(item, offset);
    offset += item.byteLength;
  }
  return result;
};

export const uint8ArrayEqual = (a: Uint8Array, b: Uint8Array): boolean => {
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
