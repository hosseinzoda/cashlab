import * as payoutBuilder from '@cashlab/common/payout-builder.js';
import { ValueError, InvalidProgramState } from '@cashlab/common/exceptions.js';
import {
  convertTokenIdToUint8Array, uint8ArrayConcat, outputToLibauthOutput,
  calcAvailablePayoutFromIO, inputParamsWithUnlockerToLibauthInputTemplate,
  simpleJsonSerializer,
} from '@cashlab/common/util.js';
import {
  spendableCoinToInputWithUnlocker, generateBytecodeWithLibauthCompiler,
} from '@cashlab/common/util-libauth-dependent.js'
import * as libauth from '@cashlab/common/libauth.js';
const {
  bigIntToBinUintLE, binToBigIntUintLE, bigIntToVmNumber, sha256,
} = libauth;
import type { MoriaCompilerContext, MoriaTxResult } from './types.js';
import type {
  UTXOWithNFT, TokenId, Output, OutputWithFT, OutputWithNFT, SpendableCoin, PayoutRule, Fraction,
  OutputTokenComponent, InputParamsWithUnlocker,
} from '@cashlab/common/types.js';
import {
  NonFungibleTokenCapability, InputUnlockerType, PayoutAmountRuleType,
} from '@cashlab/common/constants.js';

export type ITxGenContext = {
  txfee_per_byte: Fraction;
  getOutputMinAmount (output: Output): bigint;
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null;
};

export const calcRedeemableBCHAmount = (total_owed: bigint, delphi_price: bigint): bigint => {
  return (total_owed * 100000000n) / delphi_price;
};

export const calcInterestOwed = (principal: bigint, annual_interest_bp: bigint, delphi_timestamp: bigint, loan_timestamp: bigint): bigint => {
  const days_elapsed = ((delphi_timestamp - loan_timestamp) + 86400n /* a day */ - 1n) / 86400n;
  return 1n + ((principal * annual_interest_bp * days_elapsed) / 3650000n);
};

export const dataSequenceFromDelphiCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(8, 12));
};
export const timestampFromDelphiCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(0, 6));
};
export const priceFromDelphiCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(12, 16));
};
export const useFeeFromDelphiCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(6, 8));
};
export const createDelphiCommitment = ({ timestamp, use_fee, sequence, price }: { timestamp: bigint, use_fee: bigint, sequence: bigint, price: bigint }): Uint8Array => {
  const commitment = new Uint8Array(16);
  { // set timestamp
    const bin = bigIntToBinUintLE(timestamp);
    if (bin.length > 6) {
      throw new ValueError(`timestamp value cannot fit in 6 bytes.`);
    }
    commitment.set(bin, 0);
  }
  { // set use_fee
    const bin = bigIntToBinUintLE(use_fee);
    if (bin.length > 2) {
      throw new ValueError(`use_fee value cannot fit in 2 bytes.`);
    }
    commitment.set(bin, 6);
  }
  { // set sequence
    const bin = bigIntToBinUintLE(sequence);
    if (bin.length > 4) {
      throw new ValueError(`use_fee value cannot fit in 2 bytes.`);
    }
    commitment.set(bin, 8);
  }
  { // set price
    const bin = bigIntToBinUintLE(price);
    if (bin.length > 4) {
      throw new ValueError(`use_fee value cannot fit in 2 bytes.`);
    }
    commitment.set(bin, 12);
  }
  // bytes [16:20] is reserved
  return commitment;
};

export const loanAgentNFTHashFromLoanCommitment = (commitment: Uint8Array): Uint8Array => {
  return commitment.slice(0, 32);
};
export const principalFromLoanCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(32, 34)) * 100n;
};
export const annualInterestBPFromLoanCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(34, 36));
};
export const timestampFromLoanCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(36, 40));
};
export const createLoanCommitment = ({ loan_agent_nfthash, principal, annual_interest_bp, timestamp }: { loan_agent_nfthash: Uint8Array, principal: bigint, annual_interest_bp: bigint, timestamp: bigint }): Uint8Array => {
  const commitment = new Uint8Array(40);
  commitment.set(loan_agent_nfthash, 0);
  if (principal % 100n != 0n) {
    throw new ValueError(`principal should be divisible by 100`);
  }
  { // set principal
    const bin = bigIntToBinUintLE(principal / 100n);
    if (bin.length > 2) {
      throw new ValueError(`principal value cannot fit in two bytes.`);
    }
    commitment.set(bin, 32);
  }
  { // set annual interest bp
    const bin = bigIntToBinUintLE(annual_interest_bp);
    if (bin.length > 2) {
      throw new ValueError(`annual_interest_bp value cannot fit in two bytes.`);
    }
    commitment.set(bin, 34);
  }
  { // set timestamp
    const bin = bigIntToBinUintLE(timestamp);
    if (bin.length > 4) {
      throw new ValueError(`timestamp value cannot fit in four bytes.`);
    }
    commitment.set(bin, 36);
  }
  return commitment;
};


