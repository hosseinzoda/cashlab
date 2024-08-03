import test from 'ava';

import { ExchangeLab } from '../index.js';
import type { PoolV0, PoolV0Parameters, TradeResult  } from '../types.js';
import type { TokenId } from '../../common/types.js';
import { NATIVE_BCH_TOKEN_ID } from '../../common/constants.js';
import { sample_pool_token_id, sample_pool_withdraw_pubkey_hash, dummy_txhash } from './fixtures/sample.helper.js';

test('trade fee calc with target demand, test01', (t) => {

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
          amount: 2045994225n,
          token_id: sample_pool_token_id,
        },
        amount: 4094333n,
      },
    },
  ];
  // const demand = 4085886n;
  const demand = 4073665n;

  const result: TradeResult = exlab.constructTradeBestRateForTargetDemand(supply_token_id, demand_token_id, demand, input_pools, 0n);
  t.is(result.entries.length, 1);
  // exact match to a pre-determined result
  t.deepEqual(result.entries, [
    {
      supply: 989547480353n,
      supply_token_id,
      demand,
      demand_token_id,
      pool: input_pools[0],
      trade_fee: 12220n,
    }
  ]);
});

// same as test01, except demand = 4085887n
test('trade fee calc with target demand, test02', (t) => {
  
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
          amount: 2045994225n,
          token_id: sample_pool_token_id,
        },
        amount: 4094333n,
      },
    },
  ];
  //const demand = 4081351n;
  const demand = 4073666n;

  const result: TradeResult = exlab.constructTradeBestRateForTargetDemand(supply_token_id, demand_token_id, demand, input_pools, 0n);
  t.is(result.entries.length, 1);
  // exact match to a pre-determined result
  t.deepEqual(result.entries, [
    {
      supply: 989664870370n,
      supply_token_id,
      demand,
      demand_token_id,
      pool: input_pools[0],
      trade_fee: 12220n,
    }
  ]);
});
