import * as payoutBuilder from '@cashlab/common/payout-builder.js';
import { ValueError, InvalidProgramState } from '@cashlab/common/exceptions.js';
import {
  convertTokenIdToUint8Array, outputFromLibauthOutput,
  uint8ArrayEqual, uint8ArrayConcat,
} from '@cashlab/common/util.js';
import {
  publicKeyHashToP2pkhLockingBytecode, convertSpendableCoinsToLAInputsWithSourceOutput,
  calcAvailablePayoutFromLASourceOutputsAndOutputs,
} from '@cashlab/common/util-libauth-dependent.js';
import * as libauth from '@cashlab/common/libauth.js';
const {
  binToBigIntUintLE, bigIntToVmNumber, privateKeyToP2pkhLockingBytecode, binToNumberUint32LE,
} = libauth;
import type {
  MoriaTxResult, MintTxResult, RedeemTxResult, AddCollateralTxResult,
  RefinanceLoanResult, CompilerContext
} from './types.js';
import type {
  UTXO, UTXOWithNFT, TokenId, Output, OutputWithFT, OutputWithNFT, SpendableCoin, PayoutRule,
  TxResult,
} from '@cashlab/common/types.js';
import {
  NonFungibleTokenCapability, SpendableCoinType, PayoutAmountRuleType,
} from '@cashlab/common/constants.js';

const makePayoutContext = (context: CompilerContext, calcTxFeeWithOutputs: (outputs: Output[]) => bigint) => {
  return {
    getOutputMinAmount (output: Output): bigint {
      return context.getOutputMinAmount(output);
    },
    getPreferredTokenOutputBCHAmount (output: Output): bigint | null {
      return context.getPreferredTokenOutputBCHAmount(output);
    },
    calcTxFeeWithOutputs,
  };
};

const payoutResultToUTXO = (txhash: Uint8Array, a: { output: Output, output_index: number }): UTXO => ({ outpoint: { txhash, index: a.output_index }, output: a.output });

