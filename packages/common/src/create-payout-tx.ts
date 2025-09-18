import type {
  ChainedTxResult, TxResult, SpendableCoin, PayoutRule, Output, UTXO, TokenId, Fraction,
  InputParamsWithUnlocker,
} from './types.js';
import { InvalidProgramState, ValueError } from './exceptions.js';
import { PayoutAmountRuleType, SpendableCoinType } from './constants.js';
import {
  inputParamsWithUnlockerToLibauthInputTemplate, outputToLibauthOutput,
  calcAvailablePayoutFromIO,
} from './util.js';
import * as payoutBuilder from './payout-builder.js';
import { spendableCoinToInputWithUnlocker } from './util-libauth-dependent.js';
import * as libauth from './libauth.js';

/**
 * A context to create a payout. The functions uses the txfee_per_byte to calculate & pay the transaction fee.
 * The min bch amount, Requires the change to contain at least the min amount.
 * The non-mixed token payouts will use the preferred bch amount or the min amount as the bch amount of its output.
 */
export type CreatePayoutTxContext = {
  txfee_per_byte: Fraction | bigint;
  getOutputMinAmount (output: Output): bigint;
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null;
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
  if (input_coins.length == 0) {
    throw new ValueError('number of input_coins should be greater than zero');
  }
  const should_reuse_change_payouts = payout_rules.length !== 1;
  let change_payout_rule;
  if (should_reuse_change_payouts) {
    change_payout_rule = payout_rules.find((a) => a.type == PayoutAmountRuleType.CHANGE && a.spending_parameters != null);
    if (change_payout_rule == null) {
      throw new ValueError(`One change payout rule with spending parameters is needed to create-payout-chained-tx`);
    }
    // more than a change address exists, change_payout_rule.spending_parameters is required
    if (change_payout_rule.spending_parameters?.type != SpendableCoinType.P2PKH) {
      throw new ValueError(`The provided change payout rule should have its spending_parameters with P2PKH type.`);
    }
  } else {
    change_payout_rule = payout_rules.find((a) => a.type == PayoutAmountRuleType.CHANGE);
    if (change_payout_rule == null) {
      throw new ValueError(`One change payout rule is needed to create-payout-chained-tx`);
    }
  }
  const result: ChainedTxResult = {
    chain: [],
    txfee: 0n,
    payouts: [],
  };
  const txparams: { locktime: number, version: number } = { locktime: 0, version: 2 };
  let inputs: InputParamsWithUnlocker[] = input_coins.map((coin) => spendableCoinToInputWithUnlocker(coin, { sequence_number: 0 }));
  while (true) {
    const { tx_result, done, unused_inputs } = createPayoutChainedTxSub(context, inputs, change_payout_rule, payout_rules, txparams);
    result.txfee += tx_result.txfee;
    result.chain.push(tx_result);
    if (done) {
      result.payouts = [ ...result.payouts, ...tx_result.payouts ];
      break;
    }
    if (should_reuse_change_payouts) {
      if (unused_inputs.length + tx_result.payouts.length >= inputs.length) {
        /* c8 ignore next */
        throw new InvalidProgramState(`unused_inputs.length + tx_result.payouts.length >= inputs.length`);
      }
      inputs = [ ...unused_inputs, ...tx_result.payouts.map((utxo) => spendableCoinToInputWithUnlocker({
        type: SpendableCoinType.P2PKH,
        output: utxo.output,
        outpoint: utxo.outpoint,
        key: (change_payout_rule as any).spending_parameters.key,
      }, { sequence_number: 0 })) ];
    } else {
      if (unused_inputs.length >= inputs.length) {
        /* c8 ignore next */
        throw new InvalidProgramState(`unused_inputs.length >= inputs.length`);
      }
      inputs = unused_inputs;
      result.payouts = [ ...result.payouts, ...tx_result.payouts ];
    }
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
  if (input_coins.length == 0) {
    throw new ValueError('number of input_coins should be greater than zero');
  }
  const change_payout_rule = payout_rules.find((a) => a.type == PayoutAmountRuleType.CHANGE);
  if (change_payout_rule == null) {
    throw new ValueError(`One change payout rule is needed to create-payout-tx`);
  }
  const inputs: InputParamsWithUnlocker[] = input_coins.map((coin) => spendableCoinToInputWithUnlocker(coin, { sequence_number: 0 }));
  const txparams: { locktime: number, version: number } = { locktime: 0, version: 2 };
  const { tx_result, done } = createPayoutChainedTxSub(context, inputs, change_payout_rule, payout_rules, txparams);
  if (!done) {
    throw new ValueError(`Too many inputs, Tx size limit reached, Cannot generate a single transaction to perform the payout.` );
  }
  return tx_result;
}


const utxoFromPayoutResult = (txhash: Uint8Array, a: { output: Output, output_index: number }): UTXO => ({ outpoint: { txhash, index: a.output_index }, output: a.output });

const createPayoutChainedTxSub = (context: CreatePayoutTxContext, inputs: InputParamsWithUnlocker[], change_payout_rule: PayoutRule, payout_rules: PayoutRule[], txparams: { locktime: number, version: number }): { tx_result: TxResult, done: boolean, unused_inputs: InputParamsWithUnlocker[] } => {
  const txfee_per_byte = typeof context.txfee_per_byte == 'bigint' ?
    { numerator: context.txfee_per_byte, denominator: 1n } : context.txfee_per_byte as Fraction;
  if (!(txfee_per_byte.numerator >= 0n && txfee_per_byte.denominator > 0n)) {
    throw new ValueError('txfee should be greater than or equal to zero, txfee_per_byte type: Fraction | bigint');
  }
  const max_tx_size: bigint = 100000n;
  let unused_inputs: InputParamsWithUnlocker[] = inputs;
  let sub_inputs: InputParamsWithUnlocker[] = [];
  let best_result = null;
  let best_result_done = false;
  let next_attempt_addtional_input_count = 450;
  let offset = 0;
  while (next_attempt_addtional_input_count > 0) {
    const next_sub_inputs = [ ...sub_inputs, ...inputs.slice(offset, offset + next_attempt_addtional_input_count) ];
    const added_count = Math.min(inputs.length - offset, next_attempt_addtional_input_count);
    const done = inputs.length - offset <= next_attempt_addtional_input_count;
    const payout_builder_context = {
      getOutputMinAmount: context.getOutputMinAmount.bind(context),
      getPreferredTokenOutputBCHAmount: context.getPreferredTokenOutputBCHAmount.bind(context),
      calcTxFeeWithOutputs: (outputs: Output[]): bigint => {
        const result = libauth.generateTransaction({
          locktime: txparams.locktime,
          version: txparams.version,
          inputs: next_sub_inputs.map((a, i) => inputParamsWithUnlockerToLibauthInputTemplate(i, a, next_sub_inputs, outputs, txparams)),
          outputs: outputs.map(outputToLibauthOutput),
        });
        if (!result.success) {
          /* c8 ignore next */
          throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
        }
        return BigInt(libauth.encodeTransaction(result.transaction).length) * txfee_per_byte.numerator / txfee_per_byte.denominator;
      },
    };
    const sub_payout_rules = done ? payout_rules : [change_payout_rule];
    const available_payouts: Array<{ token_id: TokenId, amount: bigint }> = calcAvailablePayoutFromIO(next_sub_inputs, []);
    if (available_payouts.filter((a) => a.amount < 0n).length > 0) {
      throw new InvalidProgramState(`Sum of the inputs & outputs is negative for the following token(s): ${available_payouts.filter((a) => a.amount < 0n).map((a) => a.token_id).join(', ')}`);
    }
    const { payout_outputs, txfee, token_burns } = payoutBuilder.build(payout_builder_context, available_payouts, sub_payout_rules, true);
    if (token_burns.length > 0) {
      throw new ValueError(`Token burns are not allowed.`);
    }
    const outputs = payout_outputs.map((a) => a.output);
    const result = libauth.generateTransaction({
      locktime: txparams.locktime,
      version: txparams.version,
      inputs: next_sub_inputs.map((a, i) => inputParamsWithUnlockerToLibauthInputTemplate(i, a, next_sub_inputs, outputs, txparams)),
      outputs: outputs.map(outputToLibauthOutput),
    });
    if (!result.success) {
      /* c8 ignore next */
      throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
    }
    const txbin = libauth.encodeTransaction(result.transaction);
    if (txbin.length <= max_tx_size) {
      const txhash = libauth.hashTransactionUiOrder(txbin);
      sub_inputs = next_sub_inputs;
      unused_inputs = inputs.slice(offset + next_attempt_addtional_input_count);
      best_result = {
        txbin, txhash, txfee,
        payouts: payout_outputs.map((a, i) => utxoFromPayoutResult(txhash, { output: a.output, output_index: i })),
        libauth_transaction: result.transaction,
        libauth_source_outputs: sub_inputs.map((a) => outputToLibauthOutput(a.utxo.output)),
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
  return { tx_result: best_result, done: best_result_done, unused_inputs };
}
