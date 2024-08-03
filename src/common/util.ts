import type { Fraction, TokenId } from './types.js';
import { NATIVE_BCH_TOKEN_ID } from './constants.js';
import { ValueError } from './exceptions.js';

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
