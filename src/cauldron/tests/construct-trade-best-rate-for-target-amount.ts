import test from 'ava';

import { ExchangeLab } from '../index.js';
import type { PoolV0, PoolV0Parameters, TradeResult  } from '../types.js';
import type { TokenId } from '../../common/types.js';
import { NATIVE_BCH_TOKEN_ID } from '../../common/constants.js';
import { sample_pool_token_id, sample_pool_withdraw_pubkey_hash, dummy_txhash } from './fixtures/sample.helper.js';

test('best rate for target amount, test01', (t) => {

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
          amount: 11n,
          token_id: sample_pool_token_id,
        },
        amount: 1122751507n,
      },
    },
    {
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
  ];
  const demand = 12n;

  const result: TradeResult = exlab.constructTradeBestRateForTargetDemand(supply_token_id, demand_token_id, demand, input_pools, 0n);
  t.is(result.entries.length, 2);
  t.deepEqual(result.entries, [
    {
      demand: 3n,
      demand_token_id,
      pool: input_pools[0],
      supply: 422298712n,
      supply_token_id,
      trade_fee: 1266896n,
    },
    {
      demand: 9n,
      demand_token_id,
      pool: input_pools[1],
      supply: 921379007n,
      supply_token_id,
      trade_fee: 2764137n,
    },
  ]);

});


test('best rate for target amount, test02', (t) => {

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
          amount: 11000n,
          token_id: sample_pool_token_id,
        },
        amount: 1122751507n,
      },
    },
    {
      version: '0',
      parameters: sample_pool_params,
      outpoint: {
        index: 1,
        txhash: dummy_txhash,
      },
      output: {
        locking_bytecode: exlab.generatePoolV0LockingBytecode(sample_pool_params),
        token: {
          amount: 20000n,
          token_id: sample_pool_token_id,
        },
        amount: 1122751507n,
      },
    },
  ];
  const demand = 12201n;

  const result: TradeResult = exlab.constructTradeBestRateForTargetDemand(supply_token_id, demand_token_id, demand, input_pools, 0n);
  t.is(result.entries.length, 2);
  t.assert(result.summary.rate.numerator <= 1132519173838209n, 'trade average result is higher than a known best rate!!')
  // exact match to a pre-determined result
  t.deepEqual(result.entries, [
    {
      demand: 2995n,
      demand_token_id,
      pool: input_pools[0],
      supply: 421331548n,
      supply_token_id: 'BCH',
      trade_fee: 1263994n,
    },
    {
      demand: 9206n,
      demand_token_id,
      pool: input_pools[1],
      supply: 960455052n,
      supply_token_id,
      trade_fee: 2881365n,
    },
  ]);
});
