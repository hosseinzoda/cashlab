import test from 'ava';

import { SpendableCoin, OutputWithNFT, UTXOWithNFT } from '@cashlab/common/types.js';
import { SpendableCoinType, NATIVE_BCH_TOKEN_ID } from '@cashlab/common/constants.js';

import * as sb from './fixtures/solo-borrower.js';
import {
  MORIA_UTXO, DELPHI_UTXO, BPORACLE_UTXO, BATONMINTER_UTXO,
} from './fixtures/moria.js';

import { uint8ArrayEqual, calcAvailablePayoutFromIO } from '@cashlab/common/util.js';
import { createMoriaMUSDV1CompilerContext, createMoriaMutationContext, MoriaMutator, verifyTxResult } from '../moria.js';

test('moria-v1-add-collateral', (t) => {
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

  const loan_amount = 10000n;
  const collateral_amount = 37000000n;

  let funding_coins = sb.PURE_BCH_INPUT_COINS;
  let loan_agent_coin: SpendableCoin<OutputWithNFT>;
  let loan_utxo: UTXOWithNFT;

  { // mint a loan
    const result = moria_mutator.mintLoanWithBatonMinter({ loan_amount, collateral_amount, annual_interest_bp: 100n }, funding_coins, loan_agent_locking_bytecode, payout_rules);
    loan_utxo = result.loan_utxo;
    loan_agent_coin = {
      type: SpendableCoinType.P2PKH,
      key: sb.PRIVATE_KEY,
      ...result.loan_agent_utxo,
    };
    funding_coins = result.payouts
      .map((utxo) => ({
        type: SpendableCoinType.P2PKH as SpendableCoinType.P2PKH,
        key: sb.PRIVATE_KEY,
        ...utxo,
      }));
  }

  const additional_collateral_amount = 1000000n;
  const result = moria_mutator.loanAddCollateral(loan_utxo, loan_agent_coin, funding_coins, additional_collateral_amount, loan_agent_locking_bytecode, payout_rules);
  const available_payouts = calcAvailablePayoutFromIO(result.payouts.map((utxo) => ({ utxo })), []);
  t.is(available_payouts.length, 2);
  const bch_payout = (available_payouts.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID) as { amount: bigint }).amount;
  const token_payout = (available_payouts.find((a) => a.token_id == compiler_context.moria_token_id) as { amount: bigint }).amount;
  t.is(token_payout, loan_amount);
  t.is(bch_payout + result.txfee + additional_collateral_amount, funding_coins.reduce((a, b) => a + b.output.amount, 0n));
  t.is(result.payouts.filter((a) => uint8ArrayEqual(sb.P2PKH_LOCKING_BYTECODE, a.output.locking_bytecode)).length, result.payouts.length);
  t.is(result.loan_utxo.output.amount, collateral_amount + additional_collateral_amount);
  verifyTxResult(result);
});





