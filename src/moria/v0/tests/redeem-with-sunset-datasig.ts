import test from 'ava';

import * as libauth from '@bitauth/libauth';
const { binToHex, generatePrivateKey, privateKeyToP2pkhLockingBytecode } = libauth;

import * as sb from './fixtures/solo-borrower.js';
import {
  ORACLE_OWNER_PUBKEY, MORIA_UTXO, ORACLE_UTXO,
  DUMMY_SUNSET_PUBLIC_KEY, DUMMY_SUNSET_MESSAGE, DUMMY_SUNSET_DATASIG,
} from './fixtures/moria.js';

import MoriaV0 from '../index.js';
import { InvalidProgramState } from '../../../common/exceptions.js';
import { uint8ArrayEqual } from '../../../common/util.js';
import type { SpendableCoin, PayoutRule } from '../../../common/types.js';
import { SpendableCoinType, PayoutAmountRuleType } from '../../../common/constants.js';

test('moria-v0-redeem-with-sunset-datasig', (t) => {

  const moria = new MoriaV0({
    oracle_owner_pubkey: ORACLE_OWNER_PUBKEY,
    txfee_per_byte: 1n,
  });
  // overwrite predefined template data
  moria._template_predefined_data['moria'] = {
    sunset_pubkey: DUMMY_SUNSET_PUBLIC_KEY,
    sunset_message: DUMMY_SUNSET_MESSAGE,
    oracle_token: moria._template_predefined_data['moria'].oracle_token,
  };
  const moria_locking_bytecode_result = moria._context.moria_compiler.generateBytecode({
    data: {},
    scriptId: 'moria',
  });
  if (!moria_locking_bytecode_result.success) {
    /* c8 ignore next */
    throw new InvalidProgramState('Failed to generate bytecode, script: loan, ' + JSON.stringify(moria_locking_bytecode_result, null, '  '));
  }
  const moria_locking_bytecode = moria_locking_bytecode_result.bytecode;
  let dummy_moria_utxo = structuredClone(MORIA_UTXO);
  dummy_moria_utxo.output.locking_bytecode = moria_locking_bytecode;
  const { musd_token_id } = moria.getInfo();
  const loan_amount = 50000n;
  const collateral_amount = 200000000n;


  const mint_result = moria.mintLoan(dummy_moria_utxo, ORACLE_UTXO, sb.PURE_BCH_INPUT_COINS, loan_amount, collateral_amount, sb.PKH, sb.P2PKH_LOCKING_BYTECODE, [ sb.CHANGE_PAYOUT_RULE ]);
  moria.verifyTxResult(mint_result);

  const redeemer_private_key = generatePrivateKey();
  const redeemer_locking_bytecode = privateKeyToP2pkhLockingBytecode({ privateKey: redeemer_private_key });
  const redeemer_coins: SpendableCoin[] = structuredClone(sb.MUSD_INPUT_COINS).map((a) => ({
    type: SpendableCoinType.P2PKH,
    key: redeemer_private_key,
    outpoint: a.outpoint,
    output: {
      ...a.output,
      locking_bytecode: redeemer_locking_bytecode,
    },
  }));
  const redeemer_payout_rules: PayoutRule[] = [
    {
      locking_bytecode: redeemer_locking_bytecode,
      type: PayoutAmountRuleType.CHANGE,
      allow_mixing_native_and_token: true,
    },
  ];

  const { price: oracle_price } = MoriaV0.parseOracleMessageFromNFTCommitment(ORACLE_UTXO.output.token.nft.commitment);
  const redeemable = (loan_amount * 100000000n) / oracle_price;
  const remainder = collateral_amount - redeemable;

  const input_bch_amount = redeemer_coins.reduce((a, b) => a + b.output.amount, 0n);
  const input_musd_amount = redeemer_coins.filter((a) => a?.output?.token?.token_id == musd_token_id).reduce((a, b) => a + (b.output.token?.amount as bigint), 0n);

  const result = moria.redeemWithSunsetSignature(mint_result.moria_utxo, mint_result.oracle_utxo, mint_result.loan_utxo, DUMMY_SUNSET_DATASIG, redeemer_coins, redeemer_payout_rules);

  const borrower_payouts_output: libauth.Output[] = result.borrower_payouts.map((a) => result.libauth_transaction.outputs[a.outpoint.index] as any);
  const redeemer_payouts_output: libauth.Output[] = result.redeemer_payouts.map((a) => result.libauth_transaction.outputs[a.outpoint.index] as any);

  t.assert(result.txfee < 5000n, `Expecting txfee to be less than 5000 sats`);


  t.is(borrower_payouts_output.filter((a) => uint8ArrayEqual(a.lockingBytecode, sb.P2PKH_LOCKING_BYTECODE)).length, borrower_payouts_output.length);
  t.is(redeemer_payouts_output.filter((a) => uint8ArrayEqual(a.lockingBytecode, redeemer_locking_bytecode)).length, redeemer_payouts_output.length);

  // redeemer accounting
  t.is(redeemer_payouts_output.filter((a) => a.token?.category != null && binToHex((a.token as any)?.category) == musd_token_id).reduce((a, b) => a + (b.token?.amount as bigint), 0n), input_musd_amount - loan_amount);
  t.is(redeemer_payouts_output.reduce((a, b) => a + b.valueSatoshis, 0n), input_bch_amount - result.txfee - result.oracle_use_fee + redeemable);

  // borrower accounting
  t.is(borrower_payouts_output.reduce((a, b) => a + b.valueSatoshis, 0n), remainder);

  // verify the validity of the transaction
  moria.verifyTxResult(result);

});