const generateMoriaTxSub = (context: CompilerContext, moria_utxo: UTXOWithNFT, moria_modifier: { script: string, data: libauth.CompilationData<never>, musd_difference: bigint, collateral_amount?: bigint }, oracle_utxo: UTXOWithNFT, additional_inputs: Array<{ input: libauth.InputTemplate<libauth.CompilerBCH>, source_output: libauth.Output }>, payout_rules: PayoutRule[]): { transaction: libauth.Transaction, source_outputs: libauth.Output[], payout_result_list: Array<{ payout_rule: PayoutRule, output: Output, output_index: number }>, txbin: Uint8Array, txhash: Uint8Array, txfee: bigint, oracle_use_fee: bigint, moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, loan_utxo: UTXOWithNFT | null } => {
  let loan_output: OutputWithNFT | null = null;
  let oracle_use_fee: bigint;
  const oracle_data_sequence: number = binToNumberUint32LE(oracle_utxo.output.token.nft.commitment.slice(28, 32));
  const payout_result_list: Array<{ payout_rule: PayoutRule, output: Output, output_index: number }> = [];
  const source_outputs: libauth.Output[] = [];
  const inputs: libauth.InputTemplate<libauth.CompilerBCH>[] = [];
  const outputs: libauth.OutputTemplate<libauth.CompilerBCH>[] = [];

  { // moria at io#0
    if (moria_utxo.output.token == null || moria_utxo.output.token.nft == null) {
      throw new ValueError('moria_utxo is expected to be an nft!');
    }
    const source_output = {
      lockingBytecode: moria_utxo.output.locking_bytecode,
      valueSatoshis: moria_utxo.output.amount,
      token: {
        amount: moria_utxo.output.token.amount,
        category: convertTokenIdToUint8Array(moria_utxo.output.token.token_id),
        nft: {
          capability: moria_utxo.output.token.nft.capability,
          commitment: moria_utxo.output.token.nft.commitment,
        },
      },
    };
    source_outputs.push(source_output);
    inputs.push({
      outpointIndex: moria_utxo.outpoint.index,
      outpointTransactionHash: moria_utxo.outpoint.txhash,
      sequenceNumber: 0,
      unlockingBytecode: {
        compiler: context.moria_compiler,
        script: moria_modifier.script,
        data: moria_modifier.data,
        valueSatoshis: source_output.valueSatoshis,
        token: source_output.token,
      },
    });
    outputs.push({
      // copy from input
      lockingBytecode: moria_utxo.output.locking_bytecode,
      valueSatoshis: context.moria_required_output_amount,
      token: {
        amount: source_output.token.amount - moria_modifier.musd_difference,
        category: convertTokenIdToUint8Array(moria_utxo.output.token.token_id),
        nft: {
          capability: moria_utxo.output.token.nft.capability,
          commitment: bigIntToVmNumber(BigInt(oracle_data_sequence)),
        },
      },
    });
  }
  { // oracle at io#1
    if (oracle_utxo.output.token == null || oracle_utxo.output.token.nft == null) {
      throw new ValueError('oracle_utxo is expected to be an nft!');
    }
    const source_output = {
      lockingBytecode: oracle_utxo.output.locking_bytecode,
      valueSatoshis: oracle_utxo.output.amount,
      token: {
        amount: oracle_utxo.output.token.amount,
        category: convertTokenIdToUint8Array(oracle_utxo.output.token.token_id),
        nft: {
          capability: oracle_utxo.output.token.nft.capability,
          commitment: oracle_utxo.output.token.nft.commitment,
        },
      },
    };
    source_outputs.push(source_output);
    inputs.push({
      outpointIndex: oracle_utxo.outpoint.index,
      outpointTransactionHash: oracle_utxo.outpoint.txhash,
      sequenceNumber: 0,
      unlockingBytecode: {
        compiler: context.oracle_compiler,
        script: 'oracle_use',
        data: {},
        valueSatoshis: source_output.valueSatoshis,
        token: source_output.token,
      },
    });
    oracle_use_fee = context.oracle_use_fee;
    outputs.push({
      // copy from input
      lockingBytecode: oracle_utxo.output.locking_bytecode,
      valueSatoshis: oracle_utxo.output.amount + oracle_use_fee,
      token: {
        amount: oracle_utxo.output.token.amount,
        category: convertTokenIdToUint8Array(oracle_utxo.output.token.token_id),
        nft: {
          capability: oracle_utxo.output.token.nft.capability,
          commitment: oracle_utxo.output.token.nft.commitment,
        },
      },
    });
  }
  // add additional inputs
  for (const { input, source_output } of additional_inputs) {
    inputs.push(input);
    source_outputs.push(source_output);
  }
  // moria script specific output
  switch (moria_modifier.script) {
    case 'moria_mint': { // loan at output#2
      if (!(moria_modifier.data?.bytecode && moria_modifier.data?.bytecode['borrower_pkh'] instanceof Uint8Array && moria_modifier.data.bytecode['borrower_pkh'].length == 20)) {
        throw new ValueError(`Expecting moria_modifier.data.bytecode.borrower_pkh to be of type Uint8Array(20) when the moria_mint script is executed`);
      }
      if (!(moria_modifier.musd_difference as any > 0n)) {
        throw new ValueError(`moria_modifier.musd_difference should be greater than zero in a moria's mint tx.`);
      }
      if (!(moria_modifier.collateral_amount as any > 0n)) {
        throw new ValueError(`Loan's collateral_amount should be greater than zero in a moria's mint tx.`);
      }
      const locking_bytecode_result = context.moria_compiler.generateBytecode({
        data: {},
        scriptId: 'loan',
      });
      if (!locking_bytecode_result.success) {
        /* c8 ignore next */
        throw new InvalidProgramState('Failed to generate bytecode, script: loan, ' + JSON.stringify(locking_bytecode_result, null, '  '));
      }
      if (moria_modifier.musd_difference < context.min_mint_musd_amount) {
        throw new ValueError(`Should mint at least more than ${context.min_mint_musd_amount} tokens. mint amount: ${moria_modifier.musd_difference}`);
      }
      loan_output = {
        locking_bytecode: locking_bytecode_result.bytecode,
        amount: moria_modifier.collateral_amount as bigint,
        token: {
          amount: 0n,
          token_id: context.musd_token_id,
          nft: {
            capability: NonFungibleTokenCapability.none,
            commitment: uint8ArrayConcat([ moria_modifier.data.bytecode['borrower_pkh'], bigIntToVmNumber(moria_modifier.musd_difference) ]),
          },
        },
      };
      outputs.push({
        lockingBytecode: {
          compiler: context.moria_compiler,
          script: 'loan',
          data: {},
        },
        valueSatoshis: loan_output.amount,
        token: {
          amount: loan_output.token.amount,
          category: convertTokenIdToUint8Array(context.musd_token_id),
          nft: {
            capability: loan_output.token.nft.capability,
            commitment: loan_output.token.nft.commitment,
          },
        },
      });
      break;
    }
  }
  // the remaining outputs are dependent to the moria's unlocking script
  const calcTxFeeWithOutputs = (payout_outputs: Output[]): bigint => {
    const alt_outputs = [ ...outputs, ...payout_outputs.map((a) => ({
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
    })) ];
    const result = libauth.generateTransaction({
      locktime: 0,
      version: 2,
      inputs, outputs: alt_outputs,
    });
    if (!result.success) {
      /* c8 ignore next */
      throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
    }
    return BigInt(libauth.encodeTransaction(result.transaction).length) * context.txfee_per_byte;
  };
  const available_payouts: Array<{ token_id: TokenId, amount: bigint }> = calcAvailablePayoutFromLASourceOutputsAndOutputs(source_outputs as libauth.Output<never, never>[], outputs as libauth.Output<never, never>[]);
  // validate token/bch amounts
  if (available_payouts.filter((a) => a.amount < 0n).length > 0) {
    throw new ValueError(`Sum of the inputs & outputs is negative for the following token(s): ${available_payouts.filter((a) => a.amount < 0n).map((a) => a.token_id).join(', ')}`);
  }
  const { payout_outputs: payout_outputs_withpr, txfee, token_burns } = payoutBuilder.build(makePayoutContext(context, calcTxFeeWithOutputs), available_payouts, payout_rules, true);
  if (token_burns.length > 0) {
    throw new ValueError(`Token burns not allowed in moria's update/mint txs`);
  }
  switch (moria_modifier.script) {
    case 'moria_update': {
      if (payout_outputs_withpr.length > 2) {
        throw new ValueError(`Not able to set more than two payout outputs in a moria's update tx.`);
      }
      { // bch change at output#2
        if (payout_outputs_withpr.filter((a) => a.output.token == null).length == 0) {
          throw new ValueError('Not able to generate a moria tx with only one mixed payout output.');
        }
        const payout_output_idx = payout_outputs_withpr.findIndex((a) => a.output.token == null);
        const payout_output_withpr = payout_outputs_withpr.splice(payout_output_idx, 1)[0];
        if (payout_output_withpr == null) {
          /* c8 ignore next */
          throw new InvalidProgramState('');
        }
        payout_result_list.push({ output: payout_output_withpr.output, payout_rule: payout_output_withpr.payout_rule, output_index: outputs.length });
        outputs.push({
          lockingBytecode: payout_output_withpr.output.locking_bytecode,
          token: undefined,
          valueSatoshis: payout_output_withpr.output.amount,
        });
      }
      const second_payout_output_withpr = payout_outputs_withpr.shift();
      if (second_payout_output_withpr != null) { // optional bch/token change at output#3
        payout_result_list.push({ output: second_payout_output_withpr.output, payout_rule: second_payout_output_withpr.payout_rule, output_index: outputs.length });
        outputs.push({
          lockingBytecode: second_payout_output_withpr.output.locking_bytecode,
          token: second_payout_output_withpr.output.token ? {
            amount: second_payout_output_withpr.output.token.amount,
            category: convertTokenIdToUint8Array(second_payout_output_withpr.output.token.token_id),
          } : undefined,
          valueSatoshis: second_payout_output_withpr.output.amount,
        });
      }
      break;
    }
    case 'moria_mint': {
      // payouts
      if (payout_outputs_withpr.length > 3) {
        throw new ValueError(`Not able to have more than three payout outputs in a moria's loan tx.`);
      }
      // token payout
      const token_payout_idx = payout_outputs_withpr.findIndex((a) => a.output.amount == context.mint_musd_payout_required_output_amount && a.output.token?.token_id == context.musd_token_id && a.output.token?.amount == moria_modifier.musd_difference);
      if (token_payout_idx == -1) {
        throw new ValueError(`At least one MUSD payout output is required with a fixed bch amount & token amount, Expecting it to have ${context.mint_musd_payout_required_output_amount} sats & ${moria_modifier.musd_difference} MUSD tokens`);
      }
      { // musd payout at output#3
        const token_payout_output_withpr = payout_outputs_withpr.splice(token_payout_idx, 1)[0];
        if (token_payout_output_withpr == null) {
          /* c8 ignore next */
          throw new InvalidProgramState('');
        }
        payout_result_list.push({ output: token_payout_output_withpr.output, payout_rule: token_payout_output_withpr.payout_rule, output_index: outputs.length });
        outputs.push({
          lockingBytecode: token_payout_output_withpr.output.locking_bytecode,
          token: token_payout_output_withpr.output.token ? {
            amount: token_payout_output_withpr.output.token.amount,
            category: convertTokenIdToUint8Array(token_payout_output_withpr.output.token.token_id),
          } : undefined,
          valueSatoshis: token_payout_output_withpr.output.amount,
        });
      }
      let bch_payout_counter = 0;
      while (true) { // bch change at output#4
        const payout_output_withpr = payout_outputs_withpr.shift();
        if (payout_output_withpr == null) {
          break;
        }
        if (++bch_payout_counter > 2) {
          /* c8 ignore next */
          throw new InvalidProgramState(`bch change at output#4/5, ++bch_payout_counter > 2`);
        }
        if (payout_output_withpr.output.token != null) {
          throw new ValueError(`Only one payout with token is allowed in a moria's borrow tx.`);
        }
        payout_result_list.push({ output: payout_output_withpr.output, payout_rule: payout_output_withpr.payout_rule, output_index: outputs.length });
        outputs.push({
          lockingBytecode: payout_output_withpr.output.locking_bytecode,
          token: undefined,
          valueSatoshis: payout_output_withpr.output.amount,
        });
      }
      break;
    }
    default: {
      throw new ValueError('Unknown moria unlocking script: ' + moria_modifier.script);
    }
  }
  const result = libauth.generateTransaction({
    locktime: 0,
    version: 2,
    inputs, outputs,
  });
  if (!result.success) {
    /* c8 ignore next */
    throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
  }
  const txbin = libauth.encodeTransaction(result.transaction);
  const txhash = libauth.hashTransactionUiOrder(txbin);
  return {
    txbin, txhash,
    moria_utxo: {
      outpoint: { txhash, index: 0 },
      output: outputFromLibauthOutput(result.transaction.outputs[0] as libauth.Output) as OutputWithNFT,
    },
    oracle_utxo: {
      outpoint: { txhash, index: 1 },
      output: outputFromLibauthOutput(result.transaction.outputs[1] as libauth.Output) as OutputWithNFT,
    },
    loan_utxo: loan_output != null ? {
      outpoint: { txhash, index: 2 },
      output: loan_output,
    } : null,
    transaction: result.transaction,
    source_outputs,
    payout_result_list,
    txfee,
    oracle_use_fee,
  };
};

