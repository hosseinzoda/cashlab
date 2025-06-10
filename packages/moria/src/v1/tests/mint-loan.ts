import test from 'ava';

import { SpendableCoinType } from '@cashlab/common/constants.js';
import { hexToBin }  from '@cashlab/common/libauth.js';

import * as sb from './fixtures/solo-borrower.js';
import { MORIA_UTXO, DELPHI_UTXO, BATONMINTER_UTXO } from './fixtures/moria.js';
import { validateCreatedLoan, validateMoriaTxPayouts } from './fixtures/helpers.js';

import { uint8ArrayEqual } from '@cashlab/common/util.js';
import { mintLoanWithBatonMinter, mintLoanWithExistingLoanAgent } from '../compiler.js';
import {
  loanAgentNFTHashFromLoanCommitment, outputNFTHash,
} from '../util.js';
import { createMoriaMUSDV1CompilerContext, verifyTxResult } from '../moria.js';

test('moria-v1-mint-loan', (t) => {
  const batonminter_utxo = {
    outpoint: BATONMINTER_UTXO.outpoint,
    output: {
      locking_bytecode: BATONMINTER_UTXO.output.locking_bytecode,
      amount: BATONMINTER_UTXO.output.amount,
      token: {
        token_id: BATONMINTER_UTXO.output.token.token_id,
        amount: BATONMINTER_UTXO.output.token.amount,
        nft: {
          capability: BATONMINTER_UTXO.output.token.nft.capability,
          commitment: hexToBin('0c01'),
        },
      },
    },
  };

  const compiler_context = createMoriaMUSDV1CompilerContext({
    txfee_per_byte: { numerator: 1n, denominator: 1n },
  });
  const mint0_params = {
    loan_amount: 50000n,
    collateral_amount: 250000000n,
    annual_interest_bp: 0n,
  };
  const mint0_funding_coins = sb.PURE_BCH_INPUT_COINS;
  const loan_agent_locking_bytecode = sb.P2PKH_LOCKING_BYTECODE;
  const payout_rules = [ sb.CHANGE_PAYOUT_RULE ]
  const expected_loan_nfthash = hexToBin('ca2c6ac00c4c4249c2ca65eaf2804eecc4a21f1b814477ea466493531ea3c007');


  const result0 = mintLoanWithBatonMinter(compiler_context, { moria: MORIA_UTXO, delphi: DELPHI_UTXO, batonminter: batonminter_utxo }, mint0_params, mint0_funding_coins, loan_agent_locking_bytecode, payout_rules);
  // loan_nfthash should match (with a predefined value?)
  t.assert(uint8ArrayEqual(expected_loan_nfthash, loanAgentNFTHashFromLoanCommitment(result0.loan_utxo.output.token.nft.commitment)), 'unexpected loan nfthash!');
  validateCreatedLoan(t, mint0_params, DELPHI_UTXO, result0.loan_utxo, result0.loan_agent_utxo, loan_agent_locking_bytecode);
  validateMoriaTxPayouts(t, compiler_context.moria_token_id, { bch_diff: -1n * mint0_params.collateral_amount, token_diff: mint0_params.loan_amount }, null, result0, mint0_funding_coins, sb.CHANGE_PAYOUT_RULE.locking_bytecode);
  // verify the validity of the transaction
  verifyTxResult(result0);

  const loan_agent_nfthash = outputNFTHash(result0.loan_agent_utxo.output);
  const mint1_funding_coins = result0.payouts.filter((a) => a.output.token == null)
    .map((utxo) => ({
      type: SpendableCoinType.P2PKH as SpendableCoinType.P2PKH,
      key: sb.PRIVATE_KEY,
      ...utxo,
    }));
  const mint1_params = {
    loan_amount: 2500n,
    collateral_amount: 12500000n,
    annual_interest_bp: 100n,
  };
  // mint another loan with the result0's loan agent nft
  const result1 = mintLoanWithExistingLoanAgent(compiler_context, { moria: result0.moria_utxo, delphi: result0.delphi_utxo }, mint1_params, mint1_funding_coins, loan_agent_nfthash, payout_rules)
  // loan_nfthash should match (with a predefined value?)
  t.assert(uint8ArrayEqual(expected_loan_nfthash, loanAgentNFTHashFromLoanCommitment(result1.loan_utxo.output.token.nft.commitment)), 'unexpected loan nfthash!');
  validateCreatedLoan(t, mint1_params, result1.delphi_utxo, result1.loan_utxo, result0.loan_agent_utxo, loan_agent_locking_bytecode);
  validateMoriaTxPayouts(t, compiler_context.moria_token_id, { bch_diff: -1n * mint1_params.collateral_amount, token_diff: mint1_params.loan_amount }, null, result1, mint1_funding_coins, sb.CHANGE_PAYOUT_RULE.locking_bytecode);
  // verify the validity of the transaction
  verifyTxResult(result1);
});


