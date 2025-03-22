import test from 'ava';

import * as libauth from '@cashlab/common/libauth.js';
const { binToHex } = libauth;

import * as sb from './fixtures/solo-borrower.js';
import { ORACLE_OWNER_PUBKEY, MORIA_UTXO, ORACLE_UTXO, ORACLE_UTXO_LOW_PRICE } from './fixtures/moria.js';

import MoriaV0 from '../index.js';
import type { SpendableCoin } from '@cashlab/common/types.js';
import { SpendableCoinType } from '@cashlab/common/constants.js';
import { uint8ArrayEqual } from '@cashlab/common/util.js';

test('moria-v0-liquidate-loan', (t) => {
  const moria = new MoriaV0({
    oracle_owner_pubkey: ORACLE_OWNER_PUBKEY,
    txfee_per_byte: 1n,
  });
  const { musd_token_id } = moria.getInfo();
  const loan_amount = 50000n;
  const collateral_amount = 200000000n;

  const musd_inputs = sb.MUSD_INPUT_COINS.slice(0, 1);

  const input_bch_amount = sb.PURE_BCH_INPUT_COINS.reduce((a, b) => a + b.output.amount, 0n) +
    musd_inputs.reduce((a, b) => a + b.output.amount, 0n);

  let next_moria_utxo = MORIA_UTXO;
  let next_oracle_utxo = ORACLE_UTXO;

  const mint_result = moria.mintLoan(next_moria_utxo, next_oracle_utxo, sb.PURE_BCH_INPUT_COINS, loan_amount, collateral_amount, sb.PKH, sb.P2PKH_LOCKING_BYTECODE, [ sb.CHANGE_PAYOUT_RULE ]);
  moria.verifyTxResult(mint_result);

  next_moria_utxo = mint_result.moria_utxo;
  next_oracle_utxo = ORACLE_UTXO_LOW_PRICE;

  const mint_payout_coins: SpendableCoin[] = [
    ...mint_result.payouts.map((utxo) => ({
      type: SpendableCoinType.P2PKH,
      key: sb.PRIVATE_KEY,
      ...utxo,
    })),
    ...musd_inputs,
  ];
  
  //const result = moria.liquidateLoan(next_moria_utxo, next_oracle_utxo, mint_result.loan_utxo, mint_payout_coins, [ sb.CHANGE_PAYOUT_RULE ]);
  const result = moria.repayLoan(next_moria_utxo, next_oracle_utxo, mint_result.loan_utxo, sb.PRIVATE_KEY, mint_payout_coins, [ sb.CHANGE_PAYOUT_RULE ]);

  const payouts_output: libauth.Output[] = result.payouts.map((a) => result.libauth_transaction.outputs[a.outpoint.index] as any);

  t.assert(result.txfee < 5000n, `Expecting txfee to be less than 5000 sats`);

  t.is(payouts_output.filter((a) => uint8ArrayEqual(a.lockingBytecode, sb.P2PKH_LOCKING_BYTECODE)).length, payouts_output.length)

  // tokens payout
  t.is(
    payouts_output.filter((a) => a.token?.category != null && binToHex((a.token as any)?.category) == musd_token_id).reduce((a, b) => a + (b.token?.amount as bigint), 0n),
    musd_inputs.reduce((a, b) => a + (b.output.token?.amount as bigint), 0n)
  );

  // check bch change
  t.is(
    payouts_output.reduce((a, b) => a + b.valueSatoshis, 0n),
    input_bch_amount -
      (result.txfee + mint_result.txfee + result.oracle_use_fee + mint_result.oracle_use_fee)
  );

  // verify the transaction
  moria.verifyTxResult(result);

});