function validateMoriaUTXO (context: CompilerContext, utxo: UTXOWithNFT) {
  if (utxo.output.token == null || utxo.output.token.token_id != context.musd_token_id) {
    throw new ValueError(`Expecting moria_utxo to have the following token_id: ${context.musd_token_id}`);
  }
  if (utxo.output.token.nft == null || utxo.output.token.nft.capability != NonFungibleTokenCapability.minting) {
    throw new ValueError(`Expecting moria_utxo to have minting capability`);
  }
}

function validateOracleUTXO (context: CompilerContext, utxo: UTXOWithNFT) {
  if (utxo.output.token == null || utxo.output.token.token_id != context.oracle_token_id) {
    throw new ValueError(`Expecting oracle_utxo to have the following token_id: ${context.oracle_token_id}`);
  }
  if (utxo.output.token.nft == null || utxo.output.token.nft.commitment == null || utxo.output.token.nft.commitment.length == 0) {
    throw new ValueError(`Expecting oracle_utxo to be a nft with a non-empty commitment`);
  }
}

/**
 * Mint a new loan. The collateral amount is taken from input_coins and the remaining - fees is in the payouts.
 *
 * @param context - The compiler's context.
 * @param moria_utxo - The moria's utxo.
 * @param oracle_utxo - The oracle's utxo.
 * @param input_coins - A set of spendable coins to fund the loan's collateral + fees
 * @param loan_amount - The amount of MUSD to mint.
 * @param collateral_amount - The collateral amount (sats)
 * @param borrower_pkh - borrower's public key's hash160, the pkh's format is equivalent to pkh used in p2pkh
 * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
 * @returns The mint tx result.
 *
 */
