import {
  ValueError, InvalidProgramState, BurnNFTException,
} from '@cashlab/common/exceptions.js';
import * as libauth from '@cashlab/common/libauth.js';
const {
  binToBigIntUintLE, bigIntToVmNumber, binToHex,
} = libauth;
import type { MoriaCompilerContext, MoriaTxResult, Pay2NFTHWithdrawEntry } from './types.js';
import type {
  UTXO, UTXOWithNFT, UTXOWithFT, Output, OutputWithNFT, SpendableCoin, PayoutRule, TxResult,
  InputParamsWithUnlocker,
} from '@cashlab/common/types.js';
import {
  PayoutAmountRuleType, NonFungibleTokenCapability, InputUnlockerType
} from '@cashlab/common/constants.js';
import {
  generateBytecodeWithLibauthCompiler, spendableCoinToInputWithUnlocker,
} from '@cashlab/common/util-libauth-dependent.js';
import { uint8ArrayEqual } from '@cashlab/common/util.js';
import {
  priceFromDelphiCommitment, timestampFromDelphiCommitment, dataSequenceFromDelphiCommitment,
  useFeeFromDelphiCommitment, createDelphiCommitment,
  principalFromLoanCommitment,
  outputNFTHash,
  generateMoriaTxSub, generateTransactionWithConstraintsAndPayoutRuleExcludingTxFee,
  GenerateMoriaModifiers, OutputConstraint,
} from './util.js';

const validateLoanSanity = (delphi_utxo: UTXOWithNFT, params: { loan_amount: bigint, collateral_amount: bigint }): void => {
  const delphi_price = priceFromDelphiCommitment(delphi_utxo.output.token.nft.commitment);
  if (!(delphi_price > 0)) {
    throw new ValueError('oracle price should be greater than zero');
  }
  const calcMaxLoan = (a: bigint): bigint => (((a * 2n) / 3n) * delphi_price) / 100000000n;
  if (params.loan_amount > calcMaxLoan(params.collateral_amount)) {
    throw new ValueError('collateral amount should at least be worth 150% of the loan amount.');
  }
};

export function mintLoanWithBatonMinter (context: MoriaCompilerContext, utxos: { moria: UTXOWithNFT, delphi: UTXOWithNFT, batonminter: UTXOWithNFT }, params: { loan_amount: bigint, collateral_amount: bigint, annual_interest_bp: bigint }, funding_coins: SpendableCoin[], loan_agent_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): MoriaTxResult & { loan_utxo: UTXOWithNFT, batonminter_utxo: UTXOWithNFT, loan_agent_utxo: UTXOWithNFT } {
  validateLoanSanity(utxos.delphi, params);
  const moria_modifiers: GenerateMoriaModifiers = {
    script: 'moria_borrow',
    difference: params.loan_amount,
    loan_params: {
      collateral_amount: params.collateral_amount,
      annual_interest_bp: params.annual_interest_bp,
    },
    loan_agent: {
      output: {
        locking_bytecode: loan_agent_locking_bytecode,
      },
      batonminter_utxo: utxos.batonminter,
      batonminter_nft_capability: NonFungibleTokenCapability.none,
    },
  };
  const result: MoriaTxResult = generateMoriaTxSub(context, utxos.moria, moria_modifiers, utxos.delphi, funding_coins, payout_rules);
  if (result.loan_utxo == null) {
    throw new Error();
  }
  if (result.loan_utxo == null || result.batonminter_utxo == null || result.loan_agent_utxo == null) {
    /* c8 ignore next */
    throw new InvalidProgramState(`result.loan_utxo == null || result.batonminter_utxo == null || result.loan_agent_utxo == null`);
  }
  return result as ReturnType<typeof mintLoanWithBatonMinter>;
}

