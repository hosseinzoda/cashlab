import type { ChainedTxResult, TxResult, SpendableCoin, PayoutRule, Output, UTXO, TokenId } from './types.js';
import { InvalidProgramState, ValueError } from './exceptions.js';
import { PayoutAmountRuleType, SpendableCoinType } from './constants.js';
import { convertTokenIdToUint8Array } from './util.js';
import * as payoutBuilder from './payout-builder.js';
import { calcAvailablePayoutFromLASourceOutputsAndOutputs, convertSpendableCoinsToLAInputsWithSourceOutput } from './util-libauth-dependent.js';
import * as libauth from './libauth.js';

/**
 * A context to create a payout. The functions uses the txfee_per_byte to calculate & pay the transaction fee.
 * The min bch amount, Requires the change to contain at least the min amount.
 * The non-mixed token payouts will use the preferred bch amount or the min amount as the bch amount of its output.
 */
export type CreatePayoutTxContext = {
  txfee_per_byte: bigint;
  getOutputMinAmount (output: Output): bigint;
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null;
};

type LibauthTemplateInputAndSourceOutput = {
  input: libauth.InputTemplate<libauth.CompilerBCH>;
  source_output: libauth.Output;
};

const convertToJSONSerializable = (v: any): any => {
  if (typeof v == 'bigint') {
    return v+'';
  }
  if (v instanceof Error) {
    v = {
      message: v.message, name: v.name,
      ...Object.fromEntries(['code'].filter((a) => v[a] != null).map((a) => [ a, v[a] ])),
    };
  } else if (Array.isArray(v)) {
    v = Array.from(v).map(convertToJSONSerializable);
  } else if (v && typeof v == 'object') {
    if (v instanceof Uint8Array) {
      v = libauth.binToHex(v);
    } else {
      v = Object.fromEntries(
        Object.entries(v)
          .map((a) => [ a[0], convertToJSONSerializable(a[1]) ])
      )
    }
  }
  return v;
}

/**
 * Create a chain transactions to payout a set of addresses/locking_bytecodes. Input coins provide the funding needed to build the payouts.
 * The payout instructions are provided by the `payout_rules`.
 *
 * @param context is the payout context.
 * @param input_coins is a list of spendable coins to use as input to fund the payouts.
 * @param payout_rules is a set of rules provided as the payout instructions
 *
 * @returns A chain transaction results.
 */
export function createPayoutChainedTx (context: CreatePayoutTxContext, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): ChainedTxResult {
  if (!(context.txfee_per_byte >= 0n)) {
    throw new ValueError('txfee should be greater than or equal to zero, txfee_per_byte type: bigint');
  }
  if (input_coins.length == 0) {
    throw new ValueError('number of input_coins should be greater than zero');
  }
  const change_payout_rule = payout_rules.find((a) => a.type == PayoutAmountRuleType.CHANGE && a.spending_parameters != null);
  if (change_payout_rule == null) {
    throw new ValueError(`One change payout rule with spending parameters is needed to create-payout-chained-tx`);
  }
  if (change_payout_rule.spending_parameters?.type != SpendableCoinType.P2PKH) {
    throw new ValueError(`The provided change payout rule should have its spending_parameters with P2PKH type.`);
  }
  const result: ChainedTxResult = {
    chain: [],
    txfee: 0n,
    payouts: [],
  };
  let input_items: LibauthTemplateInputAndSourceOutput[] = convertSpendableCoinsToLAInputsWithSourceOutput(input_coins);
  while (true) {
    const { tx_result, done, unused_input_items } = createPayoutChainedTxSub(context, input_items, change_payout_rule, payout_rules);
    result.txfee += tx_result.txfee;
    result.chain.push(tx_result);
    if (done) {
      result.payouts = tx_result.payouts;
      break;
    }
    if (unused_input_items.length + tx_result.payouts.length >= input_items.length) {
      /* c8 ignore next */
      throw new InvalidProgramState(`unused_input_items.length + tx_result.payouts.length >= input_items.length`);
    }
    input_items = [ ...unused_input_items, ...convertSpendableCoinsToLAInputsWithSourceOutput(tx_result.payouts.map((utxo) => ({
      type: SpendableCoinType.P2PKH,
      output: utxo.output,
      outpoint: utxo.outpoint,
      key: (change_payout_rule as any).spending_parameters.key,
    }))) ];
  }
  return result;
}


/**
 * Create a transaction to payout a set of addresses/locking_bytecodes. Input coins provide the funding needed to build the payouts.
 * The payout instructions are provided by the `payout_rules`.
 *
 * @param context is the payout context.
 * @param input_coins is a list of spendable coins to use as input to fund the payouts.
 * @param payout_rules is a set of rules provided as the payout instructions
 *
 * @returns A chain transaction results.
 */