export function mintLoan (context: CompilerContext, moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, input_coins: SpendableCoin[], loan_amount: bigint, collateral_amount: bigint, borrower_pkh: Uint8Array, token_payout_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): MintTxResult {
  validateMoriaUTXO(context, moria_utxo);
  validateOracleUTXO(context, oracle_utxo);
  if (!(oracle_utxo.output.token?.nft?.commitment instanceof Uint8Array && oracle_utxo.output.token.nft.commitment.length == 36)) {
    throw new ValueError(`Expecting oracle_utxo nft to have a 36 bytes commitment.`);
  }
  const oracle_price = binToBigIntUintLE(oracle_utxo.output.token.nft.commitment.slice(32));
  if (!(oracle_price > 0)) {
    throw new ValueError('oracle price should be greater than zero');
  }
  const calcMaxLoan = (a: bigint): bigint => (((a * 2n) / 3n) * oracle_price) / 100000000n;
  if (loan_amount > calcMaxLoan(collateral_amount)) {
    throw new ValueError('collateral amount should at least be worth 150% of the loan amount.');
  }
  const moria_modifier: { script: string, data: any, musd_difference: bigint, collateral_amount?: bigint } = {
    script: 'moria_mint',
    data: {
      bytecode: {
        borrower_pkh,
      },
    },
    musd_difference: loan_amount,
    collateral_amount,
  };
  const additional_inputs: Array<{ input: libauth.InputTemplate<libauth.CompilerBCH>, source_output: libauth.Output }> = convertSpendableCoinsToLAInputsWithSourceOutput(input_coins);
  const {
    transaction, source_outputs, payout_result_list,
    moria_utxo: next_moria_utxo, oracle_utxo: next_oracle_utxo, loan_utxo,
    txbin, txhash, txfee, oracle_use_fee,
  } = generateMoriaTxSub(context, moria_utxo, moria_modifier, oracle_utxo, additional_inputs, [
    {
      type: PayoutAmountRuleType.FIXED,
      amount: context.mint_musd_payout_required_output_amount,
      token: {
        token_id: context.musd_token_id,
        amount: loan_amount,
      },
      locking_bytecode: token_payout_locking_bytecode,
    },
    ...payout_rules,
  ]);
  if (loan_utxo == null) {
    /* c8 ignore next */
    throw new InvalidProgramState('loan_output == null!!!');
  }
  return {
    txbin, txhash, txfee, oracle_use_fee,
    moria_utxo: next_moria_utxo, oracle_utxo: next_oracle_utxo, loan_utxo,
    payouts: payout_result_list.map((a) => payoutResultToUTXO(txhash, a)),
    libauth_transaction: transaction,
    libauth_source_outputs: source_outputs,
  };
}

/**
 * Repay a loan with MUSD tokens equivalent to the loan amount.
 * The payout is the loan's collateral + the remainder of MUSD tokens if more MUSD is provided in inputs.
 * 
 *
 * @param context - The compiler's context.
 * @param moria_utxo - The moria's utxo.
 * @param oracle_utxo - The oracle's utxo.
 * @param loan_utxo - The current loan's utxo.
 * @param loan_private_key - The private key of the current loan.
 * @param input_coins - A set of spendable coins to fund the transaction.
 * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
 * @returns A tx that pays out the collateral in exchange for MUSD
 *
 */
export function repayLoan (context: CompilerContext, moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, loan_utxo: UTXOWithNFT, loan_private_key: Uint8Array, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): MoriaTxResult {
  validateMoriaUTXO(context, moria_utxo);
  validateOracleUTXO(context, oracle_utxo);
  if (!(loan_utxo.output.token?.nft?.commitment instanceof Uint8Array && loan_utxo.output.token.nft.commitment.length > 20)) {
    throw new ValueError('loan_utxo has no commitment or the size of the commitment does not meet the requirement');
  }
  const loan_amount = binToBigIntUintLE(loan_utxo.output.token.nft.commitment.slice(20));
  if (loan_amount <= 0n) {
    throw new ValueError('loan_amount should be greater than zero!');
  }
  const moria_modifier: { script: string, data: any, musd_difference: bigint } = {
    script: 'moria_update',
    data: {},
    musd_difference: -1n * loan_amount,
  };
  const la_loan_source_output = {
    lockingBytecode: loan_utxo.output.locking_bytecode,
    valueSatoshis: loan_utxo.output.amount,
    token: {
      amount: loan_utxo.output.token.amount,
      category: convertTokenIdToUint8Array(loan_utxo.output.token.token_id),
      nft: {
        capability: loan_utxo.output.token.nft.capability,
        commitment: loan_utxo.output.token.nft.commitment,
      },
    },
  };
  const la_loan_input = {
    outpointIndex: loan_utxo.outpoint.index,
    outpointTransactionHash: loan_utxo.outpoint.txhash,
    sequenceNumber: 0,
    unlockingBytecode: {
      compiler: context.moria_compiler,
      script: 'loan_repay',
      data: {
        keys: {
          privateKeys: {
            borrower_key: loan_private_key,
          },
        },
      },
      valueSatoshis: la_loan_source_output.valueSatoshis,
      token: la_loan_source_output.token,
    },
  };
  const additional_inputs: Array<{ input: libauth.InputTemplate<libauth.CompilerBCH>, source_output: libauth.Output }> = [
    { input: la_loan_input, source_output: la_loan_source_output },
    ...convertSpendableCoinsToLAInputsWithSourceOutput(input_coins)
  ];
  const {
    transaction, source_outputs, payout_result_list,
    moria_utxo: next_moria_utxo, oracle_utxo: next_oracle_utxo,
    txbin, txhash, txfee, oracle_use_fee,
  } = generateMoriaTxSub(context, moria_utxo, moria_modifier, oracle_utxo, additional_inputs, payout_rules);
  return {
    txbin, txhash, txfee, oracle_use_fee,
    moria_utxo: next_moria_utxo, oracle_utxo: next_oracle_utxo,
    payouts: payout_result_list.map((a) => payoutResultToUTXO(txhash, a)),
    libauth_transaction: transaction,
    libauth_source_outputs: source_outputs,
  };
}