export function mintLoanWithExistingLoanAgent (context: MoriaCompilerContext, utxos: { moria: UTXOWithNFT, delphi: UTXOWithNFT }, params: { loan_amount: bigint, collateral_amount: bigint, annual_interest_bp: bigint }, funding_coins: SpendableCoin[], loan_agent_coin: SpendableCoin<OutputWithNFT>, output_loan_agent_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): MoriaTxResult & { loan_utxo: UTXOWithNFT, loan_agent_utxo: UTXOWithNFT } {
  validateLoanSanity(utxos.delphi, params);
  const moria_modifiers: GenerateMoriaModifiers = {
    script: 'moria_borrow',
    difference: params.loan_amount,
    loan_params: {
      collateral_amount: params.collateral_amount,
      annual_interest_bp: params.annual_interest_bp,
    },
    loan_agent: {
      coin: loan_agent_coin,
      output: {
        locking_bytecode: output_loan_agent_locking_bytecode,
      },
    },
  };
  const result: MoriaTxResult = generateMoriaTxSub(context, utxos.moria, moria_modifiers, utxos.delphi, funding_coins, payout_rules);
  if (result.loan_utxo == null) {
    throw new Error();
  }
  if (result.loan_utxo == null) {
    /* c8 ignore next */
    throw new InvalidProgramState(`result.loan_utxo == null`);
  }
  return result as ReturnType<typeof mintLoanWithExistingLoanAgent>;
}

export function refiLoan (context: MoriaCompilerContext, utxos: { moria: UTXOWithNFT, delphi: UTXOWithNFT, loan: UTXOWithNFT }, refi_params: { loan_amount: bigint, collateral_amount: bigint, annual_interest_bp: bigint }, loan_agent_coin: SpendableCoin<OutputWithNFT>, funding_coins: SpendableCoin[], output_loan_agent_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): MoriaTxResult & { loan_utxo: UTXOWithNFT, interest_utxo: UTXOWithFT, loan_agent_utxo: UTXOWithNFT } {
  validateLoanSanity(utxos.delphi, refi_params);
  const input_loan_principal: bigint = principalFromLoanCommitment(utxos.loan.output.token.nft.commitment);
  const moria_modifiers: GenerateMoriaModifiers = {
    script: 'moria_refinance_loan',
    difference: refi_params.loan_amount - input_loan_principal,
    input_loan_utxo: utxos.loan,
    loan_params: {
      collateral_amount: refi_params.collateral_amount,
      annual_interest_bp: refi_params.annual_interest_bp,
    },
    loan_agent: {
      coin: loan_agent_coin,
      output: {
        locking_bytecode: output_loan_agent_locking_bytecode,
      },
    },
  };
  const result: MoriaTxResult = generateMoriaTxSub(context, utxos.moria, moria_modifiers, utxos.delphi, funding_coins, payout_rules);
  if (result.loan_utxo == null || result.interest_utxo == null || result.loan_agent_utxo == null) {
    /* c8 ignore next */
    throw new InvalidProgramState(`result.loan_utxo == null || result.interest_utxo == null || result.loan_agent_utxo == null`);
  }
  return result as ReturnType<typeof refiLoan>;
}

export function repayLoan (context: MoriaCompilerContext, utxos: { moria: UTXOWithNFT, delphi: UTXOWithNFT, loan: UTXOWithNFT }, loan_agent_coin: SpendableCoin<OutputWithNFT>, funding_coins: SpendableCoin[], output_loan_agent_locking_bytecode: Uint8Array | BurnNFTException, payout_rules: PayoutRule[]): MoriaTxResult & { interest_utxo: UTXOWithFT } {
  let loan_agent_output;
  if (output_loan_agent_locking_bytecode instanceof BurnNFTException) {
    loan_agent_output = undefined;
  } else if (output_loan_agent_locking_bytecode instanceof Uint8Array) {
    loan_agent_output = {
      locking_bytecode: output_loan_agent_locking_bytecode,
    };
  } else {
    throw new ValueError(`Input parameter output_loan_agent_locking_bytecode should either be of type Uint8Array or BurnNFTException, If the intend is to burn the loan agent nft.`)
  }
  const input_loan_principal: bigint = principalFromLoanCommitment(utxos.loan.output.token.nft.commitment);
  const moria_modifiers: GenerateMoriaModifiers = {
    script: 'moria_repay_loan',
    difference: -1n * input_loan_principal,
    input_loan_utxo: utxos.loan,
    loan_agent: {
      coin: loan_agent_coin,
      output: loan_agent_output,
    },
  };
  const result: MoriaTxResult = generateMoriaTxSub(context, utxos.moria, moria_modifiers, utxos.delphi, funding_coins, payout_rules);
  if (result.interest_utxo == null) {
    /* c8 ignore next */
    throw new InvalidProgramState(`result.interest_utxo == null`);
  }
  return result as ReturnType<typeof repayLoan>;
}

