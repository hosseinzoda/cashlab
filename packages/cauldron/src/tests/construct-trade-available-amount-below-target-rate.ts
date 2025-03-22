import test from 'ava';

import { ExchangeLab } from '../index.js';
import type { PoolV0, PoolV0Parameters, TradeResult  } from '../types.js';
import type { Fraction, TokenId } from '@cashlab/common/types.js';
import { NATIVE_BCH_TOKEN_ID } from '@cashlab/common/constants.js';
import { sample_pool_token_id, sample_pool_withdraw_pubkey_hash, dummy_txhash } from './fixtures/sample.helper.js';

test('available amount below target rate, test01', (t) => {

  const exlab = new ExchangeLab();

  const supply_token_id: TokenId = sample_pool_token_id;
  const demand_token_id: TokenId = NATIVE_BCH_TOKEN_ID;
  const sample_pool_params: PoolV0Parameters = {
    withdraw_pubkey_hash: sample_pool_withdraw_pubkey_hash,
  };
  const input_pools: PoolV0[] = [
    {
      version: '0',
      parameters: sample_pool_params,
      outpoint: {
        index: 0,
        txhash: dummy_txhash,
      },
      output: {
        locking_bytecode: exlab.generatePoolV0LockingBytecode(sample_pool_params),
        token: {
          amount: 1100n,
          token_id: sample_pool_token_id,
        },
        amount: 1118498378n,
      },
    },
  ];
  const _rd = exlab.getRateDenominator();
  const rate: Fraction = {
    numerator: 100n * _rd / 64258078n,
    denominator: _rd,
  };

  const result: TradeResult = exlab.constructTradeAvailableAmountBelowTargetRate(supply_token_id, demand_token_id, rate, input_pools) as TradeResult;

  t.not(result, null);
  t.is(result.entries.length, 1);
  t.deepEqual(result.entries[0], {
    supply_token_id,
    supply: 284n,
    demand_token_id,
    demand: 228831958n,
    trade_fee: 686495n,
    pool: input_pools[0],
  });
});


test('available amount below target rate, test02', (t) => {

  const exlab = new ExchangeLab();

  const supply_token_id: TokenId = NATIVE_BCH_TOKEN_ID;
  const demand_token_id: TokenId = sample_pool_token_id;
  const sample_pool_params: PoolV0Parameters = {
    withdraw_pubkey_hash: sample_pool_withdraw_pubkey_hash,
  };
  const input_pools: PoolV0[] = [
    {
      version: '0',
      parameters: sample_pool_params,
      outpoint: {
        index: 0,
        txhash: dummy_txhash,
      },
      output: {
        locking_bytecode: exlab.generatePoolV0LockingBytecode(sample_pool_params),
        token: {
          amount: 14n,
          token_id: sample_pool_token_id,
        },
        amount: 878224755n,
      },
    },
  ];
  const _rd = exlab.getRateDenominator();
  const rate: Fraction = {
    numerator: 72770000n * _rd / 1n,
    denominator: _rd,
  };

  const result: TradeResult = exlab.constructTradeAvailableAmountBelowTargetRate(supply_token_id, demand_token_id, rate, input_pools) as TradeResult;

  t.not(result, null);
  t.is(result.entries.length, 1);
  t.deepEqual(result.entries[0], {
    supply_token_id,
    supply: 67759028n,
    demand_token_id,
    demand: 1n,
    trade_fee: 203277n,
    pool: input_pools[0],
  });

});