/**
 * Liquidate an under-water (collateral < 110%) loan. With MUSD tokens equivalent to the loan amount.
 * The payout is the loan's collateral + the remainder of MUSD tokens if more MUSD is provided in inputs.
 * 
 *
 * @param context - The compiler's context.
 * @param moria_utxo - The moria's utxo.
 * @param oracle_utxo - The oracle's utxo.
 * @param loan_utxo - The current loan's utxo.
 * @param input_coins - A set of spendable coins to fund the transaction.
 * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
 * @returns A tx that pays out the collateral in exchange for MUSD
 *
 */
export function liquidateLoan (context: CompilerContext, moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, loan_utxo: UTXOWithNFT, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): MoriaTxResult {
  validateMoriaUTXO(context, moria_utxo);
  validateOracleUTXO(context, oracle_utxo);
  if (!(loan_utxo.output.token?.nft?.commitment instanceof Uint8Array && loan_utxo.output.token.nft.commitment.length > 20)) {
    throw new ValueError('loan_utxo has no commitment or the size of the commitment does not meet the requirement');
  }
  const loan_amount = binToBigIntUintLE(loan_utxo.output.token.nft.commitment.slice(20));
  if (loan_amount <= 0n) {
    throw new ValueError('loan_amount should be greater than zero!');
  }
  const moria_modifier: { script: string, data: any, musd_difference: bigint } = {
    script: 'moria_update',
    data: {},
    musd_difference: -1n * loan_amount,
  };
  const la_loan_source_output = {
    lockingBytecode: loan_utxo.output.locking_bytecode,
    valueSatoshis: loan_utxo.output.amount,
    token: {
      amount: loan_utxo.output.token.amount,
      category: convertTokenIdToUint8Array(loan_utxo.output.token.token_id),
      nft: {
        capability: loan_utxo.output.token.nft.capability,
        commitment: loan_utxo.output.token.nft.commitment,
      },
    },
  };
  const la_loan_input = {
    outpointIndex: loan_utxo.outpoint.index,
    outpointTransactionHash: loan_utxo.outpoint.txhash,
    sequenceNumber: 0,
    unlockingBytecode: {
      compiler: context.moria_compiler,
      script: 'loan_liquidate',
      data: {},
      valueSatoshis: la_loan_source_output.valueSatoshis,
      token: la_loan_source_output.token,
    },
  };
  const additional_inputs: Array<{ input: libauth.InputTemplate<libauth.CompilerBCH>, source_output: libauth.Output }> = [
    { input: la_loan_input, source_output: la_loan_source_output },
    ...convertSpendableCoinsToLAInputsWithSourceOutput(input_coins)
  ];
  const {
    transaction, source_outputs, payout_result_list,
    moria_utxo: next_moria_utxo, oracle_utxo: next_oracle_utxo,
    txbin, txhash, txfee, oracle_use_fee,
  } = generateMoriaTxSub(context, moria_utxo, moria_modifier, oracle_utxo, additional_inputs, payout_rules);
  return {
    txbin, txhash, txfee, oracle_use_fee,
    moria_utxo: next_moria_utxo, oracle_utxo: next_oracle_utxo,
    payouts: payout_result_list.map((a) => payoutResultToUTXO(txhash, a)),
    libauth_transaction: transaction,
    libauth_source_outputs: source_outputs,
  };
}

/**
 * Redeem MUSD tokens equivalent to the loan amount with a BCH payout,
 * The payout includes the remainder of MUSD tokens if more MUSD is provided in inputs.
 * 
 *
 * @param context - The compiler's context.
 * @param moria_utxo - The moria's utxo.
 * @param oracle_utxo - The oracle's utxo.
 * @param loan_utxo - The current loan's utxo.
 * @param sunset_datasig - A unique sig which will be revealed on the blockchain once the sunset event occurs.
 * @param input_coins - A set of spendable coins to fund the transaction.
 * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
 * @returns A tx that redeems MUSD with BCH payouts
 *
 */