export function liquidateLoan (context: MoriaCompilerContext, utxos: { moria: UTXOWithNFT, delphi: UTXOWithNFT, loan: UTXOWithNFT }, funding_coins: SpendableCoin[], payout_rules: PayoutRule[]): MoriaTxResult & { interest_utxo: UTXOWithFT } {
  const input_loan_principal: bigint = principalFromLoanCommitment(utxos.loan.output.token.nft.commitment);
  const moria_modifiers: GenerateMoriaModifiers = {
    script: 'moria_repay_loan',
    difference: -1n * input_loan_principal,
    input_loan_utxo: utxos.loan,
  };
  const result: MoriaTxResult = generateMoriaTxSub(context, utxos.moria, moria_modifiers, utxos.delphi, funding_coins, payout_rules);
  if (result.interest_utxo == null) {
    /* c8 ignore next */
    throw new InvalidProgramState(`result.interest_utxo == null`);
  }
  return result as ReturnType<typeof liquidateLoan>;
}

export function redeemLoan (context: MoriaCompilerContext, utxos: { moria: UTXOWithNFT, delphi: UTXOWithNFT, loan: UTXOWithNFT, bporacle: UTXOWithNFT }, funding_coins: SpendableCoin[], payout_rules: PayoutRule[]): MoriaTxResult & { interest_utxo: UTXOWithNFT, bporacle_utxo: UTXOWithNFT, borrower_p2nfth_utxo: UTXO } {
  const input_loan_principal: bigint = principalFromLoanCommitment(utxos.loan.output.token.nft.commitment);
  const moria_modifiers: GenerateMoriaModifiers = {
    script: 'moria_repay_loan',
    difference: -1n * input_loan_principal,
    input_loan_utxo: utxos.loan,
    redeem_params: {
      bporacle_utxo: utxos.bporacle,
    },
  };
  const result: MoriaTxResult = generateMoriaTxSub(context, utxos.moria, moria_modifiers, utxos.delphi, funding_coins, payout_rules);
  if (result.interest_utxo == null || result.bporacle_utxo == null || result.borrower_p2nfth_utxo == null) {
    /* c8 ignore next */
    throw new InvalidProgramState(`result.interest_utxo == null || bporacle_utxo == null || result.borrower_p2nfth_utxo == null`);
  }
  return result as ReturnType<typeof redeemLoan>;
}

export function updateMoriaSequence (context: MoriaCompilerContext, utxos: { moria: UTXOWithNFT, delphi: UTXOWithNFT }, funding_coin: SpendableCoin, change_locking_bytecode: Uint8Array): MoriaTxResult {
  const moria_modifiers: GenerateMoriaModifiers = {
    script: 'moria_update',
    difference: 0n,
  };
  return generateMoriaTxSub(context, utxos.moria, moria_modifiers, utxos.delphi, [funding_coin], [ {
    type: PayoutAmountRuleType.CHANGE,
    locking_bytecode: change_locking_bytecode,
  } ]);
}