export const timestampFromBPOracleCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(0, 6));
};
export const useFeeFromBPOracleCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(6, 8));
};
export const bpValueFromBPOracleCommitment = (commitment: Uint8Array): bigint => {
  return binToBigIntUintLE(commitment.slice(8, 10));
};
export const createBPOracleCommitment = ({ timestamp, use_fee, bp_value }: { timestamp: bigint, use_fee: bigint, bp_value: bigint }): Uint8Array => {
  const commitment = new Uint8Array(10);
  { // set timestamp
    const bin = bigIntToBinUintLE(timestamp);
    if (bin.length > 6) {
      throw new ValueError(`timestamp value cannot fit in 6 bytes.`);
    }
    commitment.set(bin, 0);
  }
  { // set use_fee
    const bin = bigIntToBinUintLE(use_fee);
    if (bin.length > 2) {
      throw new ValueError(`use_fee value cannot fit in 2 bytes.`);
    }
    commitment.set(bin, 6);
  }
  { // set bp_value
    const bin = bigIntToBinUintLE(bp_value);
    if (bin.length > 2) {
      throw new ValueError(`use_fee value cannot fit in 2 bytes.`);
    }
    commitment.set(bin, 8);
  }
  return commitment;
};



export type OutputConstraintCommon = {
  type: string;
};
export type OutputConstraintPredefined = OutputConstraintCommon & {
  type: 'PREDEFINED';
  output: Output;
};
export type OutputConstraintFixedAmount = OutputConstraintCommon & {
  type: 'FIXED_AMOUNT';
  token?: OutputTokenComponent;
  amount?: bigint;
};
export type OutputConstraintVariableAmount = OutputConstraintCommon & {
  type: 'VARIABLE_AMOUNT';
  can_contain_token: boolean;
  allowed_tokens?: string[];
  disallowed_tokens?: string[];
  allows_opreturn: boolean;
};
export type OutputConstraint =
  | OutputConstraintPredefined
  | OutputConstraintFixedAmount
  | OutputConstraintVariableAmount;

export const buildOutputsWithConstraints = (constraints: OutputConstraint[], insert_outputs: Output[]): { outputs: Output[], remained_outputs: Output[] } => {
  insert_outputs = insert_outputs.slice();
  const outputs: Output[] = [];
  for (const constraint of constraints) {
    if (constraint.type == 'PREDEFINED') {
      outputs.push(constraint.output);
    } else if (constraint.type == 'FIXED_AMOUNT') {
      if (constraint.amount == null && constraint.token == null) {
        throw new ValueError(`amount or token.amount should be defined in constraint with FIXED_AMOUNT type`);
      }
      const target_output_index = insert_outputs.findIndex((a) => (
        constraint.amount == null || a.amount == constraint.amount
      ) && (
        constraint.token == null ||
          (constraint.token.token_id == a.token?.token_id &&
            constraint.token.amount == a.token?.amount)
      ));
      if (target_output_index == -1) {
        throw new ValueError(`Missing an output with the following constraint: ${JSON.stringify(constraint, simpleJsonSerializer, '  ')}`);
      }
      outputs.push(insert_outputs.splice(target_output_index, 1)[0] as Output);
    } else if (constraint.type == 'VARIABLE_AMOUNT') {
      let target_output_index = -1;
      if (constraint.can_contain_token) {
        target_output_index = insert_outputs.findIndex((a) => (
          a.token != null &&
          (constraint.allowed_tokens != null ? constraint.allowed_tokens.indexOf(a.token.token_id) != -1 : true) &&
            (constraint.disallowed_tokens != null ? constraint.disallowed_tokens.indexOf(a.token.token_id) == -1 : true)
        ));
      }
      if (target_output_index == -1) {
        target_output_index = insert_outputs.findIndex((a) => a.token == null);
      }
      if (target_output_index == -1) {
        // opreturn?
        if (!constraint.allows_opreturn) {
          throw new ValueError(`Missing an output with the following constraint: ${JSON.stringify(constraint, simpleJsonSerializer, '  ')}`);
        } else {
          outputs.push({
            locking_bytecode: new Uint8Array([0x6a]), // OP_RETURN
            amount: 0n,
          });
        }
      } else {
        outputs.push(insert_outputs.splice(target_output_index, 1)[0] as Output);
      }
    }
  }
  return {
    outputs,
    remained_outputs: insert_outputs,
  };
};

