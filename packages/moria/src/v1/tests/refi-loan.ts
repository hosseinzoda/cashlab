import test from 'ava';

import { SpendableCoin, UTXOWithNFT, OutputWithNFT } from '@cashlab/common/types.js';
import { SpendableCoinType } from '@cashlab/common/constants.js';

import * as sb from './fixtures/solo-borrower.js';
import {
  MORIA_UTXO, DELPHI_UTXO, BPORACLE_UTXO, BATONMINTER_UTXO,
} from './fixtures/moria.js';
import { validateCreatedLoan, validateMoriaTxPayouts } from './fixtures/helpers.js';

import {
  timestampFromDelphiCommitment,
  principalFromLoanCommitment, timestampFromLoanCommitment, annualInterestBPFromLoanCommitment,
  calcInterestOwed,
} from '../util.js';
import { createMoriaMUSDV1CompilerContext, createMoriaMutationContext, MoriaMutator, verifyTxResult } from '../moria.js';

test('moria-v1-refi-loan', (t) => {
  const compiler_context = createMoriaMUSDV1CompilerContext({
    txfee_per_byte: { numerator: 1n, denominator: 1n },
  });
  const moria_mutator = new MoriaMutator(createMoriaMutationContext(compiler_context, {
    moria: MORIA_UTXO,
    delphi: DELPHI_UTXO,
    bporacle: BPORACLE_UTXO,
    batonminter: BATONMINTER_UTXO,
  }));
  const loan_agent_locking_bytecode = sb.P2PKH_LOCKING_BYTECODE;
  const payout_rules = [ sb.CHANGE_PAYOUT_RULE ];

  const loan_amount = 5000n;
  const collateral_amount = 25000000n;
  const annual_interest_bp = 100n;

  let funding_coins = sb.PURE_BCH_INPUT_COINS;
  let loan_utxo: UTXOWithNFT;
  let loan_agent_coin: SpendableCoin<OutputWithNFT>;

  { // mint a loan
    const mint_result = moria_mutator.mintLoanWithBatonMinter({ loan_amount, collateral_amount, annual_interest_bp }, funding_coins, loan_agent_locking_bytecode, payout_rules);
    loan_utxo = mint_result.loan_utxo;
    loan_agent_coin = {
      type: SpendableCoinType.P2PKH,
      key: sb.PRIVATE_KEY,
      ...mint_result.loan_agent_utxo,
    };
    funding_coins = mint_result.payouts
      .map((utxo) => ({
        type: SpendableCoinType.P2PKH as SpendableCoinType.P2PKH,
        key: sb.PRIVATE_KEY,
        ...utxo,
      }));
  }

  const interest_owed = calcInterestOwed(
    principalFromLoanCommitment(loan_utxo.output.token.nft.commitment),
    annualInterestBPFromLoanCommitment(loan_utxo.output.token.nft.commitment),
    timestampFromDelphiCommitment(DELPHI_UTXO.output.token.nft.commitment),
    timestampFromLoanCommitment(loan_utxo.output.token.nft.commitment)
  );

  const refi_params = {
    loan_amount: 5100n,
    collateral_amount: 20000000n,
    annual_interest_bp: 0n,
  };

  const result = moria_mutator.refiLoan(loan_utxo, refi_params, loan_agent_coin, funding_coins, loan_agent_locking_bytecode, payout_rules);

  validateCreatedLoan(t, refi_params, result.delphi_utxo, result.loan_utxo, result.loan_agent_utxo, loan_agent_locking_bytecode);

  validateMoriaTxPayouts(t, compiler_context.moria_token_id, {
    bch_diff: collateral_amount - refi_params.collateral_amount,
    token_diff: refi_params.loan_amount - loan_amount - interest_owed,
  }, loan_agent_coin, result, funding_coins, sb.P2PKH_LOCKING_BYTECODE);

  // verify the validity of the transaction
  verifyTxResult(result);

});

test('moria-v1-refi-loan-reduce-size', (t) => {
  const compiler_context = createMoriaMUSDV1CompilerContext({
    txfee_per_byte: { numerator: 1n, denominator: 1n },
  });
  const moria_mutator = new MoriaMutator(createMoriaMutationContext(compiler_context, {
    moria: MORIA_UTXO,
    delphi: DELPHI_UTXO,
    bporacle: BPORACLE_UTXO,
    batonminter: BATONMINTER_UTXO,
  }));
  const loan_agent_locking_bytecode = sb.P2PKH_LOCKING_BYTECODE;
  const payout_rules = [ sb.CHANGE_PAYOUT_RULE ];

  const loan_amount = 5000n;
  const collateral_amount = 25000000n;
  const annual_interest_bp = 100n;

  let funding_coins = sb.PURE_BCH_INPUT_COINS;
  let loan_utxo: UTXOWithNFT;
  let loan_agent_coin: SpendableCoin<OutputWithNFT>;

  { // mint a loan
    const mint_result = moria_mutator.mintLoanWithBatonMinter({ loan_amount, collateral_amount, annual_interest_bp }, funding_coins, loan_agent_locking_bytecode, payout_rules);
    loan_utxo = mint_result.loan_utxo;
    loan_agent_coin = {
      type: SpendableCoinType.P2PKH,
      key: sb.PRIVATE_KEY,
      ...mint_result.loan_agent_utxo,
    };
    funding_coins = mint_result.payouts
      .map((utxo) => ({
        type: SpendableCoinType.P2PKH as SpendableCoinType.P2PKH,
        key: sb.PRIVATE_KEY,
        ...utxo,
      }));
  }

  const interest_owed = calcInterestOwed(
    principalFromLoanCommitment(loan_utxo.output.token.nft.commitment),
    annualInterestBPFromLoanCommitment(loan_utxo.output.token.nft.commitment),
    timestampFromDelphiCommitment(DELPHI_UTXO.output.token.nft.commitment),
    timestampFromLoanCommitment(loan_utxo.output.token.nft.commitment)
  );

  const refi_params = {
    loan_amount: 4000n,
    collateral_amount: 25000000n,
    annual_interest_bp: 0n,
  };

  const result = moria_mutator.refiLoan(loan_utxo, refi_params, loan_agent_coin, funding_coins, loan_agent_locking_bytecode, payout_rules);

  validateCreatedLoan(t, refi_params, result.delphi_utxo, result.loan_utxo, result.loan_agent_utxo, loan_agent_locking_bytecode);

  validateMoriaTxPayouts(t, compiler_context.moria_token_id, {
    bch_diff: collateral_amount - refi_params.collateral_amount,
    token_diff: refi_params.loan_amount - loan_amount - interest_owed,
  }, loan_agent_coin, result, funding_coins, sb.P2PKH_LOCKING_BYTECODE);

  // verify the validity of the transaction
  verifyTxResult(result);

});



