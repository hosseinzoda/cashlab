import test from 'ava';

import { ValueError, BurnNFTException } from '@cashlab/common/exceptions.js';
import type { SpendableCoin, UTXO, UTXOWithNFT, OutputWithNFT, PayoutRule } from '@cashlab/common/types.js';
import { SpendableCoinType, PayoutAmountRuleType, NATIVE_BCH_TOKEN_ID } from '@cashlab/common/constants.js';
import { uint8ArrayEqual, calcAvailablePayoutFromIO, simpleJsonSerializer } from '@cashlab/common/util.js';
import { generateBytecodeWithLibauthCompiler } from '@cashlab/common/util-libauth-dependent.js';

import * as sb from './fixtures/solo-borrower.js';
import {
  MORIA_UTXO, DELPHI_UTXO, BPORACLE_UTXO, BATONMINTER_UTXO,
} from './fixtures/moria.js';
import { validateMoriaTxPayouts } from './fixtures/helpers.js';

import {
  timestampFromDelphiCommitment, priceFromDelphiCommitment,
  principalFromLoanCommitment, timestampFromLoanCommitment, annualInterestBPFromLoanCommitment,
  calcInterestOwed, calcRedeemableBCHAmount, outputNFTHash
} from '../util.js';
import { createMoriaMUSDV1CompilerContext, createMoriaMutationContext, MoriaMutator, verifyTxResult } from '../moria.js';
import type { Pay2NFTHWithdrawEntry } from '../types.js';

test('moria-v1-p2nfth-unlock', (t) => {
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
  let loan_agent_coin: SpendableCoin<OutputWithNFT>;
  let loan_utxo: UTXOWithNFT;

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

  let borrower_p2nfth_utxo: UTXO;
  let borrower_bch: bigint;
  {
    const redeem_payout_rules: PayoutRule[] = [
      {
        locking_bytecode: sb.P2PKH_LOCKING_BYTECODE,
        type: PayoutAmountRuleType.CHANGE,
        allow_mixing_native_and_token: true,
      }
    ];
    const interest_owed = calcInterestOwed(
      principalFromLoanCommitment(loan_utxo.output.token.nft.commitment),
      annualInterestBPFromLoanCommitment(loan_utxo.output.token.nft.commitment),
      timestampFromDelphiCommitment(DELPHI_UTXO.output.token.nft.commitment),
      timestampFromLoanCommitment(loan_utxo.output.token.nft.commitment)
    );
    const total_owed = interest_owed + loan_amount;
    const redeemable = calcRedeemableBCHAmount(total_owed, priceFromDelphiCommitment(DELPHI_UTXO.output.token.nft.commitment));
    borrower_bch = collateral_amount - redeemable;
    // musd funding plus some extra from elsewhere to pay for the interest
    const musd_funding_coins: SpendableCoin[] = [ ...funding_coins.filter((a) => a.output.token?.token_id == compiler_context.moria_token_id), sb.MUSD_INPUT_COINS[0] as SpendableCoin ];
    const result = moria_mutator.redeemLoan(loan_utxo, musd_funding_coins, redeem_payout_rules);
    borrower_p2nfth_utxo = result.borrower_p2nfth_utxo;
    validateMoriaTxPayouts(t, compiler_context.moria_token_id, { bch_diff: redeemable, token_diff: -1n * total_owed }, null, result, musd_funding_coins, sb.P2PKH_LOCKING_BYTECODE);
    // verify the validity of the transaction
    verifyTxResult(result);
  }


  // withdraw borrower's p2nfth
  const p2nfth_entries: Pay2NFTHWithdrawEntry[] = [ { utxo: borrower_p2nfth_utxo } ];
  const result = moria_mutator.withdrawPay2NFTHCoins(loan_agent_coin, p2nfth_entries, [], payout_rules, {
    createNFTOutput: (utxo: UTXOWithNFT): OutputWithNFT => {
      if (uint8ArrayEqual(utxo.outpoint.txhash, loan_agent_coin.outpoint.txhash) &&
          utxo.outpoint.index == loan_agent_coin.outpoint.index) {
        throw new BurnNFTException();
      }
      throw new ValueError(`Unexpected nft, No other nft should exists in the withdraw.`);
    },
  });
  const available_payouts = calcAvailablePayoutFromIO(result.payouts.map((utxo) => ({ utxo })), []);
  const bch_payout = (available_payouts.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID) as { amount: bigint }).amount;
  t.is(bch_payout + result.txfee - loan_agent_coin.output.amount, borrower_bch);
  t.is(result.nft_utxos.length, 0);
  t.is(result.payouts.filter((a) => uint8ArrayEqual(sb.P2PKH_LOCKING_BYTECODE, a.output.locking_bytecode)).length, result.payouts.length);
});