export function redeemWithSunsetSignature (context: CompilerContext, moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, loan_utxo: UTXOWithNFT, sunset_datasig: Uint8Array, input_coins: SpendableCoin[], redeemer_payout_rules: PayoutRule[]): RedeemTxResult {
  validateMoriaUTXO(context, moria_utxo);
  validateOracleUTXO(context, oracle_utxo);
  if (!(loan_utxo.output.token?.nft?.commitment instanceof Uint8Array && loan_utxo.output.token.nft.commitment.length > 20)) {
    throw new ValueError('loan_utxo has no commitment or the size of the commitment does not meet the requirement');
  }
  const loan_amount = binToBigIntUintLE(loan_utxo.output.token.nft.commitment.slice(20));
  if (loan_amount <= 0n) {
    throw new ValueError('loan_amount should be greater than zero!');
  }
  const borrower_pkh = loan_utxo.output.token.nft.commitment.slice(0, 20);
  const collateral = loan_utxo.output.amount;
  if (!(redeemer_payout_rules.length == 1 && redeemer_payout_rules.filter((a) => a.type == PayoutAmountRuleType.CHANGE).length == 1)) {
    throw new ValueError(`Only one payout_rule of type CHANGE is accepted.`);
  }
  if (!(oracle_utxo.output.token?.nft?.commitment instanceof Uint8Array && oracle_utxo.output.token.nft.commitment.length == 36)) {
    throw new ValueError(`Expecting oracle_utxo nft to have a 36 bytes commitment.`);
  }
  const oracle_price = binToBigIntUintLE(oracle_utxo.output.token.nft.commitment.slice(32));
  if (!(oracle_price > 0)) {
    throw new ValueError('oracle price should be greater than zero');
  }
  const redeemable = (loan_amount * 100000000n) / oracle_price;
  const remainder = collateral - redeemable;
  const borrower_payout_rule = { type: PayoutAmountRuleType.FIXED, token: undefined, amount: remainder, locking_bytecode: publicKeyHashToP2pkhLockingBytecode(borrower_pkh) };
  const payout_rules: PayoutRule[] = [
    borrower_payout_rule,
    ...redeemer_payout_rules,
  ]
  const moria_modifier: { script: string, data: any, musd_difference: bigint } = {
    script: 'moria_update',
    data: {},
    musd_difference: -1n * loan_amount,
  };
  const la_loan_source_output = {
    lockingBytecode: loan_utxo.output.locking_bytecode,
    valueSatoshis: loan_utxo.output.amount,
    token: {
      amount: loan_utxo.output.token.amount,
      category: convertTokenIdToUint8Array(loan_utxo.output.token.token_id),
      nft: {
        capability: loan_utxo.output.token.nft.capability,
        commitment: loan_utxo.output.token.nft.commitment,
      },
    },
  };
  const la_loan_input = {
    outpointIndex: loan_utxo.outpoint.index,
    outpointTransactionHash: loan_utxo.outpoint.txhash,
    sequenceNumber: 0,
    unlockingBytecode: {
      compiler: context.moria_compiler,
      script: 'loan_sunset_redeem',
      data: {
        bytecode: {
          sunset_datasig,
        },
      },
      valueSatoshis: la_loan_source_output.valueSatoshis,
      token: la_loan_source_output.token,
    },
  };
  const additional_inputs: Array<{ input: libauth.InputTemplate<libauth.CompilerBCH>, source_output: libauth.Output }> = [
    { input: la_loan_input, source_output: la_loan_source_output },
    ...convertSpendableCoinsToLAInputsWithSourceOutput(input_coins)
  ];
  const {
    transaction, source_outputs, payout_result_list,
    moria_utxo: next_moria_utxo, oracle_utxo: next_oracle_utxo,
    txbin, txhash, txfee, oracle_use_fee,
  } = generateMoriaTxSub(context, moria_utxo, moria_modifier, oracle_utxo, additional_inputs, payout_rules);
  return {
    txbin, txhash, txfee, oracle_use_fee,
    moria_utxo: next_moria_utxo, oracle_utxo: next_oracle_utxo,
    payouts: payout_result_list.map((a) => payoutResultToUTXO(txhash, a)),
    redeemer_payouts: payout_result_list.filter((a) => a.payout_rule != borrower_payout_rule).map((a) => payoutResultToUTXO(txhash, a)),
    borrower_payouts: payout_result_list.filter((a) => a.payout_rule == borrower_payout_rule).map((a) => payoutResultToUTXO(txhash, a)),
    libauth_transaction: transaction,
    libauth_source_outputs: source_outputs,
  };
}

/**
 * Add collateral to an existing loan.
 * 
 *
 * @param context - The compiler's context.
 * @param loan_utxo - The current loan's utxo.
 * @param amount - The amount to increase the collateral.
 * @param loan_private_key - The private key of the current loan.
 * @param input_coins - A set of spendable coins to fund the transaction.
 * @param payout_rules - A list of payout rules.
 * @returns add collateral tx result
 *
 */
export function addCollateral (context: CompilerContext, loan_utxo: UTXOWithNFT, amount: bigint, loan_private_key: Uint8Array, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): AddCollateralTxResult {
  if (amount < 100000n) {
    throw new ValueError(`The amount to add should be greater than or equal to 100000 sats.`);
  }
  let loan_output: OutputWithNFT;
  const loan_amount = binToBigIntUintLE(loan_utxo.output.token.nft.commitment.slice(20));
  if (loan_amount <= 0n) {
    throw new ValueError('loan_amount should be greater than zero!');
  }
  const new_collateral_amount = loan_utxo.output.amount + amount;
  const payouts_info = [];
  const la_source_outputs: libauth.Output[] = [];
  const la_inputs: libauth.InputTemplate<libauth.CompilerBCH>[] = [];
  const la_outputs: libauth.OutputTemplate<libauth.CompilerBCH>[] = [];
  { // loan io#0
    const la_loan_source_output = {
      lockingBytecode: loan_utxo.output.locking_bytecode,
      valueSatoshis: loan_utxo.output.amount,
      token: {
        amount: loan_utxo.output.token.amount,
        category: convertTokenIdToUint8Array(loan_utxo.output.token.token_id),
        nft: {
          capability: loan_utxo.output.token.nft.capability,
          commitment: loan_utxo.output.token.nft.commitment,
        },
      },
    };
    la_source_outputs.push(la_loan_source_output);
    la_inputs.push({
      outpointIndex: loan_utxo.outpoint.index,
      outpointTransactionHash: loan_utxo.outpoint.txhash,
      sequenceNumber: 0,
      unlockingBytecode: {
        compiler: context.moria_compiler,
        script: 'loan_add_collateral',
        data: {
          keys: {
            privateKeys: {
              borrower_key: loan_private_key,
            },
          },
        },
        valueSatoshis: la_loan_source_output.valueSatoshis,
        token: la_loan_source_output.token,
      },
    });
    loan_output = {
      locking_bytecode: loan_utxo.output.locking_bytecode,
      amount: new_collateral_amount,
      token: {
        amount: loan_utxo.output.token.amount,
        token_id: loan_utxo.output.token.token_id,
        nft: {
          capability: loan_utxo.output.token.nft.capability,
          commitment: loan_utxo.output.token.nft.commitment,
        },
      },
    };
    la_outputs.push({
      lockingBytecode: loan_utxo.output.locking_bytecode,
      valueSatoshis: new_collateral_amount,
      token: {
        amount: loan_utxo.output.token.amount,
        category: convertTokenIdToUint8Array(loan_utxo.output.token.token_id),
        nft: {
          capability: loan_utxo.output.token.nft.capability,
          commitment: loan_utxo.output.token.nft.commitment,
        },
      },
    });
  }
  for (const { input, source_output } of convertSpendableCoinsToLAInputsWithSourceOutput(input_coins)) {
    la_inputs.push(input);
    la_source_outputs.push(source_output);
  }
  const available_payouts: Array<{ token_id: TokenId, amount: bigint }> = calcAvailablePayoutFromLASourceOutputsAndOutputs(la_source_outputs as libauth.Output<never, never>[], la_outputs as libauth.Output<never, never>[]);
  // validate token/bch amounts
  if (available_payouts.filter((a) => a.amount < 0n).length > 0) {
    throw new ValueError(`Sum of the inputs & outputs is negative for the following token(s): ${available_payouts.filter((a) => a.amount < 0n).map((a) => a.token_id).join(', ')}`);
  }
  const calcTxFeeWithOutputs = (payout_outputs: Output[]): bigint => {
    const alt_outputs = [ ...la_outputs, ...payout_outputs.map((a) => ({
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
    })) ];
    const result = libauth.generateTransaction({
      locktime: 0,
      version: 2,
      inputs: la_inputs, outputs: alt_outputs,
    });
    if (!result.success) {
      /* c8 ignore next */
      throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
    }
    return BigInt(libauth.encodeTransaction(result.transaction).length) * context.txfee_per_byte;
  };
  const { payout_outputs: payout_outputs_with_rules, txfee, token_burns } = payoutBuilder.build(makePayoutContext(context, calcTxFeeWithOutputs), available_payouts, payout_rules, true);
  const payout_outputs: Output[] = payout_outputs_with_rules.map((a) => a.output);
  if (token_burns.length > 0) {
    throw new ValueError(`Token burns not allowed.`);
  }
  for (const payout_output of payout_outputs) {
    payouts_info.push({ output: payout_output, index: la_outputs.length });
    la_outputs.push({
      lockingBytecode: payout_output.locking_bytecode,
      token: payout_output.token ? {
        amount: payout_output.token.amount,
        category: convertTokenIdToUint8Array(payout_output.token.token_id),
      } : undefined,
      valueSatoshis: payout_output.amount,
    });
  }
  const result = libauth.generateTransaction({
    locktime: 0,
    version: 2,
    inputs: la_inputs, outputs: la_outputs,
  });
  if (!result.success) {
    /* c8 ignore next */
    throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
  }
  const txbin = libauth.encodeTransaction(result.transaction);
  const txhash = libauth.hashTransactionUiOrder(txbin);
  return {
    txbin, txhash, txfee,
    payouts: payouts_info.map((a) => ({ outpoint: { txhash, index: a.index }, output: a.output })),
    loan_utxo: {
      outpoint: { txhash, index: 0 },
      output: loan_output,
    },
    libauth_transaction: result.transaction,
    libauth_source_outputs: la_source_outputs,
  };
}

