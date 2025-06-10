import test from 'ava';

import { hexToBin }  from '@cashlab/common/libauth.js';
import { NATIVE_BCH_TOKEN_ID }  from '@cashlab/common/constants.js';

import * as sb from './fixtures/solo-borrower.js';
import { DELPHI_UTXO, DELPHI_GP_UPDATER_UTXO } from './fixtures/moria.js';

import { calcAvailablePayoutFromIO } from '@cashlab/common/util.js';
import { updateDelphiCommitmentWithGPUpdater } from '../compiler.js';
import { createMoriaMUSDV1CompilerContext, verifyTxResult } from '../moria.js';
import {
  dataSequenceFromDelphiCommitment, timestampFromDelphiCommitment,
  priceFromDelphiCommitment, useFeeFromDelphiCommitment,
} from '../util.js';

test('moria-v1-delphi-update-with-gp-updater', (t) => {
  const compiler_context = createMoriaMUSDV1CompilerContext({
    txfee_per_byte: { numerator: 1n, denominator: 1n },
  });

  const funding_coins = sb.PURE_BCH_INPUT_COINS.slice(0, 1);
  const payout_rules = [ sb.CHANGE_PAYOUT_RULE ]

  // message from https://oracles.cash/oracles/02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818/1174922
  const message = hexToBin('964348688aed110071ed1100c4a70000');
  const sig = hexToBin('782d10b1dcbf6be97c8ba6c01d0d42276a96e5e70925422a71f6891a6373ad2ecd3d5bea84d63bf14699dc55917be5ec748c90a7a3aab6fda411d7e4150c8b6f');

  const result = updateDelphiCommitmentWithGPUpdater(compiler_context, { delphi: DELPHI_UTXO, delphi_gp_updater: DELPHI_GP_UPDATER_UTXO }, message, sig, funding_coins, payout_rules);

  // verify payout
  const available_payouts = calcAvailablePayoutFromIO(result.payouts.map((utxo) => ({ utxo })), []);
  const bch_payout = (available_payouts.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID) as { amount: bigint }).amount;
  t.is(available_payouts.length, 1);
  t.is(bch_payout + result.txfee, funding_coins.reduce((a, b) => a + b.output.amount, 0n));
  // verify the validity of the transaction
  verifyTxResult(result);

  const delphi_commitment = result.delphi_utxo.output.token.nft.commitment;
  t.is(dataSequenceFromDelphiCommitment(delphi_commitment), 1174897n);
  t.is(timestampFromDelphiCommitment(delphi_commitment), 1749566358n);
  t.is(priceFromDelphiCommitment(delphi_commitment), 42948n);
  t.is(useFeeFromDelphiCommitment(delphi_commitment), 1000n);
});