export function loanAddCollateral (context: MoriaCompilerContext, loan_utxo: UTXOWithNFT, loan_agent_coin: SpendableCoin<OutputWithNFT>, funding_coins: SpendableCoin[], additional_collateral_amount: bigint, output_loan_agent_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): TxResult & { loan_utxo: UTXOWithNFT, loan_agent_utxo: UTXOWithNFT } {
  const output_constraint_list: OutputConstraint[] = [];
  const inputs: InputParamsWithUnlocker[] = [];
  if (additional_collateral_amount < 100000n) {
    throw new ValueError(`additional_collateral_amount should be at least 100,000 sats`);
  }
  // loan agent at io#0
  inputs.push(spendableCoinToInputWithUnlocker(loan_agent_coin, { sequence_number: 0 }));
  const loan_agent_output = {
    locking_bytecode: output_loan_agent_locking_bytecode,
    amount: loan_agent_coin.output.amount,
    token: structuredClone(loan_agent_coin.output.token),
  };
  output_constraint_list.push({
    type: 'PREDEFINED',
    output: loan_agent_output,
  });
  // loan at io#1
  inputs.push({
    unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
    sequence_number: 0, utxo: loan_utxo,
    getUnlockBytecodeCompilationDirective () {
      return {
        compiler: context.moria_compiler,
        script: 'loan_add_collateral',
      };
    },
  });
  const loan_output = {
    locking_bytecode: loan_utxo.output.locking_bytecode,
    amount: loan_utxo.output.amount + additional_collateral_amount,
    token: structuredClone(loan_utxo.output.token),
  };
  output_constraint_list.push({
    type: 'PREDEFINED',
    output: loan_output,
  });
  // add funding & build payouts
  if (funding_coins.filter((a) => a.output.token?.nft != null).length > 0) {
    throw new ValueError(`funding_coins should not contain nfts!`);
  }
  for (const funding_coin of funding_coins) {
    inputs.push(spendableCoinToInputWithUnlocker(funding_coin, { sequence_number: 0 }));
  }
  const result = generateTransactionWithConstraintsAndPayoutRuleExcludingTxFee(context, inputs, output_constraint_list, payout_rules, { strict_constraints: false });
  const txbin = libauth.encodeTransaction(result.libauth_transaction);
  const txhash = libauth.hashTransactionUiOrder(txbin);
  return {
    loan_agent_utxo: {
      outpoint: { txhash, index: 0 },
      output: loan_agent_output,
    },
    loan_utxo: {
      outpoint: { txhash, index: 1 },
      output: loan_output,
    },
    txbin, txhash, txfee: result.txfee,
    payouts: (result.outputs
      .map((a, i) => ({ index: i, output: result.payout_outputs.findIndex((b) => b.output == a) != -1 ? a : null }))
      .filter((a) => a.output != null) as Array<{ index: number, output: Output }>)
      .map((a) => ({ outpoint: { txhash, index: a.index }, output: a.output })),
    libauth_transaction: result.libauth_transaction,
    libauth_source_outputs: result.libauth_source_outputs,
  };
}

