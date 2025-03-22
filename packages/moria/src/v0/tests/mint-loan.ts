import test from 'ava';

import * as libauth from '@cashlab/common/libauth.js';
const { binToHex } = libauth;

import * as sb from './fixtures/solo-borrower.js';
import { ORACLE_OWNER_PUBKEY, MORIA_UTXO, ORACLE_UTXO } from './fixtures/moria.js';

import MoriaV0 from '../index.js';
import { uint8ArrayEqual } from '@cashlab/common/util.js';

test('moria-v0-mint-loan', (t) => {
  const moria = new MoriaV0({
    oracle_owner_pubkey: ORACLE_OWNER_PUBKEY,
    txfee_per_byte: 1n,
  });
  const { musd_token_id } = moria.getInfo();
  const loan_amount = 50000n;
  const collateral_amount = 200000000n;

  const input_bch_amount = sb.PURE_BCH_INPUT_COINS.reduce((a, b) => a + b.output.amount, 0n);

  const result = moria.mintLoan(MORIA_UTXO, ORACLE_UTXO, sb.PURE_BCH_INPUT_COINS, loan_amount, collateral_amount, sb.PKH, sb.P2PKH_LOCKING_BYTECODE, [ sb.CHANGE_PAYOUT_RULE ]);

  const loan_output: libauth.Output = result.libauth_transaction.outputs[result.loan_utxo.outpoint.index] as any;

  const loan_parameters = MoriaV0.parseParametersFromLoanNFTCommitment(loan_output.token?.nft?.commitment as any);
  t.is(loan_parameters.amount, loan_amount);
  t.assert(uint8ArrayEqual(loan_parameters.borrower_pkh, sb.PKH), `Borrower pkh is incorrect!`);
  t.is(loan_output.valueSatoshis, collateral_amount);

  const payouts_output: libauth.Output[] = result.payouts.map((a) => result.libauth_transaction.outputs[a.outpoint.index] as any);

  t.assert(result.txfee < 5000n, `Expecting txfee to be less than 5000 sats`);

  t.is(payouts_output.filter((a) => uint8ArrayEqual(a.lockingBytecode, sb.P2PKH_LOCKING_BYTECODE)).length, payouts_output.length)

  t.is(payouts_output.filter((a) => a.token?.category != null && binToHex((a.token as any)?.category) == musd_token_id).reduce((a, b) => a + (b.token?.amount as bigint), 0n), loan_amount);

  // check bch change
  t.is(payouts_output.reduce((a, b) => a + b.valueSatoshis, 0n), input_bch_amount - result.txfee - collateral_amount - result.oracle_use_fee);

  // verify the validity of the transaction
  moria.verifyTxResult(result);

});