/**
 * Mint a new loan to pay back another loan in order to reduce or increase the size and/or
 * add or decrease the collateral rate of the loan.
 * 
 *
 * @param context - The compiler's context.
 * @param moria_utxo - The moria's utxo.
 * @param oracle_utxo - The oracle's utxo.
 * @param next_loan_amount - the amount of the next loan
 * @param next_collateral_amount - The collateral amount for the substitute loan
 * @param current_loan_utxo - The current loan's utxo.
 * @param current_loan_private_key - The private key of the current loan.
 * @param next_loan_pkh - borrower's public key's hash160, the pkh's format is equivalent to pkh used in p2pkh.
 * @param input_coins - A set of spendable coins to fund the refinance procedure.
 * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
 * @returns refinance tx chain with details
 *
 */
export function refiLoan (context: CompilerContext, moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, next_loan_amount: bigint, next_collateral_amount: bigint, current_loan_utxo: UTXOWithNFT, current_loan_private_key: Uint8Array, next_loan_pkh: Uint8Array, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): RefinanceLoanResult {
  validateMoriaUTXO(context, moria_utxo);
  validateOracleUTXO(context, oracle_utxo);
  if (!(current_loan_utxo.output.token?.nft?.commitment instanceof Uint8Array && current_loan_utxo.output.token.nft.commitment.length > 20)) {
    throw new ValueError('current_loan_utxo has no commitment or the size of the commitment does not meet the requirement');
  }
  const current_loan_amount = binToBigIntUintLE(current_loan_utxo.output.token.nft.commitment.slice(20));
  if (current_loan_amount <= 0n) {
    throw new ValueError('loan_amount should be greater than zero!');
  }
  // use current_loan_private_key to hold the change of mintLoan
  const mint_payout_locking_bytecode = privateKeyToP2pkhLockingBytecode({ privateKey: current_loan_private_key });
  const mint_payout_rules: PayoutRule[] = [
    {
      type: PayoutAmountRuleType.CHANGE,
      locking_bytecode: mint_payout_locking_bytecode,
    },
  ];
  // only pure bch input coins is accepted when minting loans
  const mint_input_coins = input_coins.filter((a) => a.output.token == null);
  const musd_input_coins: SpendableCoin<OutputWithFT>[] = input_coins.filter((a) => a.output.token?.token_id == context.musd_token_id && a.output.token?.amount > 0n) as SpendableCoin<OutputWithFT>[];
  const repay_token_amount = musd_input_coins.reduce((a, b) => a + b.output.token.amount, 0n);
  if (!(next_loan_amount + repay_token_amount >= current_loan_amount)) {
    throw new ValueError(`next_loan_amount + input_musd_coins should be equal or greater than current_loan_amount`);
  }
  const mint_tx_result = mintLoan(context, moria_utxo, oracle_utxo, mint_input_coins, next_loan_amount, next_collateral_amount, next_loan_pkh, mint_payout_locking_bytecode, mint_payout_rules);
  const repay_input_coins: SpendableCoin<Output>[] = [ ...musd_input_coins ];
  // add mint_tx_result coins to repay_input_coins
  for (const mint_payout of mint_tx_result.payouts) {
     repay_input_coins.push({
      type: SpendableCoinType.P2PKH,
      key: current_loan_private_key,
      outpoint: mint_payout.outpoint,
      output: mint_payout.output,
    });
  }
  const repay_tx_result = repayLoan(context, mint_tx_result.moria_utxo, mint_tx_result.oracle_utxo, current_loan_utxo, current_loan_private_key, repay_input_coins, payout_rules);
  return {
    tx_result_chain: [
      mint_tx_result,
      repay_tx_result,
    ],
    txfee: mint_tx_result.txfee + repay_tx_result.txfee,
    payouts: repay_tx_result.payouts,
    moria_utxo: repay_tx_result.moria_utxo,
    oracle_utxo: repay_tx_result.oracle_utxo,
    loan_utxo: mint_tx_result.loan_utxo,
    oracle_use_fee: mint_tx_result.oracle_use_fee + repay_tx_result.oracle_use_fee,
  };
}

