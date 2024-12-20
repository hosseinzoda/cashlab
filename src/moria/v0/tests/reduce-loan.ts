import test from 'ava';

import * as sb from './fixtures/solo-borrower.js';
import { ORACLE_OWNER_PUBKEY, MORIA_UTXO, ORACLE_UTXO } from './fixtures/moria.js';

import MoriaV0 from '../index.js';
import type { SpendableCoin } from '../../../common/types.js';
import { SpendableCoinType } from '../../../common/constants.js';
import { uint8ArrayEqual } from '../../../common/util.js';

test('moria-v0-reduce-loan', (t) => {
  const moria = new MoriaV0({
    oracle_owner_pubkey: ORACLE_OWNER_PUBKEY,
    txfee_per_byte: 1n,
  });
  const { musd_token_id } = moria.getInfo();
  const loan_amount = 50000n;
  const collateral_amount = 200000000n;

  let next_moria_utxo = MORIA_UTXO;
  let next_oracle_utxo = ORACLE_UTXO;

  const mint_result = moria.mintLoan(next_moria_utxo, next_oracle_utxo, sb.PURE_BCH_INPUT_COINS, loan_amount, collateral_amount, sb.PKH, sb.P2PKH_LOCKING_BYTECODE, [ sb.CHANGE_PAYOUT_RULE ]);
  moria.verifyTxResult(mint_result);

  next_moria_utxo = mint_result.moria_utxo;
  next_oracle_utxo = mint_result.oracle_utxo;

  const reduce_input_coins: SpendableCoin[] = [
    // exclude loan token payout
    ...mint_result.payouts.filter((a) => a.output.token?.token_id != musd_token_id).map((utxo) => ({
      type: SpendableCoinType.P2PKH,
      key: sb.PRIVATE_KEY,
      ...utxo,
    })),
    // partial payotu
    ...sb.MUSD_INPUT_COINS.slice(0, 3),
  ];

  const input_bch_amount = reduce_input_coins.reduce((a, b) => a + b.output.amount, 0n);
  const input_musd_amount = reduce_input_coins.filter((a) => a?.output?.token?.token_id == musd_token_id).reduce((a, b) => a + (b.output.token?.amount as bigint), 0n);

  const result = moria.reduceLoan(next_moria_utxo, next_oracle_utxo, mint_result.loan_utxo, sb.PRIVATE_KEY, 'MIN', sb.PKH, reduce_input_coins, [ sb.CHANGE_PAYOUT_RULE ]);

  const { price: oracle_price } = moria.parseOracleMessageFromNFTCommitment(ORACLE_UTXO.output.token.nft.commitment);
  const loan_params = moria.parseParametersFromLoanNFTCommitment(result.loan_utxo.output.token.nft.commitment);

  t.is(result.payouts.filter((a) => uint8ArrayEqual(a.output.locking_bytecode, sb.P2PKH_LOCKING_BYTECODE)).length, result.payouts.length);

  const payouts_bch_amount = result.payouts.reduce((a, b) => a + b.output.amount, 0n);
  const payouts_musd_amount = result.payouts.filter((a) => a?.output?.token?.token_id == musd_token_id).reduce((a, b) => a + (b.output?.token?.amount as bigint), 0n);

  t.is(payouts_musd_amount, 0n);
  t.assert(result.txfee < 5000n, `Expecting txfee to be less than 5000 sats`);

  t.assert(input_bch_amount < payouts_bch_amount);

  const collateral_ratio = Number(result.loan_utxo.output.amount) / Number(((loan_amount * 100000000n) / oracle_price))
  t.assert(Math.abs(collateral_ratio - 1.5) < 0.005);

  t.is(loan_amount, loan_params.amount + input_musd_amount);
  t.is(input_bch_amount, payouts_bch_amount + result.loan_utxo.output.amount + result.oracle_use_fee + result.txfee - collateral_amount);

  for (const tx_result of result.tx_result_chain) {
    // verify the transactions
    moria.verifyTxResult(tx_result);
  }

});