export function createPayoutTx (context: CreatePayoutTxContext, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): TxResult {
  if (!(context.txfee_per_byte >= 0n)) {
    throw new ValueError('txfee should be greater than or equal to zero, txfee_per_byte type: bigint');
  }
  if (input_coins.length == 0) {
    throw new ValueError('number of input_coins should be greater than zero');
  }
  const change_payout_rule = payout_rules.find((a) => a.type == PayoutAmountRuleType.CHANGE);
  if (change_payout_rule == null) {
    throw new ValueError(`One change payout rule is needed to create-payout-tx`);
  }
  let input_items: LibauthTemplateInputAndSourceOutput[] = convertSpendableCoinsToLAInputsWithSourceOutput(input_coins);
  const { tx_result, done } = createPayoutChainedTxSub(context, input_items, change_payout_rule, payout_rules);
  if (!done) {
    throw new ValueError(`Too many inputs, Tx size limit reached, Cannot generate a single transaction to perform the payout.` );
  }
  return tx_result;
}


const utxoFromPayoutResult = (txhash: Uint8Array, a: { output: Output, output_index: number }): UTXO => ({ outpoint: { txhash, index: a.output_index }, output: a.output });

const createPayoutChainedTxSub = (context: CreatePayoutTxContext, input_items: LibauthTemplateInputAndSourceOutput[], change_payout_rule: PayoutRule, payout_rules: PayoutRule[]): { tx_result: TxResult, done: boolean, unused_input_items: Array<{ input: libauth.InputTemplate<libauth.CompilerBCH>, source_output: libauth.Output }>  } => {
  const makeLAOutputs = (outputs: Output[]): libauth.Output[] => {
    return outputs.map((a) => ({
      lockingBytecode: a.locking_bytecode,
      token: a.token ? {
        amount: a.token.amount < 0n ? context.getOutputMinAmount(a) : a.token.amount,
        category: convertTokenIdToUint8Array(a.token.token_id),
        nft: a.token.nft ? {
          capability: a.token.nft.capability,
          commitment: a.token.nft.commitment,
        } : undefined,
      } : undefined,
      valueSatoshis: a.amount,
    }))
  };
  const max_tx_size: bigint = 100000n;
  let unused_input_items: LibauthTemplateInputAndSourceOutput[] = input_items;
  let sub_input_items: LibauthTemplateInputAndSourceOutput[] = [];
  let best_result = null;
  let best_result_done = false;
  let next_attempt_addtional_input_count = 450;
  let offset = 0;
  while (next_attempt_addtional_input_count > 0) {
    const next_sub_input_items = [ ...sub_input_items, ...input_items.slice(offset, offset + next_attempt_addtional_input_count) ];
    const added_count = Math.min(input_items.length - offset, next_attempt_addtional_input_count);
    const done = input_items.length - offset <= next_attempt_addtional_input_count;
    const payout_builder_context = {
      getOutputMinAmount: context.getOutputMinAmount.bind(context),
      getPreferredTokenOutputBCHAmount: context.getPreferredTokenOutputBCHAmount.bind(context),
      calcTxFeeWithOutputs: (outputs: Output[]): bigint => {
        const result = libauth.generateTransaction({
          locktime: 0,
          version: 2,
          inputs: next_sub_input_items.map((a) => a.input), outputs: makeLAOutputs(outputs),
        });
        if (!result.success) {
          /* c8 ignore next */
          throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
        }
        return BigInt(libauth.encodeTransaction(result.transaction).length) * context.txfee_per_byte;
      },
    };
    const sub_payout_rules = done ? payout_rules : [change_payout_rule];
    const available_payouts: Array<{ token_id: TokenId, amount: bigint }> = calcAvailablePayoutFromLASourceOutputsAndOutputs(next_sub_input_items.map((a) => a.source_output), []);
    if (available_payouts.filter((a) => a.amount < 0n).length > 0) {
      throw new InvalidProgramState(`Sum of the inputs & outputs is negative for the following token(s): ${available_payouts.filter((a) => a.amount < 0n).map((a) => a.token_id).join(', ')}`);
    }
    const { payout_outputs, txfee, token_burns } = payoutBuilder.build(payout_builder_context, available_payouts, sub_payout_rules, true);
    if (token_burns.length > 0) {
      throw new ValueError(`Token burns are not allowed.`);
    }
    const result = libauth.generateTransaction({
      locktime: 0,
      version: 2,
      inputs: next_sub_input_items.map((a) => a.input), outputs: makeLAOutputs(payout_outputs.map((a) => a.output)),
    });
    if (!result.success) {
      /* c8 ignore next */
      throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
    }
    const txbin = libauth.encodeTransaction(result.transaction);
    if (txbin.length <= max_tx_size) {
      const txhash = libauth.hashTransactionUiOrder(txbin);
      sub_input_items = next_sub_input_items;
      unused_input_items = input_items.slice(offset + next_attempt_addtional_input_count);
      best_result = {
        txbin, txhash, txfee,
        payouts: payout_outputs.map((a, i) => utxoFromPayoutResult(txhash, { output: a.output, output_index: i })),
        libauth_transaction: result.transaction,
        libauth_source_outputs: sub_input_items.map((a) => a.source_output),
      };
      best_result_done = done;
      if (done) {
        break;
      }
      offset += added_count;
    } else {
      next_attempt_addtional_input_count = Math.floor(next_attempt_addtional_input_count / 2);
    }
  }
  if (best_result == null) {
    throw new InvalidProgramState('best_result == null');
  }
  return { tx_result: best_result, done: best_result_done, unused_input_items };
}
