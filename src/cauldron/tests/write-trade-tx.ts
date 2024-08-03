import test from 'ava';

import { ExchangeLab } from '../index.js';
import type { PoolV0Parameters, PoolTrade, TradeTxResult  } from '../types.js';
import type {
  TokenId, SpendableCoinP2PKH, OutputWithFT, Output,
  SpendableCoin, PayoutRule,
} from '../../common/types.js';
import {
  NATIVE_BCH_TOKEN_ID, FIXED_PAYOUT_RULE_APPLY_MIN_AMOUNT, SpendableCoinType, PayoutAmountRuleType,
} from '../../common/constants.js';
import { convertTokenIdToUint8Array, uint8ArrayEqual } from '../../common/util.js';
import {
  sample_pool_token_id, sample_pool_withdraw_pubkey_hash, dummy_private_key, dummy_txhash, aBCH,
  second_dummy_private_key,
} from './fixtures/sample.helper.js';
import * as libauth from '@bitauth/libauth';

const sumLAuthOutputTokenAmountWithFilter = (outputs: libauth.Output[], token_id: TokenId): bigint => {
  if (token_id == NATIVE_BCH_TOKEN_ID) {
    return outputs.reduce((a0, a1) => a0 + a1.valueSatoshis, 0n);
  } else {
    return outputs.reduce((a0, a1) => a0 + (a1?.token && uint8ArrayEqual(a1.token.category, convertTokenIdToUint8Array(token_id)) ? a1.token.amount : 0n), 0n);
  }
};
const sumOutputTokenAmountWithFilter = (outputs: Output[], token_id: TokenId): bigint => {
  if (token_id == NATIVE_BCH_TOKEN_ID) {
    return outputs.reduce((a0, a1) => a0 + a1.amount, 0n);
  } else {
    return outputs.reduce((a0, a1) => a0 + (a1?.token?.token_id == token_id ? a1.token.amount : 0n), 0n);
  }
};

const verifyFixedPayouts = (t: any, result: TradeTxResult, payout_rules: PayoutRule[]): void => {
  for (const payout_rule of payout_rules) {
    if (payout_rule.type == PayoutAmountRuleType.FIXED) {
      const sub_outputs = result.libauth_generated_transaction.outputs.filter((a) => uint8ArrayEqual(a.lockingBytecode, payout_rule.locking_bytecode));
      let found_match = false;
      for (const output of sub_outputs) {
        if ((payout_rule.amount == FIXED_PAYOUT_RULE_APPLY_MIN_AMOUNT ||
             payout_rule.amount == output.valueSatoshis) && (
          (payout_rule.token == null && output.token == null) ||
            (output.token != null && payout_rule.token != null &&
              payout_rule.token.amount == output.token.amount &&
              uint8ArrayEqual(output.token.category, convertTokenIdToUint8Array(payout_rule.token.token_id)))
        )) {
          found_match = true;
        }
      }
      t.is(found_match, true);
    }
  }
};

const verifyPayoutsOfTradeTxResultBasedOnTradePools = (t: any, result: TradeTxResult, input_pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_rules: PayoutRule[], entries: Array<{ role: string, token_id: string, constant_addition: bigint }>) => {
  const lockingByteMatchesAPayoutRule = (a: libauth.Output): boolean => payout_rules.filter((b) => uint8ArrayEqual(a.lockingBytecode, b.locking_bytecode)).length > 0;
  for (const { role, token_id, constant_addition } of entries) {
    const token_payout_sum =  sumLAuthOutputTokenAmountWithFilter(result.libauth_generated_transaction.outputs.filter(lockingByteMatchesAPayoutRule), token_id);
    const expected_token_payout =
      sumOutputTokenAmountWithFilter(input_coins.map((a) => a.output), token_id) +
      ((role == 'supply' ? -1n : 1n) *
        input_pool_trade_list
          .filter((a) => token_id == (role == 'supply' ? a.supply_token_id : a.demand_token_id))
          .reduce((a, b) => a + (role == 'supply' ? b.supply : b.demand), 0n)) + constant_addition;
    t.is(token_payout_sum, expected_token_payout);
  }
};

