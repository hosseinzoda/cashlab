import test from 'ava';

import { SpendableCoin, UTXOWithNFT } from '@cashlab/common/types.js';
import { SpendableCoinType } from '@cashlab/common/constants.js';

import * as sb from './fixtures/solo-borrower.js';
import {
  MORIA_UTXO, DELPHI_UTXO, BPORACLE_UTXO, BATONMINTER_UTXO, DELPHI_UTXO_LOW_PRICE,
} from './fixtures/moria.js';
import { validateMoriaTxPayouts } from './fixtures/helpers.js';

import {
  timestampFromDelphiCommitment,
  principalFromLoanCommitment, timestampFromLoanCommitment, annualInterestBPFromLoanCommitment,
  calcInterestOwed,
} from '../util.js';
import { createMoriaMUSDV1CompilerContext, createMoriaMutationContext, MoriaMutator, verifyTxResult } from '../moria.js';

test('moria-v1-liquidate-loan', (t) => {
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

  let funding_coins = sb.PURE_BCH_INPUT_COINS;
  let loan_utxo: UTXOWithNFT;

  { // mint a loan
    const mint_result = moria_mutator.mintLoanWithBatonMinter({ loan_amount, collateral_amount, annual_interest_bp: 100n }, funding_coins, loan_agent_locking_bytecode, payout_rules);
    loan_utxo = mint_result.loan_utxo;
    funding_coins = mint_result.payouts
      .map((utxo) => ({
        type: SpendableCoinType.P2PKH as SpendableCoinType.P2PKH,
        key: sb.PRIVATE_KEY,
        ...utxo,
      }));
  }

  moria_mutator.getMutationContext().delphi_utxo = DELPHI_UTXO_LOW_PRICE;
  const interest_owed = calcInterestOwed(
    principalFromLoanCommitment(loan_utxo.output.token.nft.commitment),
    annualInterestBPFromLoanCommitment(loan_utxo.output.token.nft.commitment),
    timestampFromDelphiCommitment(DELPHI_UTXO_LOW_PRICE.output.token.nft.commitment),
    timestampFromLoanCommitment(loan_utxo.output.token.nft.commitment)
  );
  // musd funding plus some extra from elsewhere to pay for the interest
  const musd_funding_coins: SpendableCoin[] = [ ...funding_coins.filter((a) => a.output.token?.token_id == compiler_context.moria_token_id), sb.MUSD_INPUT_COINS[0] as SpendableCoin ];
  const result = moria_mutator.liquidateLoan(loan_utxo, musd_funding_coins, payout_rules);

  validateMoriaTxPayouts(t, compiler_context.moria_token_id, { bch_diff: collateral_amount, token_diff: -1n * (interest_owed + loan_amount) }, null, result, musd_funding_coins, sb.P2PKH_LOCKING_BYTECODE);

  // verify the validity of the transaction
  verifyTxResult(result);
});