export const generateTransactionWithConstraintsAndPayoutRuleExcludingTxFee = (builder_context: ITxGenContext, inputs: InputParamsWithUnlocker[], output_constraint_list: OutputConstraint[], payout_rules: PayoutRule[], options: { strict_constraints: boolean }) => {
  const calcTxFeeWithOutputs = (payout_outputs: Output[]): bigint => {
    const result = generateTransactionWithConstraintsSub(inputs, output_constraint_list, payout_outputs, options);
    return BigInt(libauth.encodeTransaction(result.libauth_transaction).length) * builder_context.txfee_per_byte.numerator / builder_context.txfee_per_byte.denominator;
  };
  const available_payouts: Array<{ token_id: TokenId, amount: bigint }> = calcAvailablePayoutFromIO(inputs, output_constraint_list.filter((a)  => a.type == 'PREDEFINED').map((a) => a.output));
  // validate token/bch amounts
  if (available_payouts.filter((a) => a.amount < 0n).length > 0) {
    throw new ValueError(`Sum of the inputs & outputs is negative for the following token(s): ${available_payouts.filter((a) => a.amount < 0n).map((a) => a.token_id).join(', ')}`);
  }
  // To satisfy FIXED_AMOUNT constraints of token payouts with fixed amount of bch
  // payout builder is modified to overwrite the bch amount
  //   Applied only when payout_rules does not contain any fixed amount rule
  const did_overwrite_token_payout_list: OutputConstraint[] = [];
  const overwriteTokenPayoutBCHAmountIfNeeded = (output: Output): bigint | null => {
    if (payout_rules.filter((a) => a.type == PayoutAmountRuleType.FIXED).length > 0) {
      return null;
    }
    if (output.token != null) {
      for (const output_constraint of output_constraint_list) {
        if (did_overwrite_token_payout_list.indexOf(output_constraint) == -1 &&
            output_constraint.type == 'FIXED_AMOUNT' && output_constraint.token != null &&
            output_constraint.amount != null &&
            output.token.token_id == output_constraint.token.token_id &&
            output.token.amount == output_constraint.token.amount) {
          did_overwrite_token_payout_list.push(output_constraint);
          return output_constraint.amount;
        }
      }
    }
    return null;
  };
  const payout_context = {
    getOutputMinAmount (output: Output): bigint {
      return builder_context.getOutputMinAmount(output);
    },
    getPreferredTokenOutputBCHAmount (output: Output): bigint | null {
      let tmp = overwriteTokenPayoutBCHAmountIfNeeded(output);
      if (tmp != null) {
        return tmp;
      }
      return builder_context.getPreferredTokenOutputBCHAmount(output);
    },
    calcTxFeeWithOutputs,
  };
  const { payout_outputs, txfee, token_burns } = payoutBuilder.build(payout_context, available_payouts, payout_rules, true);
  if (token_burns.length > 0) {
    throw new ValueError(`Token burns not allowed in this transaction`);
  }
  return {
    ...generateTransactionWithConstraintsSub(inputs, output_constraint_list, payout_outputs.map((a) => a.output), options),
    payout_outputs, txfee,
  };
};

export const generateTransactionWithConstraintsSub = (inputs: InputParamsWithUnlocker[], output_constraint_list: OutputConstraint[], payout_outputs: Output[], options: { strict_constraints: boolean }) => {
  const transaction_params = { locktime: 0, version: 2 };
  const { outputs, remained_outputs } = buildOutputsWithConstraints(output_constraint_list, payout_outputs)
  if (options.strict_constraints) {
    if (remained_outputs.length != 0) {
      throw new ValueError(`Could not fit all outputs in the moria transaction, remained_outputs: ${JSON.stringify(remained_outputs, simpleJsonSerializer, '  ')}`);
    }
  } else {
    for (const remained_output of remained_outputs) {
      outputs.push(remained_output);
    }
  }
  const la_inputs = inputs.map((a, i) => inputParamsWithUnlockerToLibauthInputTemplate(i, a, inputs, outputs, transaction_params));
  const la_source_outputs = inputs.map((a) => outputToLibauthOutput(a.utxo.output));
  const la_outputs = outputs.map((a) => outputToLibauthOutput(a));
  const result = libauth.generateTransaction({ ...transaction_params, inputs: la_inputs, outputs: la_outputs });
  if (!result.success) {
    /* c8 ignore next */
    throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, simpleJsonSerializer, '  '));
  }
  return {
    inputs,
    outputs,
    libauth_transaction: result.transaction,
    libauth_source_outputs: la_source_outputs,
    libauth_inputs: la_inputs,
    libauth_outputs: la_outputs,
  };
};

export type GenerateMoriaModifiers = {
  script: string;
  difference: bigint;
  input_loan_utxo?: UTXOWithNFT;
  loan_params?: {
    collateral_amount: bigint;
    annual_interest_bp: bigint;
  };
  loan_agent?: {
    coin?: SpendableCoin<OutputWithNFT>;
    output?: {
      locking_bytecode: Uint8Array;
      amount?: bigint;
      token_amount?: bigint;
    };
    batonminter_utxo?: UTXOWithNFT;
    batonminter_nft_capability?: NonFungibleTokenCapability;
    nfthash?: Uint8Array;
  };
  redeem_params?: {
    bporacle_utxo: UTXOWithNFT;
  };
};