export function updateDelphiCommitmentWithGPUpdater (context: MoriaCompilerContext, utxos: { delphi: UTXOWithNFT, delphi_gp_updater: UTXOWithNFT }, message: Uint8Array, sig: Uint8Array, funding_coins: SpendableCoin[], payout_rules: PayoutRule[]): TxResult & { delphi_utxo: UTXOWithNFT, delphi_gp_updater_utxo: UTXOWithNFT } {
  const gp_timestamp = binToBigIntUintLE(message.slice(0, 4));
  const gp_seq = binToBigIntUintLE(message.slice(8, 12));
  const gp_price = binToBigIntUintLE(message.slice(12, 16));
  if (gp_timestamp <= timestampFromDelphiCommitment(utxos.delphi.output.token.nft.commitment)) {
    throw new ValueError(`gp_timestamp should be greater than delphi timestamp.`);
  }
  if (gp_seq <= dataSequenceFromDelphiCommitment(utxos.delphi.output.token.nft.commitment)) {
    throw new ValueError(`gp_seq should be greater than delphi data sequence.`);
  }
  const output_constraint_list: OutputConstraint[] = [];
  const inputs: InputParamsWithUnlocker[] = [];
  const new_delphi_commitment = createDelphiCommitment({
    timestamp: gp_timestamp,
    use_fee: useFeeFromDelphiCommitment(utxos.delphi.output.token.nft.commitment),
    sequence: gp_seq,
    price: gp_price
  });
  // delphi_gp_updater at io#0
  inputs.push({
    unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
    sequence_number: 0, utxo: utxos.delphi_gp_updater,
    getUnlockBytecodeCompilationDirective () {
      return {
        compiler: context.delphi_gp_updater_compiler,
        script: 'update',
        data: {
          bytecode: {
            oracle_message: message,
            oracle_datasig: sig,
          },
        },
      };
    },
  });
  const delphi_gp_updater_output = {
    locking_bytecode: utxos.delphi_gp_updater.output.locking_bytecode,
    amount: utxos.delphi_gp_updater.output.amount,
    token: structuredClone(utxos.delphi_gp_updater.output.token),
  };
  output_constraint_list.push({
    type: 'PREDEFINED',
    output: delphi_gp_updater_output,
  });
  // delphi at io#1
  inputs.push({
    unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
    sequence_number: 0, utxo: utxos.delphi,
    getUnlockBytecodeCompilationDirective () {
      return {
        compiler: context.delphi_compiler,
        script: 'update',
      };
    },
  });
  const delphi_output = {
    locking_bytecode: utxos.delphi.output.locking_bytecode,
    amount: utxos.delphi.output.amount,
    token: {
      token_id: utxos.delphi.output.token.token_id,
      amount: utxos.delphi.output.token.amount,
      nft: {
        commitment: new_delphi_commitment,
        capability: utxos.delphi.output.token.nft.capability,
      },
    },
  };
  output_constraint_list.push({
    type: 'PREDEFINED',
    output: delphi_output,
  });
  // add funding & build payouts
  if (funding_coins.filter((a) => a.output.token?.nft != null).length > 0) {
    throw new ValueError(`funding_coins should not contain nfts!`);
  }
  for (const funding_coin of funding_coins) {
    inputs.push(spendableCoinToInputWithUnlocker(funding_coin, { sequence_number: 0 }));
  }
  const result = generateTransactionWithConstraintsAndPayoutRuleExcludingTxFee(context, inputs, output_constraint_list, payout_rules, { strict_constraints: false });
  const txbin = libauth.encodeTransaction(result.libauth_transaction);
  const txhash = libauth.hashTransactionUiOrder(txbin);
  return {
    delphi_gp_updater_utxo: {
      outpoint: { txhash, index: 0 },
      output: delphi_gp_updater_output,
    },
    delphi_utxo: {
      outpoint: { txhash, index: 1 },
      output: delphi_output,
    },
    txbin, txhash, txfee: result.txfee,
    payouts: (result.outputs
      .map((a, i) => ({ index: i, output: result.payout_outputs.findIndex((b) => b.output == a) != -1 ? a : null }))
      .filter((a) => a.output != null) as Array<{ index: number, output: Output }>)
      .map((a) => ({ outpoint: { txhash, index: a.index }, output: a.output })),
    libauth_transaction: result.libauth_transaction,
    libauth_source_outputs: result.libauth_source_outputs,
  };
}