export function updateOracleMessage (context: CompilerContext, oracle_utxo: UTXOWithNFT, public_key: Uint8Array, message: Uint8Array, message_datasig: Uint8Array, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): TxResult  {
  const payouts_info = [];
  const la_source_outputs: libauth.Output[] = [];
  const la_inputs: libauth.InputTemplate<libauth.CompilerBCH>[] = [];
  const la_outputs: libauth.OutputTemplate<libauth.CompilerBCH>[] = [];
  { // oracle at io#1
    if (oracle_utxo.output.token == null || oracle_utxo.output.token.nft == null) {
      throw new ValueError('oracle_utxo is expected to be an nft!');
    }
    const source_output = {
      lockingBytecode: oracle_utxo.output.locking_bytecode,
      valueSatoshis: oracle_utxo.output.amount,
      token: {
        amount: oracle_utxo.output.token.amount,
        category: convertTokenIdToUint8Array(oracle_utxo.output.token.token_id),
        nft: {
          capability: oracle_utxo.output.token.nft.capability,
          commitment: oracle_utxo.output.token.nft.commitment,
        },
      },
    };
    const pkh = libauth.hash160(public_key);
    if (!uint8ArrayEqual(oracle_utxo.output.token.nft.commitment.slice(0, 20), pkh)) {
      throw new ValueError(`oracle pkh does not match.`);
    }
    la_source_outputs.push(source_output);
    la_inputs.push({
      outpointIndex: oracle_utxo.outpoint.index,
      outpointTransactionHash: oracle_utxo.outpoint.txhash,
      sequenceNumber: 0,
      unlockingBytecode: {
        compiler: context.oracle_compiler,
        script: 'oracle_update',
        data: {
          bytecode: {
            oracle_pubkey: public_key,
            oracle_message: message,
            oracle_datasig: message_datasig,
          },
        },
        valueSatoshis: source_output.valueSatoshis,
        token: source_output.token,
      },
    });
    la_outputs.push({
      // copy from input
      lockingBytecode: oracle_utxo.output.locking_bytecode,
      valueSatoshis: oracle_utxo.output.amount,
      token: {
        amount: oracle_utxo.output.token.amount,
        category: convertTokenIdToUint8Array(oracle_utxo.output.token.token_id),
        nft: {
          capability: oracle_utxo.output.token.nft.capability,
          commitment: uint8ArrayConcat([pkh, message]),
        },
      },
    });
  }
  for (const { input, source_output } of convertSpendableCoinsToLAInputsWithSourceOutput(input_coins)) {
    la_inputs.push(input);
    la_source_outputs.push(source_output);
  }
  const available_payouts: Array<{ token_id: TokenId, amount: bigint }> = calcAvailablePayoutFromLASourceOutputsAndOutputs(la_source_outputs as libauth.Output<never, never>[], la_outputs as libauth.Output<never, never>[]);
  // validate token/bch amounts
  if (available_payouts.filter((a) => a.amount < 0n).length > 0) {
    throw new ValueError(`Sum of the inputs & outputs is negative for the following token(s): ${available_payouts.filter((a) => a.amount < 0n).map((a) => a.token_id).join(', ')}`);
  }
  const calcTxFeeWithOutputs = (payout_outputs: Output[]): bigint => {
    const alt_outputs = [ ...la_outputs, ...payout_outputs.map((a) => ({
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
    })) ];
    const result = libauth.generateTransaction({
      locktime: 0,
      version: 2,
      inputs: la_inputs, outputs: alt_outputs,
    });
    if (!result.success) {
      /* c8 ignore next */
      throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
    }
    return BigInt(libauth.encodeTransaction(result.transaction).length) * context.txfee_per_byte;
  };
  const { payout_outputs: payout_outputs_with_rules, txfee, token_burns } = payoutBuilder.build(makePayoutContext(context, calcTxFeeWithOutputs), available_payouts, payout_rules, true);
  const payout_outputs: Output[] = payout_outputs_with_rules.map((a) => a.output);
  if (token_burns.length > 0) {
    throw new ValueError(`Token burns not allowed.`);
  }
  for (const payout_output of payout_outputs) {
    payouts_info.push({ output: payout_output, index: la_outputs.length });
    la_outputs.push({
      lockingBytecode: payout_output.locking_bytecode,
      token: payout_output.token ? {
        amount: payout_output.token.amount,
        category: convertTokenIdToUint8Array(payout_output.token.token_id),
      } : undefined,
      valueSatoshis: payout_output.amount,
    });
  }
  const result = libauth.generateTransaction({
    locktime: 0,
    version: 2,
    inputs: la_inputs, outputs: la_outputs,
  });
  if (!result.success) {
    /* c8 ignore next */
    throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
  }
  const txbin = libauth.encodeTransaction(result.transaction);
  const txhash = libauth.hashTransactionUiOrder(txbin);
  return {
    txbin, txhash, txfee,
    payouts: payouts_info.map((a) => ({ outpoint: { txhash, index: a.index }, output: a.output })),
    libauth_transaction: result.transaction,
    libauth_source_outputs: la_source_outputs,
  };
}