export const generateMoriaTxSub = (context: MoriaCompilerContext, moria_utxo: UTXOWithNFT, moria_modifiers: GenerateMoriaModifiers, delphi_utxo: UTXOWithNFT, funding_coins: SpendableCoin[], payout_rules: PayoutRule[]): MoriaTxResult => {
  let loan_output: OutputWithNFT | null = null;
  let interest_output: OutputWithFT | null = null;
  let loan_agent_output: OutputWithNFT | null = null;
  let bporacle_output: OutputWithNFT | null = null;
  let batonminter_output: OutputWithNFT | null = null;
  let borrower_p2nfth_output: Output | null = null;
  let batonminter_mint_fee: bigint = 0n;
  let bporacle_use_fee: bigint = 0n;
  let delphi_use_fee: bigint = 0n;
  const delphi_data_sequence: bigint = dataSequenceFromDelphiCommitment(delphi_utxo.output.token.nft.commitment);
  const delphi_timestamp: bigint = timestampFromDelphiCommitment(delphi_utxo.output.token.nft.commitment);
  const delphi_price: bigint = priceFromDelphiCommitment(delphi_utxo.output.token.nft.commitment);
  if (delphi_price <= 0n) {
    throw new ValueError(`delphi price should be greater than zero.`)
  }
  const output_constraint_list: OutputConstraint[] = [];
  const inputs: InputParamsWithUnlocker[] = [];
  { // moria at io#0
    if (moria_utxo.output.token == null || moria_utxo.output.token.nft == null) {
      throw new ValueError('moria_utxo is expected to be an nft!');
    }
    inputs.push({
      unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
      sequence_number: 0, utxo: moria_utxo,
      getUnlockBytecodeCompilationDirective () {
        return {
          compiler: context.moria_compiler,
          script: moria_modifiers.script,
        };
      },
    });
    output_constraint_list.push({
      type: 'PREDEFINED',
      output: {
        locking_bytecode: moria_utxo.output.locking_bytecode,
        amount: moria_utxo.output.amount,
        token: {
          token_id: moria_utxo.output.token.token_id,
          amount: moria_utxo.output.token.amount - moria_modifiers.difference,
          nft: {
            capability: moria_utxo.output.token.nft.capability,
            commitment: bigIntToVmNumber(delphi_data_sequence),
          },
        },
      },
    });
  }
  { // delphi at io#1
    if (delphi_utxo.output.token == null || delphi_utxo.output.token.nft == null) {
      throw new ValueError('delphi_utxo is expected to be an nft!');
    }
    delphi_use_fee = useFeeFromDelphiCommitment(delphi_utxo.output.token.nft.commitment);
    inputs.push({
      unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
      sequence_number: 0, utxo: delphi_utxo,
      getUnlockBytecodeCompilationDirective () {
        return {
          compiler: context.delphi_compiler,
          script: 'use',
        };
      },
    });
    output_constraint_list.push({
      type: 'PREDEFINED',
      output: {
        locking_bytecode: delphi_utxo.output.locking_bytecode,
        amount: delphi_utxo.output.amount + delphi_use_fee,
        token: structuredClone(delphi_utxo.output.token),
      },
    });
  }
  if (funding_coins.filter((a) => a.output.token?.nft != null).length > 0) {
    throw new ValueError(`funding_coins should not contain nfts!`);
  }
  const initial_bch_funding_coin = funding_coins.find((a) => a.output.token == null);
  const other_funding_coins = funding_coins.filter((a) => a != initial_bch_funding_coin);
  // moria script specific io
  switch (moria_modifiers.script) {
    case 'moria_repay_loan': {
      if (moria_modifiers.input_loan_utxo == null) {
        throw new ValueError(`input_loan_utxo is not defined!`);
      }
      if (funding_coins.filter((a) => a.output.token != null && (a.output.token.token_id != context.moria_token_id || a.output.token.nft != null)).length > 0) {
        throw new ValueError(`Expecting all funding coins to only contain pure bch or fungible moria tokens.`);
      }
      if (initial_bch_funding_coin != null) {
        // push back the pure bch funding coin to funding coin list
        other_funding_coins.unshift(initial_bch_funding_coin);
      }
      const loan_principal: bigint = principalFromLoanCommitment(moria_modifiers.input_loan_utxo.output.token.nft.commitment);
      const interest_owed: bigint = calcInterestOwed(
        loan_principal,
        annualInterestBPFromLoanCommitment(moria_modifiers.input_loan_utxo.output.token.nft.commitment),
        delphi_timestamp,
        timestampFromLoanCommitment(moria_modifiers.input_loan_utxo.output.token.nft.commitment)
      );
      if (interest_owed <= 0n) {
        /* c8 ignore next */
        throw new InvalidProgramState(`interest_owed should be greater than zero`);
      }
      const total_owed = loan_principal + interest_owed;
      if (moria_modifiers.difference * -1n != loan_principal) {
        throw new ValueError(`-1 * moria_modifiers.difference should be equal to loan_principal.`);
      }
      const loan_script = moria_modifiers.redeem_params != null ? 'loan_redeem' : 'loan_repay';
      // add loan, input#2
      inputs.push({
        unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
        sequence_number: 0, utxo: moria_modifiers.input_loan_utxo,
        getUnlockBytecodeCompilationDirective () {
          return {
            compiler: context.moria_compiler,
            script: loan_script,
          };
        },
      });
      // interest payment output#2
      interest_output = {
        locking_bytecode: context.interest_locking_bytecode,
        amount: -1n,
        token: {
          token_id: context.moria_token_id,
          amount: interest_owed,
        },
      };
      interest_output.amount = context.getOutputMinAmount(interest_output);
      output_constraint_list.push({
        type: 'PREDEFINED',
        output: interest_output,
      });
      if (moria_modifiers.loan_agent != null) {
        if (loan_script == 'loan_redeem') {
          throw new ValueError(`Can only define redeem_params or loan_agent.`);
        }
        if (moria_modifiers.loan_agent.coin == null) {
          throw new ValueError(`moria_modifiers.loan_agent.coin should be defined!`);
        }
        // add loan agent, input#3
        inputs.push(spendableCoinToInputWithUnlocker(moria_modifiers.loan_agent.coin, { sequence_number: 0 }));
      } else {
        if (loan_script == 'loan_redeem') {
          if (moria_modifiers.redeem_params == null) {
            /* c8 ignore next */
            throw new InvalidProgramState(`moria_modifiers.redeem_params == null`);
          }
          // redeem
          // insert bporacle, io#3
          inputs.push({
            unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
            sequence_number: 0, utxo: moria_modifiers.redeem_params.bporacle_utxo,
            getUnlockBytecodeCompilationDirective () {
              return {
                compiler: context.bporacle_compiler,
                script: 'use',
              };
            },
          });
          bporacle_use_fee = useFeeFromBPOracleCommitment(delphi_utxo.output.token.nft.commitment);
          bporacle_output = {
            locking_bytecode: moria_modifiers.redeem_params.bporacle_utxo.output.locking_bytecode,
            amount: moria_modifiers.redeem_params.bporacle_utxo.output.amount + bporacle_use_fee,
            token: structuredClone(moria_modifiers.redeem_params.bporacle_utxo.output.token),
          };
          output_constraint_list.push({
            type: 'PREDEFINED',
            output: bporacle_output,
          });
          const redeemable = calcRedeemableBCHAmount(total_owed, delphi_price);
          // borrower bch, output#4
          const borrower_bch = moria_modifiers.input_loan_utxo.output.amount - redeemable;
          const loan_agent_p2nfth_locking_bytecode = generateBytecodeWithLibauthCompiler(context.p2nfth_compiler, {
            scriptId: '__main__',
            data: {
              bytecode: {
                nfthash: loanAgentNFTHashFromLoanCommitment(moria_modifiers.input_loan_utxo.output.token.nft.commitment),
              },
            },
          });
          borrower_p2nfth_output = {
            locking_bytecode: loan_agent_p2nfth_locking_bytecode,
            amount: borrower_bch,
          };
          output_constraint_list.push({
            type: 'PREDEFINED',
            output: borrower_p2nfth_output,
          });
          // redeemer change, output#5
          output_constraint_list.push({
            type: 'VARIABLE_AMOUNT',
            can_contain_token: true,
            allows_opreturn: false,
            allowed_tokens: [context.moria_token_id],
          });
        } else {
          // liquidate
          const max_borrow = ((moria_modifiers.input_loan_utxo.output.amount * 10n) / 12n) * delphi_price / 100000000n;
          if (max_borrow > total_owed) {
            throw new ValueError(`loan_agent is not provided, Cannot liquidate a loan above the liquidation threshold.`);
          }
        }
      }
      // only execute if it's not an attempt to redeem
      if (loan_script != 'loan_redeem') {
        if (moria_modifiers.loan_agent?.output != null) {
          const loan_agent_coin: SpendableCoin<OutputWithNFT> = moria_modifiers.loan_agent.coin as SpendableCoin<OutputWithNFT>;
          // keep the loan agent, output#3
          loan_agent_output = {
            locking_bytecode: moria_modifiers.loan_agent.output.locking_bytecode,
            amount: -1n,
            token: {
              token_id: loan_agent_coin.output.token.token_id,
              amount: moria_modifiers.loan_agent.output.token_amount != null ? moria_modifiers.loan_agent.output.token_amount : 0n,
              nft: loan_agent_coin.output.token.nft,
            },
          };
          if (moria_modifiers.loan_agent.output.amount != null) {
            loan_agent_output.amount = moria_modifiers.loan_agent.output.amount;
          } else {
            loan_agent_output.amount = context.getOutputMinAmount(loan_agent_output);
          }
          output_constraint_list.push({
            type: 'PREDEFINED',
            output: loan_agent_output,
          });
        } else {
          // insert opreturn, output#3
          output_constraint_list.push({
            type: 'PREDEFINED',
            output: {
              locking_bytecode: new Uint8Array([0x6a]), // OP_RETURN
              amount: 0n,
            },
          });
        }
        // bch-only change, output#4
        output_constraint_list.push({
          type: 'VARIABLE_AMOUNT',
          can_contain_token: false,
          allows_opreturn: true,
        });
        // moria change, output#5
        output_constraint_list.push({
          type: 'VARIABLE_AMOUNT',
          can_contain_token: true,
          allows_opreturn: true,
          allowed_tokens: [context.moria_token_id],
        });
      }
      break;
    }
    case 'moria_update': {
      if (initial_bch_funding_coin == null) {
        throw new ValueError(`A pure bch funding coin is required!`);
      }
      inputs.push(spendableCoinToInputWithUnlocker(initial_bch_funding_coin, { sequence_number: 0 }));
      if (other_funding_coins.length != 0) {
        throw new ValueError(`moria_update only accepts one bch only funding input`);
      }
      output_constraint_list.push({
        type: 'VARIABLE_AMOUNT',
        can_contain_token: false,
        allows_opreturn: true,
      });
      break;
    }
    case 'moria_borrow':
    case 'moria_refinance_loan': {
      if (moria_modifiers.loan_params == null) {
        throw new ValueError(`moria_modifiers.loan_params is null!`)
      }
      if (moria_modifiers.loan_agent == null) {
        throw new ValueError(`moria_modifiers.loan_agent is null!`)
      }
      let output_loan_agent_nft_info: { token_id: string, commitment: Uint8Array } | null = null;
      if (moria_modifiers.script == 'moria_borrow') {
        if (!(moria_modifiers.difference > 0n)) {
          throw new ValueError(`moria_modifiers.difference should be greater than zero in a moria's mint tx.`);
        }
        if (moria_modifiers.loan_agent.nfthash != null) {
          // use provided nfthash
          if (moria_modifiers.loan_agent.batonminter_utxo != null || moria_modifiers.loan_agent.batonminter_nft_capability != null) {
            throw new ValueError(`moria_modifiers.loan_agent.nfthash is defined, Do not provide loan_agent.batonminter data.`);
          }
          if (initial_bch_funding_coin != null) {
            // push back the pure bch funding coin to funding coin list
            other_funding_coins.unshift(initial_bch_funding_coin);
          }
        } else {
          // use batonminter to build a nft agent
          if (initial_bch_funding_coin == null) {
            throw new ValueError(`A pure bch funding coin is required!`);
          }
          // pure bch funding coin input#2
          inputs.push(spendableCoinToInputWithUnlocker(initial_bch_funding_coin, { sequence_number: 0 }));
          // only pure bch funding coins are expected
          if (funding_coins.filter((a) => a.output.token != null).length > 0) {
            throw new ValueError(`Expecting all funding coins to not contain any tokens.`);
          }

          // add minter nft input#3
          if (moria_modifiers.loan_agent.batonminter_utxo == null) {
            throw new ValueError(`moria_modifiers.loan_agent.batonminter_utxo is not defined.`);
          }
          if (moria_modifiers.loan_agent.batonminter_nft_capability == null) {
            throw new ValueError(`moria_modifiers.loan_agent.batonminter_nft_capability is not defined.`);
          }
          output_loan_agent_nft_info = {
            token_id: moria_modifiers.loan_agent.batonminter_utxo.output.token.token_id,
            commitment: moria_modifiers.loan_agent.batonminter_utxo.output.token.nft.commitment,
          };
        }
      } else {
        if (moria_modifiers.loan_agent.nfthash != null) {
          throw new ValueError(`moria_modifiers.loan_agent.nfthash should not be defined on refinance.`);
        }
        if (moria_modifiers.input_loan_utxo == null) {
          throw new ValueError(`input_loan_utxo is not defined!`);
        }
        if (funding_coins.filter((a) => a.output.token != null && (a.output.token.token_id != context.moria_token_id || a.output.token.nft != null)).length > 0) {
          throw new ValueError(`Expecting all funding coins to only contain pure bch or fungible moria tokens.`);
        }
        if (initial_bch_funding_coin != null) {
          // push back the pure bch funding coin to funding coin list
          other_funding_coins.unshift(initial_bch_funding_coin);
        }
        // add loan, input#2
        inputs.push({
          unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
          sequence_number: 0, utxo: moria_modifiers.input_loan_utxo,
          getUnlockBytecodeCompilationDirective () {
            return {
              compiler: context.moria_compiler,
              script: 'loan_refinance',
            };
          },
        });
        // add loan agent, input#3
        if (moria_modifiers.loan_agent.coin == null) {
          throw new ValueError(`moria_modifiers.loan_agent.coin should be defined!`);
        }
        inputs.push(spendableCoinToInputWithUnlocker(moria_modifiers.loan_agent.coin, { sequence_number: 0 }));
        output_loan_agent_nft_info = {
          token_id: moria_modifiers.loan_agent.coin.output.token.token_id,
          commitment: moria_modifiers.loan_agent.coin.output.token.nft.commitment,
        };
      }
      let loan_agent_nfthash: Uint8Array;
      if (output_loan_agent_nft_info != null) {
        if (moria_modifiers.loan_agent.output == null) {
          throw new ValueError(`moria_modifiers.loan_agent.output is not defined!`);
        }
        let loan_agent_output_capability;
        if (moria_modifiers.loan_agent.coin == null) {
          if (moria_modifiers.loan_agent.batonminter_nft_capability == null) {
            /* c8 ignore next */
            throw new InvalidProgramState(`moria_modifiers.loan_agent.coin == null && moria_modifiers.loan_agent.batonminter_nft_capability == null`);
          }
          loan_agent_output_capability = moria_modifiers.loan_agent.batonminter_nft_capability;
        } else {
          loan_agent_output_capability = moria_modifiers.loan_agent.coin.output.token.nft.capability;
        }
        loan_agent_output = {
          locking_bytecode: moria_modifiers.loan_agent.output.locking_bytecode,
          amount: -1n,
          token: {
            token_id: output_loan_agent_nft_info.token_id,
            amount: moria_modifiers.loan_agent.output.token_amount != null ? moria_modifiers.loan_agent.output.token_amount : 0n,
            nft: {
              capability: loan_agent_output_capability,
              commitment: output_loan_agent_nft_info.commitment,
            },
          },
        };
        if (moria_modifiers.loan_agent.output.amount != null) {
          loan_agent_output.amount = moria_modifiers.loan_agent.output.amount;
        } else {
          loan_agent_output.amount = context.getOutputMinAmount(loan_agent_output);
        }
        loan_agent_nfthash = outputNFTHash(loan_agent_output);
      } else {
        if (moria_modifiers.loan_agent.nfthash == null) {
          /* c8 ignore next */
          throw new InvalidProgramState(`output_loan_agent_nft_info == null && moria_modifiers.loan_agent.nfthash == null`);
        }
        if (moria_modifiers.loan_agent.output != null) {
          throw new ValueError(`should not define moria_modifiers.loan_agent.output when loan_agent.nfthash is defined!`);
        }
        loan_agent_nfthash = moria_modifiers.loan_agent.nfthash;
      }
      const input_loan_principal: bigint | null = moria_modifiers.input_loan_utxo ? principalFromLoanCommitment(moria_modifiers.input_loan_utxo.output.token.nft.commitment) : null;
      const loan_locking_bytecode = generateBytecodeWithLibauthCompiler(context.moria_compiler, { scriptId: 'loan' });
      const output_loan_principal = (input_loan_principal != null ? input_loan_principal : 0n) + moria_modifiers.difference;
      if (output_loan_principal < context.mint_min_amount) {
        throw new ValueError(`Output loan should be at least ${context.mint_min_amount} tokens. mint amount: ${output_loan_principal}`);
      }
      if (output_loan_principal > context.mint_max_amount) {
        throw new ValueError(`Output loan should not be greater than ${context.mint_max_amount} tokens. mint amount: ${output_loan_principal}`);
      }
      // loan output#2
      loan_output = {
        locking_bytecode: loan_locking_bytecode,
        amount: moria_modifiers.loan_params.collateral_amount,
        token: {
          amount: 0n,
          token_id: context.moria_token_id,
          nft: {
            capability: NonFungibleTokenCapability.none,
            commitment: createLoanCommitment({
              loan_agent_nfthash,
              principal: output_loan_principal,
              annual_interest_bp: moria_modifiers.loan_params.annual_interest_bp,
              timestamp: delphi_timestamp,
            }),
          },
        },
      };
      output_constraint_list.push({
        type: 'PREDEFINED',
        output: loan_output,
      });
      if (moria_modifiers.script == 'moria_borrow') {
        // borrowed tokens at output#3
        output_constraint_list.push({
          type: 'FIXED_AMOUNT',
          token: { token_id: context.moria_token_id, amount: output_loan_principal },
          amount: 1000n,
        });
        // bch change at output#4
        output_constraint_list.push({
          type: 'VARIABLE_AMOUNT',
          can_contain_token: false,
          allows_opreturn: true,
        });
        if (loan_agent_output != null && moria_modifiers.loan_agent.batonminter_utxo != null) {
          // batonminter at output#5
          batonminter_mint_fee = 1000n;
          const batonminter_utxo = moria_modifiers.loan_agent.batonminter_utxo;
          inputs.push({
            unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
            sequence_number: 0, utxo: batonminter_utxo,
            getUnlockBytecodeCompilationDirective () {
              return {
                compiler: context.batonminter_compiler,
                script: 'mint',
              };
            },
          });
          output_constraint_list.push({
            type: 'PREDEFINED',
            output: batonminter_output = {
              locking_bytecode: batonminter_utxo.output.locking_bytecode,
              amount: batonminter_utxo.output.amount + batonminter_mint_fee,
              token: {
                token_id: batonminter_utxo.output.token.token_id,
                amount: batonminter_utxo.output.token.amount,
                nft: {
                  capability: batonminter_utxo.output.token.nft.capability,
                  commitment: bigIntToVmNumber(binToBigIntUintLE(batonminter_utxo.output.token.nft.commitment) + 1n),
                }
              },
            },
          });
          // baton nft at output#6
          output_constraint_list.push({
            type: 'PREDEFINED',
            output: loan_agent_output,
          });
        } else {
          if (loan_agent_output != null || moria_modifiers.loan_agent.batonminter_utxo != null) {
            /* c8 ignore next */
            throw new InvalidProgramState(`(loan_agent_output || moria_modifiers.loan_agent.batonminter_utxo) is null`);
          }
          // output#6 & output#7
          for (let i = 0; i < 2; i++) {
            output_constraint_list.push({
              type: 'VARIABLE_AMOUNT',
              can_contain_token: true,
              allows_opreturn: true,
              disallowed_tokens: [ context.moria_token_id ],
            });
          }
        }
      } else {
        if (loan_agent_output == null) {
          /* c8 ignore next */
          throw new InvalidProgramState(`loan_agent_output == null (on refi)`);
        }
        if (input_loan_principal == null) {
          /* c8 ignore next */
          throw new InvalidProgramState(`input_loan_principal == null (on refi)`);
        }
        if (moria_modifiers.input_loan_utxo == null) {
          throw new ValueError(`moria_modifiers.input_loan_utxo == null (on refi)`);
        }
        // baton nft at output#3
        output_constraint_list.push({
          type: 'PREDEFINED',
          output: loan_agent_output,
        });
        // interest payment at output#4
        const interest_owed: bigint = calcInterestOwed(
          input_loan_principal,
          annualInterestBPFromLoanCommitment(moria_modifiers.input_loan_utxo.output.token.nft.commitment),
          delphi_timestamp,
          timestampFromLoanCommitment(moria_modifiers.input_loan_utxo.output.token.nft.commitment)

        );
        if (interest_owed <= 0n) {
          /* c8 ignore next */
          throw new InvalidProgramState(`interest_owed should be greater than zero`);
        }
        interest_output = {
          locking_bytecode: context.interest_locking_bytecode,
          amount: -1n,
          token: {
            token_id: context.moria_token_id,
            amount: interest_owed,
          },
        };
        interest_output.amount = context.getOutputMinAmount(interest_output);
        output_constraint_list.push({
          type: 'PREDEFINED',
          output: interest_output,
        });
        // change at output #5 & #6
        output_constraint_list.push({
          type: 'VARIABLE_AMOUNT',
          can_contain_token: true,
          allows_opreturn: true,
        });
        output_constraint_list.push({
          type: 'VARIABLE_AMOUNT',
          can_contain_token: true,
          allows_opreturn: true,
        });
      }
      break;
    }
  }
  for (const other_funding_coin of other_funding_coins) {
    inputs.push(spendableCoinToInputWithUnlocker(other_funding_coin, { sequence_number: 0 }));
  }
  const vtxresult = generateTransactionWithConstraintsAndPayoutRuleExcludingTxFee(context, inputs, output_constraint_list, payout_rules, { strict_constraints: true });
  const txbin = libauth.encodeTransaction(vtxresult.libauth_transaction);
  const txhash = libauth.hashTransactionUiOrder(txbin);
  const result: MoriaTxResult = {
    moria_utxo: {
      outpoint: { txhash, index: 0 },
      output: vtxresult.outputs[0] as OutputWithNFT,
    },
    delphi_utxo: {
      outpoint: { txhash, index: 1 },
      output: vtxresult.outputs[1] as OutputWithNFT,
    },
    loan_utxo: null, interest_utxo: null, loan_agent_utxo: null,
    bporacle_utxo: null, batonminter_utxo: null, borrower_p2nfth_utxo: null,
    txbin, txhash, txfee: vtxresult.txfee,
    fees: {
      batonminter_mint_fee,
      bporacle_use_fee,
      delphi_use_fee,
      total: batonminter_mint_fee + bporacle_use_fee + delphi_use_fee,
    },
    payouts: (vtxresult.outputs
      .map((a, i) => ({ index: i, output: vtxresult.payout_outputs.findIndex((b) => b.output == a) != -1 ? a : null }))
      .filter((a) => a.output != null) as Array<{ index: number, output: Output }>)
      .map((a) => ({ outpoint: { txhash, index: a.index }, output: a.output })),
    libauth_transaction: vtxresult.libauth_transaction,
    libauth_source_outputs: vtxresult.libauth_source_outputs,
  };
  for (const { utxo_name, output } of [
    { utxo_name: 'loan_utxo', output: loan_output },
    { utxo_name: 'interest_utxo', output: interest_output },
    { utxo_name: 'loan_agent_utxo', output: loan_agent_output },
    { utxo_name: 'bporacle_utxo', output: bporacle_output },
    { utxo_name: 'batonminter_utxo', output: batonminter_output },
    { utxo_name: 'borrower_p2nfth_utxo', output: borrower_p2nfth_output },
  ]) {
    if (output != null) {
      const output_index = vtxresult.outputs.findIndex((a) => output == a);
      if (output_index == -1) {
        /* c8 ignore next */
        throw new InvalidProgramState(`${utxo_name} output index not found!`);
      }
      (result as any)[utxo_name] = { outpoint: { txhash, index: output_index }, output };
    }
  }
  return result;
};

export const outputNFTHash = (output: OutputWithNFT): Uint8Array => {
  return sha256.hash(sha256.hash(
    uint8ArrayConcat([
      convertTokenIdToUint8Array(output.token.token_id).reverse(),
      output.token.nft.capability == 'mutable' ? new Uint8Array([0x01]) :
        (output.token.nft.capability == 'minting' ? new Uint8Array([0x02]) : null),
      output.token.nft.commitment,
    ].filter((a) => a != null))
  ));
};