export function buildP2NFTHInputsWithUnlocker (context: MoriaCompilerContext, nft_input_index: number, next_input_index: number, entry: Pay2NFTHWithdrawEntry): { inputs: InputParamsWithUnlocker[], nfts: UTXOWithNFT[], next_input_index: number } {
  const inputs: InputParamsWithUnlocker[] = [];
  const nfts: UTXOWithNFT[] = [];
  if (entry.utxo.output.token != null && entry.utxo.output.token.nft != null) {
    nfts.push(entry.utxo as UTXOWithNFT);
  }
  if (entry.subentries != null && entry.subentries.length > 0) {
    if (entry.utxo.output.token == null || entry.utxo.output.token.nft == null) {
      throw new ValueError(`Expecting the entry's utxo with subentries to a nft.`);
    }
    const nfthash = outputNFTHash(entry.utxo.output as OutputWithNFT);
    const p2nfth_locking_bytecode = generateBytecodeWithLibauthCompiler(context.p2nfth_compiler, {
        data: { bytecode: { nfthash: nfthash } },
        scriptId: '__main__',
    });
    for (const subentry of entry.subentries) {
      if (!uint8ArrayEqual(p2nfth_locking_bytecode, subentry.utxo.output.locking_bytecode)) {
        throw new ValueError(`The locking bytecode of a provided p2nfth_utxo is invalid, outpoint: ${binToHex(subentry.utxo.outpoint.txhash)}:${subentry.utxo.outpoint.index} , Expecting it to be p2nfth of: ${nfthash}`);
      }
      inputs.push({
        unlocker_type: InputUnlockerType.LIBAUTH_UNLOCKER,
        sequence_number: 0, utxo: subentry.utxo,
        getUnlockBytecodeCompilationDirective () {
          return {
            compiler: context.p2nfth_compiler,
            script: 'unlock',
            data: {
              bytecode: {
                nfthash,
                nft_index: bigIntToVmNumber(BigInt(nft_input_index)),
              },
            },
          };
        },
      });
      const entry_input_index = next_input_index;
      next_input_index += 1;
      const result = buildP2NFTHInputsWithUnlocker(context, entry_input_index, next_input_index, subentry);
      next_input_index = result.next_input_index;
      for (const sub_input of result.inputs) {
        inputs.push(sub_input);
      }
      for (const sub_nft of result.nfts) {
        nfts.push(sub_nft);
      }
    }
  }
  return { inputs, nfts, next_input_index };
}

export function withdrawPay2NFTHCoins (context: MoriaCompilerContext, nft_coin: SpendableCoin<OutputWithNFT>, entries: Pay2NFTHWithdrawEntry[], funding_coins: SpendableCoin[], payout_rules: PayoutRule[], { createNFTOutput }: { createNFTOutput: (utxo: UTXOWithNFT) => OutputWithNFT }): TxResult & { nft_utxos: UTXOWithNFT[] } {
  if (funding_coins.filter((a) => a.output.token != null).length > 0) {
    throw new ValueError(`Only pure bch funding coins are allowed!`);
  }
  const inputs: InputParamsWithUnlocker[] = [];
  const output_constraint_list: OutputConstraint[] = [];
  inputs.push(spendableCoinToInputWithUnlocker(nft_coin, { sequence_number: 0 }));
  const result = buildP2NFTHInputsWithUnlocker(context, 0, 1, { utxo: { outpoint: nft_coin.outpoint, output: nft_coin.output }, subentries: entries });
  for (const sub_input of result.inputs) {
    inputs.push(sub_input);
  }
  // add funding coins
  for (const funding_coin of funding_coins) {
    inputs.push(spendableCoinToInputWithUnlocker(funding_coin, { sequence_number: 0 }));
  }
  // add output nfts
  const nft_outputs: Array<{ output: OutputWithNFT, index: number }> = [];
  for (const nft_utxo of result.nfts) {
    try {
      const output = createNFTOutput(nft_utxo);
      nft_outputs.push({ output, index: output_constraint_list.length });
      output_constraint_list.push({
        type: 'PREDEFINED',
        output,
      });
    } catch (exc) {
      if (!(exc instanceof BurnNFTException)) {
        throw exc;
      }
    }
  }
  const stxresult = generateTransactionWithConstraintsAndPayoutRuleExcludingTxFee(context, inputs, output_constraint_list, payout_rules, { strict_constraints: false });
  const txbin = libauth.encodeTransaction(stxresult.libauth_transaction);
  const txhash = libauth.hashTransactionUiOrder(txbin);
  return {
    txbin, txhash, txfee: stxresult.txfee,
    nft_utxos: nft_outputs
      .map((a) => ({ outpoint: { txhash, index: a.index }, output: a.output })),
    payouts: (stxresult.outputs
      .map((a, i) => ({ index: i, output: stxresult.payout_outputs.findIndex((b) => b.output == a) != -1 ? a : null }))
      .filter((a) => a.output != null) as Array<{ index: number, output: Output }>)
      .map((a) => ({ outpoint: { txhash, index: a.index }, output: a.output })),
    libauth_transaction: stxresult.libauth_transaction,
    libauth_source_outputs: stxresult.libauth_source_outputs,
  };
}