test('write a trade tx, test01', (t) => {

  const exlab = new ExchangeLab();

  const supply_token_id: TokenId = sample_pool_token_id;
  const demand_token_id: TokenId = NATIVE_BCH_TOKEN_ID;
  const sample_pool_params: PoolV0Parameters = {
    withdraw_pubkey_hash: sample_pool_withdraw_pubkey_hash,
  };
  const input_pool_trade_list: PoolTrade[] = [
    {
      supply_token_id,
      supply: 2n,
      demand_token_id,
      demand: 171561988n,
      trade_fee: 514685n,
      pool: {
        version: '0',
        parameters: sample_pool_params,
        outpoint: {
          index: 0,
          txhash: dummy_txhash,
        },
        output: {
          locking_bytecode: exlab.generatePoolV0LockingBytecode(sample_pool_params),
          token: {
            amount: 11n,
            token_id: sample_pool_token_id,
          },
          amount: 1118498378n,
        },
      },
    },
  ];
  const dummy_p2pkh_bytecode = libauth.privateKeyToP2pkhLockingBytecode({ privateKey: dummy_private_key, throwErrors: true });
  const second_dummy_p2pkh_bytecode = libauth.privateKeyToP2pkhLockingBytecode({ privateKey: second_dummy_private_key, throwErrors: true });
  const input_coin0: SpendableCoinP2PKH<OutputWithFT> = {
    type: SpendableCoinType.P2PKH,
    output: {
      locking_bytecode: dummy_p2pkh_bytecode,
      token: {
        amount: 3n,
        token_id: supply_token_id,
      },
      amount: 800n,
    },
    outpoint: {
      index: 1,
      txhash: dummy_txhash,
    },
    key: dummy_private_key,
  };
  const input_coin1: SpendableCoinP2PKH<Output> = {
    type: SpendableCoinType.P2PKH,
    output: {
      locking_bytecode: dummy_p2pkh_bytecode,
      amount: aBCH,
    },
    outpoint: {
      index: 2,
      txhash: dummy_txhash,
    },
    key: dummy_private_key,
  };
  const input_coins: SpendableCoin[] = [ input_coin0, input_coin1 ];

  const payout_rules: PayoutRule[] = [
    {
      type: PayoutAmountRuleType.FIXED,
      amount: aBCH / 2n,
      locking_bytecode: second_dummy_p2pkh_bytecode,
    },
    {
      type: PayoutAmountRuleType.CHANGE,
      allow_mixing_native_and_token: true,
      locking_bytecode: dummy_p2pkh_bytecode,
    },
  ];

  const txfee_per_byte: bigint = 1n;

  const result: TradeTxResult = exlab.writeTradeTx(input_pool_trade_list, input_coins, payout_rules, null, txfee_per_byte);

  exlab.verifyTradeTx(result);

  // check fixed payout
  verifyFixedPayouts(t, result, payout_rules);
  // check sum of all tokens
  verifyPayoutsOfTradeTxResultBasedOnTradePools(t, result, input_pool_trade_list, input_coins, payout_rules, [
    { role: 'supply', token_id: sample_pool_token_id, constant_addition: 0n },
    { role: 'demand', token_id: NATIVE_BCH_TOKEN_ID, constant_addition: -1n * result.txfee },
  ]);
});

test.only('write a trade tx, test02', (t) => {

  const exlab = new ExchangeLab();

  const supply_token_id: TokenId = NATIVE_BCH_TOKEN_ID;
  const demand_token_id: TokenId = sample_pool_token_id;
  const sample_pool_params: PoolV0Parameters = {
    withdraw_pubkey_hash: sample_pool_withdraw_pubkey_hash,
  };
  const input_pool_trade_list: PoolTrade[] = [
    {
      demand: 3n,
      demand_token_id,
      supply: 422298712n,
      supply_token_id,
      trade_fee: 1266896n,
      pool: {
        version: '0',
        parameters: sample_pool_params,
        outpoint: {
          index: 0,
          txhash: dummy_txhash,
        },
        output: {
          locking_bytecode: exlab.generatePoolV0LockingBytecode(sample_pool_params),
          token: {
            amount: 11n,
            token_id: sample_pool_token_id,
          },
          amount: 1122751507n,
        },
      },
    },
    {
      demand: 9n,
      demand_token_id,
      supply: 921379007n,
      supply_token_id,
      trade_fee: 2764137n,
      pool: {
        version: '0',
        parameters: sample_pool_params,
        outpoint: {
          index: 1,
          txhash: dummy_txhash,
        },
        output: {
          locking_bytecode: exlab.generatePoolV0LockingBytecode(sample_pool_params),
          token: {
            amount: 20n,
            token_id: sample_pool_token_id,
          },
          amount: 1122751507n,
        },
      },
    },
  ];
  const dummy_p2pkh_bytecode = libauth.privateKeyToP2pkhLockingBytecode({ privateKey: dummy_private_key, throwErrors: true });
  const second_dummy_p2pkh_bytecode = libauth.privateKeyToP2pkhLockingBytecode({ privateKey: second_dummy_private_key, throwErrors: true });
  const input_coin0: SpendableCoinP2PKH<Output> = {
    type: SpendableCoinType.P2PKH,
    output: {
      locking_bytecode: dummy_p2pkh_bytecode,
      amount: 14n * aBCH,
    },
    outpoint: {
      index: 2,
      txhash: dummy_txhash,
    },
    key: dummy_private_key,
  };
  const input_coins: SpendableCoin[] = [ input_coin0 ];

  const payout_rules: PayoutRule[] = [
    {
      type: PayoutAmountRuleType.FIXED,
      token: {
        amount: 3n,
        token_id: sample_pool_token_id,
      },
      amount: -1n,
      locking_bytecode: second_dummy_p2pkh_bytecode,
    },
    {
      type: PayoutAmountRuleType.CHANGE,
      allow_mixing_native_and_token: true,
      locking_bytecode: dummy_p2pkh_bytecode,
    },
  ];

  const txfee_per_byte: bigint = 1n;

  const result: TradeTxResult = exlab.writeTradeTx(input_pool_trade_list, input_coins, payout_rules, null, txfee_per_byte);

  exlab.verifyTradeTx(result);

  // check fixed payout
  verifyFixedPayouts(t, result, payout_rules);
  // check sum of all tokens
  verifyPayoutsOfTradeTxResultBasedOnTradePools(t, result, input_pool_trade_list, input_coins, payout_rules, [
    { role: 'supply', token_id: NATIVE_BCH_TOKEN_ID, constant_addition: -1n * result.txfee },
    { role: 'demand', token_id: sample_pool_token_id, constant_addition: 0n },
  ]);
});