test('moria-v1-p2nfth-unlock-keep-nft', (t) => {
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
  let loan_agent_coin: SpendableCoin<OutputWithNFT>;
  let loan_utxo: UTXOWithNFT;

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

  const p2nfth_utxo_list: UTXO[] = [];
  {
    const redeem_payout_rules: PayoutRule[] = [
      {
        locking_bytecode: generateBytecodeWithLibauthCompiler(compiler_context.p2nfth_compiler, {
          scriptId: '__main__',
          data: {
            bytecode: {
              nfthash: outputNFTHash(loan_agent_coin.output),
            },
          },
        }),
        type: PayoutAmountRuleType.CHANGE,
        allow_mixing_native_and_token: true,
      }
    ];
    // musd funding plus some extra from elsewhere to pay for the interest
    const musd_funding_coins: SpendableCoin[] = [ ...funding_coins.filter((a) => a.output.token?.token_id == compiler_context.moria_token_id), sb.MUSD_INPUT_COINS[0] as SpendableCoin ];
    const result = moria_mutator.redeemLoan(loan_utxo, musd_funding_coins, redeem_payout_rules);
    // verify the validity of the transaction
    verifyTxResult(result);
    for (const payout of result.payouts) {
      p2nfth_utxo_list.push(payout);
    }
    p2nfth_utxo_list.push(result.borrower_p2nfth_utxo);
  }

  // withdraw borrower's p2nfth
  const p2nfth_entries: Pay2NFTHWithdrawEntry[] = p2nfth_utxo_list.map((utxo) => ({ utxo }));
  const result = moria_mutator.withdrawPay2NFTHCoins(loan_agent_coin, p2nfth_entries, [], payout_rules, {
    createNFTOutput: (utxo: UTXOWithNFT): OutputWithNFT => {
      if (uint8ArrayEqual(utxo.outpoint.txhash, loan_agent_coin.outpoint.txhash) &&
          utxo.outpoint.index == loan_agent_coin.outpoint.index) {
        return structuredClone(utxo.output);
      }
      throw new ValueError(`Unexpected nft, No other nft should exists in the withdraw.`);
    },
  });
  const available_payouts = calcAvailablePayoutFromIO(result.payouts.map((utxo) => ({ utxo })), []);
  const token_payout = (available_payouts.find((a) => a.token_id == compiler_context.moria_token_id) as { amount: bigint }).amount;
  const bch_payout = (available_payouts.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID) as { amount: bigint }).amount;
  t.is(token_payout, 9n);
  t.assert(bch_payout + 5000n > collateral_amount);
  t.is(bch_payout + result.txfee + result.nft_utxos.reduce((a, b) => a + b.output.amount, 0n),
       p2nfth_entries.reduce((a, b) => a + b.utxo.output.amount, 0n) + loan_agent_coin.output.amount);
  t.is(result.nft_utxos.length, 1);
  t.is(JSON.stringify((result.nft_utxos[0] as UTXO).output, simpleJsonSerializer),
       JSON.stringify(loan_agent_coin.output, simpleJsonSerializer))
  // verify the validity of the transaction
  verifyTxResult(result);
});


