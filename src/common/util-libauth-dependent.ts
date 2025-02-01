import { ValueError, InvalidProgramState } from './exceptions.js';
import * as libauth from '@bitauth/libauth';
import type { SpendableCoin, TokenId } from './types.js';
import { SpendableCoinType, NATIVE_BCH_TOKEN_ID } from './constants.js';
import { convertTokenIdToUint8Array, binToHex } from './util.js';

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

export const convertSpendableCoinsToLAInputsWithSourceOutput = (input_coins: SpendableCoin[]): Array<{ input: libauth.InputTemplate<libauth.CompilerBCH>, source_output: libauth.Output }> => {
  const p2pkh_compiler = libauth.walletTemplateToCompilerBCH(libauth.walletTemplateP2pkhNonHd);
  const result: Array<{ input: libauth.InputTemplate<libauth.CompilerBCH>, source_output: libauth.Output }> = [];
  // add input coins
  for (const coin of input_coins) {
    if (coin.output?.token?.nft) {
      throw new ValueError(`A provided funding coin is a nft, outpoint: ${binToHex(coin.outpoint.txhash)}:${coin.outpoint.index}`);
    }
    if (coin.type == SpendableCoinType.P2PKH) {
      const source_output = {
        lockingBytecode: coin.output.locking_bytecode,
        valueSatoshis: coin.output.amount,
        token: coin.output.token ? {
          amount: coin.output.token.amount,
          category: convertTokenIdToUint8Array(coin.output.token.token_id),
        } : undefined,
      };
      const data: libauth.CompilationData<never> = {
        keys: {
          privateKeys: {
            key: coin.key,
          },
        },
      };
      const input = {
        outpointIndex: coin.outpoint.index,
        outpointTransactionHash: coin.outpoint.txhash,
        sequenceNumber: 0,
        unlockingBytecode: {
          compiler: p2pkh_compiler,
          script: 'unlock',
          data,
          valueSatoshis: coin.output.amount,
          token: !coin.output.token ? undefined : {
            amount: coin.output.token.amount,
            category: convertTokenIdToUint8Array(coin.output.token.token_id),
          },
        },
      };
      result.push({ input, source_output });
    } else {
      throw new ValueError(`input_coin has an unknown type: ${coin.type}`)
    }
  }
  return result;
}

export const calcAvailablePayoutFromLASourceOutputsAndOutputs = (source_outputs: libauth.Output<Uint8Array, Uint8Array>[], outputs: libauth.Output<Uint8Array, Uint8Array>[]): Array<{ token_id: TokenId, amount: bigint }> => {
  const available_payouts: Array<{ token_id: TokenId, amount: bigint }> = [ { token_id: NATIVE_BCH_TOKEN_ID, amount: 0n } ];
  const bch_available_payout = available_payouts.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID);
  if (bch_available_payout == null) {
    /* c8 ignore next */
    throw new InvalidProgramState('bch_available_payout == null; !!!');
  }
  // deduct outputs
  for (const output of outputs) {
    bch_available_payout.amount -= output.valueSatoshis;
    if (output.token && output.token.amount > 0n) {
      const token_id: TokenId = binToHex(output.token.category);
      let available_payout = available_payouts.find((a) => a.token_id == token_id);
      if (available_payout == null) {
        available_payout = { token_id, amount: 0n };
        available_payouts.push(available_payout);
      }
      available_payout.amount -= output.token.amount;
    }
  }
  // add inputs
  for (const output of source_outputs) {
    bch_available_payout.amount += output.valueSatoshis;
    if (output.token && output.token.amount > 0n) {
      const token_id: TokenId = binToHex(output.token.category);
      let available_payout = available_payouts.find((a) => a.token_id == token_id);
      if (available_payout == null) {
        available_payout = { token_id, amount: 0n };
        available_payouts.push(available_payout);
      }
      available_payout.amount += output.token.amount;
    }
  }
  return available_payouts;
};
