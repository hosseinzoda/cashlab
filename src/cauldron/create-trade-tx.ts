import type { TokenId, PayoutRule, Output, OutputWithFT, SpendableCoin } from '../common/types.js';
import { NATIVE_BCH_TOKEN_ID, SpendableCoinType } from '../common/constants.js';
import { InvalidProgramState, ValueError } from '../common/exceptions.js';
import { convertTokenIdToUint8Array } from '../common/util.js';
import * as payoutBuilder from '../common/payout-builder.js';
import * as libauth from '@bitauth/libauth';
const { compactUintPrefixToLength, bigIntToCompactUint } = libauth;
import { buildPoolV0UnlockingBytecode } from './binutil.js';
import type { BCHCauldronContext, PoolTrade, TradeTxResult } from './types.js';

export const createTradeTx = (context: BCHCauldronContext, compiler: libauth.CompilerBCH, pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_rules: PayoutRule[], data_locking_bytecode: Uint8Array | null, txfee_per_byte: number | bigint): TradeTxResult => {
  const _txfee_per_byte = typeof txfee_per_byte == 'bigint' ? txfee_per_byte : BigInt(txfee_per_byte);
  if (_txfee_per_byte < 0n) {
    throw new ValueError('txfee should be greater than or equal to zero');
  }
  const aggregate_payout_list = validateTradePoolListAndCalcAggregatePayouts(pool_trade_list, input_coins);
  const calc_tx_size_cache = initCalcTxSizeCache();
  const calcTxFeeWithOutputs = (outputs: Output[]): bigint => {
    const tx_size = calcTxSize(pool_trade_list, input_coins, outputs, data_locking_bytecode, calc_tx_size_cache);
    return BigInt(tx_size) * _txfee_per_byte;
  };
  // build the payout outputs, apply payout rules
  const payout_context = {
    getOutputMinAmount (output: Output): bigint {
      return context.getOutputMinAmount(output);
    },
    getPreferredTokenOutputBCHAmount (output: Output): bigint | null {
      return context.getPreferredTokenOutputBCHAmount(output);
    },
    calcTxFeeWithOutputs (outputs: Output[]): bigint {
      return calcTxFeeWithOutputs(outputs);
    },
  };
  const { payout_outputs, txfee, token_burns } = payoutBuilder.build(payout_context, aggregate_payout_list, payout_rules, true);
  // construct the transaction
  const { result, source_outputs, payouts_info } = generateExchangeTx(compiler, pool_trade_list, input_coins, payout_outputs.map((a) => a.output), data_locking_bytecode);
  if (!result.success) {
    /* c8 ignore next */
    throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
  }
  return {
    txbin: libauth.encodeTransaction(result.transaction),
    txfee,
    payouts_info: payouts_info.map((a) => ({
      output: a.output,
      index: a.index,
      payout_rule: (payout_outputs.find((b) => b.output == a.output) as any).payout_rule as PayoutRule,
    })),
    token_burns,
    libauth_source_outputs: source_outputs,
    libauth_generated_transaction: result.transaction,
  };
};

export const validateTradePoolListAndCalcAggregatePayouts = (pool_trade_list: PoolTrade[], input_coins: SpendableCoin[]): Array<{ token_id: TokenId, amount: bigint }> => {
  const aggregate_balance_list: Array<{ token_id: TokenId, offer: bigint, take: bigint }> = [
    {
      token_id: NATIVE_BCH_TOKEN_ID,
      offer: 0n,
      take: 0n,
    },
  ];
  const getAggregateBalanceByTokenId = (token_id: TokenId): { token_id: TokenId, offer: bigint, take: bigint } => {
    const idx = aggregate_balance_list.findIndex((a) => a.token_id == token_id);
    let output: { token_id: TokenId, offer: bigint, take: bigint };
    if (idx == -1) {
      output = { token_id, offer: 0n, take: 0n };
      aggregate_balance_list.push(output);
    } else {
      output = aggregate_balance_list[idx] as any;
    }
    return output;
  };
  // validate pool_trade_list
  for (const pool_trade of pool_trade_list) {
    if (pool_trade.supply_token_id == NATIVE_BCH_TOKEN_ID) {
      if (pool_trade.demand_token_id == NATIVE_BCH_TOKEN_ID) {
        throw new ValueError('either demand_token_id or supply_token_id should be NATIVE_BCH_TOKEN_ID')
      }
      if (pool_trade.demand_token_id != pool_trade.pool.output?.token?.token_id) {
        throw new ValueError('expecting token token_id to be equal to pool_trade.demand_token_id: ' + pool_trade.demand_token_id)
      }
    } else {
      if (pool_trade.supply_token_id != pool_trade.pool.output?.token?.token_id) {
        throw new ValueError('expecting token token_id to be equal to pool_trade.supply_token_id: ' + pool_trade.supply_token_id)
      }
    }
    // verify supply/demand values are in line with K = x * y
    if (pool_trade.supply <= 0n || pool_trade.demand <= 0n) {
      throw new ValueError('pool_trade supply and demand should be greater than zero.')
    }
    const K = pool_trade.pool.output.amount * pool_trade.pool.output.token.amount;
    let pair_a_1, pair_b_1;
    if (pool_trade.supply_token_id == NATIVE_BCH_TOKEN_ID) {
      pair_a_1 = pool_trade.pool.output.amount + pool_trade.supply;
      pair_b_1 = pool_trade.pool.output.token.amount - pool_trade.demand;
      if ((pair_a_1 - pool_trade.trade_fee - 1n) * pair_b_1 >= K ||
        (pair_a_1 - pool_trade.trade_fee) * (pair_b_1 - 1n) >= K) {
        throw new ValueError('The given pool_trade supply/demand leaves surplus value in the pool.')
      }
    } else {
      pair_a_1 = pool_trade.pool.output.token.amount + pool_trade.supply;
      pair_b_1 = pool_trade.pool.output.amount - pool_trade.demand;
      if ((pair_a_1 - 1n) * (pair_b_1 - pool_trade.trade_fee) >= K ||
        pair_a_1 * (pair_b_1 - pool_trade.trade_fee - 1n) >= K) {
        throw new ValueError('The given pool_trade supply/demand leaves surplus value in the pool.')
      }
    }
    if (pair_a_1 < 1n || pair_b_1 < 1n) {
      throw new ValueError('The value of pool_trade supply or demand is invalid, out_of_bound.')
    }
    // apply the aggregate balance
    const token_aggregate_balance = getAggregateBalanceByTokenId(pool_trade.pool.output?.token?.token_id);
    const bch_aggregate_balance = getAggregateBalanceByTokenId(NATIVE_BCH_TOKEN_ID);
    if (pool_trade.supply_token_id == NATIVE_BCH_TOKEN_ID) {
      //bch_aggregate_balance.offer += pool_trade.supply + pool_trade.trade_fee;
      bch_aggregate_balance.offer += pool_trade.supply;
      token_aggregate_balance.take += pool_trade.demand;
    } else { // (pool_trade.demand_token_id == NATIVE_BCH_TOKEN_ID)
      token_aggregate_balance.offer += pool_trade.supply;
      //bch_aggregate_balance.offer += pool_trade.trade_fee;
      bch_aggregate_balance.take += pool_trade.demand;
    }
  }
  const aggregate_payout_list: Array<{ token_id: TokenId, amount: bigint }> = [];
  // verify enough funding is provided
  for (const entry of aggregate_balance_list) {
    const token_total_fund = entry.token_id == NATIVE_BCH_TOKEN_ID ?
      input_coins.reduce((a, b) => a + b.output.amount, 0n) :
      input_coins.reduce((a, b) => a + (b.output.token?.token_id == entry.token_id ? b.output.token.amount : 0n), 0n);
    if (token_total_fund < entry.offer - entry.take) {
      throw new ValueError(`Not enough funding provided, token: ${entry.token_id}, required funding: ${entry.offer}`)
    }
    // add the change to payout
    aggregate_payout_list.push({
      token_id: entry.token_id,
      amount: entry.take + (token_total_fund - entry.offer),
    });
  }
  // validate funding outputs
  const input_coins_by_token_id: Array<{ token_id: string, coins: Array<SpendableCoin<OutputWithFT>> }> = [];
  input_coins.forEach((coin) => {
    if (coin.output.token != null) {
      // force set the type, tcs throws not assignable error
      // even though it is being executed in if coin.output.token != null gaurd
      const ftcoin: SpendableCoin<OutputWithFT> = coin as any;
      let group = input_coins_by_token_id.find((a) => a.token_id == ftcoin.output.token.token_id);
      if (!group) {
        group = { token_id: ftcoin.output.token.token_id, coins: [] };
        input_coins_by_token_id.push(group);
      }
      group.coins.push(ftcoin);
    }
  });
  for (const { token_id, coins } of input_coins_by_token_id) {
    for (const coin of coins) {
      if (coin.output?.token?.nft) {
        throw new ValueError(`A provided funding coin has a defined nft, outpoint: ${libauth.binToHex(coin.outpoint.txhash)}:${coin.outpoint.index}`);
      }
    }
    const aggregate_payout = aggregate_payout_list.findIndex((a) => a.token_id == token_id);
    if (!aggregate_payout) {
      aggregate_payout_list.push({
        token_id,
        amount: coins.reduce((a, b) => a + b.output.token.amount, 0n),
      });
    }
  }
  return aggregate_payout_list;
};

const calcPoolTradeSizeInATx = (pool_trade: PoolTrade): number => {
  const token_amount: bigint = pool_trade.pool.output.token.amount  +
    (pool_trade.supply_token_id == NATIVE_BCH_TOKEN_ID ? pool_trade.demand * -1n : pool_trade.supply);
  // input size = txhash_size + index_size + sizeof_unlocking_size + unlocking_size + sequence_num_size
  const input_size = 32 + 4 + 1 + 69 + 4;
  // output size = amount_size + sizeof_locking_size + locking_size + token_category + token_amount_size
  const output_size = 8 + 1 + 35 + 34 + compactUintPrefixToLength(bigIntToCompactUint(token_amount)[0] as number);
  return input_size + output_size;
};

type CalcTxSizeCache = {
  size_map: WeakMap<object, number>
};

export const initCalcTxSizeCache = (): CalcTxSizeCache => {
  return { size_map: new WeakMap() }
};

export const calcTxSize = (pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], outputs: Output[], data_locking_bytecode: Uint8Array | null, cache: CalcTxSizeCache | undefined): number => {
  if (input_coins.reduce((a, b) => a + (b.type == SpendableCoinType.P2PKH ? 0 : 1), 0) > 0) {
    throw new Error('input_coins has an unsupported type!');
  }
  const pools_io_size = pool_trade_list.reduce((sum: number, item: PoolTrade) => {
    if (cache != null) {
      let size: number | undefined = cache.size_map.get(item);
      if (size == null) {
        size = calcPoolTradeSizeInATx(item);
        cache.size_map.set(item, size);
      }
      return sum + size;
    } else {
      return sum + calcPoolTradeSizeInATx(item);
    }
  }, 0);
  // sizeof inputs/outputs size
  const sizeof_inputs_size = compactUintPrefixToLength(bigIntToCompactUint(BigInt(input_coins.length + pool_trade_list.length))[0] as number);
  const sizeof_outputs_size = compactUintPrefixToLength(bigIntToCompactUint(BigInt(outputs.length + pool_trade_list.length + (data_locking_bytecode != null ? 1 : 0)))[0] as number);
  // unlocking code  <user_key.schnorr_signature.all_outputs>\n<user_key.public_key>
  const p2pkh_unlocking_size = 1 + 65 + 1 + 33;
  // input_size = txhash_size + index_size + sizeof_unlocking_size + unlocking_size + sequence_num_size
  const p2pkh_input_size = 32 + 4 + 1 + p2pkh_unlocking_size + 4;
  const inputs_size = input_coins.length * p2pkh_input_size;
  // outputs size
  let outputs_size = 0;
  for (const output of outputs) {
    const output_has_ft = output.token != null;
    outputs_size += 8 + compactUintPrefixToLength(bigIntToCompactUint(BigInt(output.locking_bytecode.length))[0] as number) + output.locking_bytecode.length + (output_has_ft ? 34 + compactUintPrefixToLength(bigIntToCompactUint((output as OutputWithFT).token.amount)[0] as number) : 0);
  }
  if (data_locking_bytecode != null) {
    outputs_size += 8 + compactUintPrefixToLength(bigIntToCompactUint(BigInt(data_locking_bytecode.length))[0] as number) + data_locking_bytecode.length;
  }
  // tx_size = tx_version_size + inputs_size + outputs_size + tx_locktime_size
  return 4 + sizeof_inputs_size + sizeof_outputs_size + pools_io_size + inputs_size + outputs_size + 4;
};

const constructPoolTxSIO = (pool_trade: PoolTrade): { source_output: libauth.Output, input: libauth.InputTemplate<libauth.CompilerBCH>, output: libauth.OutputTemplate<libauth.CompilerBCH> } => {
  const source_output = {
    lockingBytecode: pool_trade.pool.output.locking_bytecode,
    valueSatoshis: pool_trade.pool.output.amount,
    token: {
      amount: pool_trade.pool.output.token.amount as bigint,
      category: convertTokenIdToUint8Array(pool_trade.pool.output.token.token_id),
    },
  };
  /*
  const locking_data: libauth.CompilationData<never> = {
    bytecode: {
      pool_owner_public_key_hash160: pool_trade.pool.parameters.withdraw_pubkey_hash,
    },
  };
  const locking_bytecode_result = compiler.generateBytecode({
    data: locking_data,
    scriptId: 'cauldron_poolv0',
  });
  if (!locking_bytecode_result.success) {
    / * c8 ignore next * /
    throw new InvalidProgramState('generate locking code failed, script: cauldron_poolv0, ' + JSON.stringify(locking_bytecode_result, null, '  '))
  }
  const input = {
    outpointIndex: pool_trade.pool.outpoint.index,
    outpointTransactionHash: pool_trade.pool.outpoint.txhash,
    sequenceNumber: 0,
    unlockingBytecode: {
      compiler,
      script: 'cauldron_poolv0_exchange',
      data: {
        ...locking_data,
      },
      valueSatoshis: pool_trade.pool.output.amount,
      token: {
        amount: pool_trade.pool.output.token.amount,
        category: convertTokenIdToUint8Array(pool_trade.pool.output.token.token_id),
      },
    },
  };
  // locking_bytecode_result.bytecode,
  */
  // the unlock only needs the script of the p2sh32 to be pushed into the stack
  const unlocking_bytecode = buildPoolV0UnlockingBytecode(pool_trade.pool.parameters);
  const input = {
    outpointIndex: pool_trade.pool.outpoint.index,
    outpointTransactionHash: pool_trade.pool.outpoint.txhash,
    sequenceNumber: 0,
    unlockingBytecode: unlocking_bytecode,
  };
  const output = {
    lockingBytecode: pool_trade.pool.output.locking_bytecode,
    token: {
      amount: pool_trade.pool.output.token.amount  +
        (pool_trade.supply_token_id == NATIVE_BCH_TOKEN_ID ?
          pool_trade.demand * -1n : pool_trade.supply),
      category: convertTokenIdToUint8Array(pool_trade.pool.output.token.token_id),
    },
    valueSatoshis: pool_trade.pool.output.amount  +
      (pool_trade.supply_token_id == NATIVE_BCH_TOKEN_ID ?
        pool_trade.supply : pool_trade.demand * -1n),
  };
  return { input, output, source_output };
};

export const generateExchangeTx = (compiler: libauth.CompilerBCH, input_pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_outputs:  Output[], data_locking_bytecode: Uint8Array | null): { result: libauth.TransactionGenerationAttempt<libauth.AuthenticationProgramStateBCH>, source_outputs: libauth.Output[], payouts_info: Array<{ output: Output, index: number }> } => {
  const source_outputs: libauth.Output[] = [];
  const inputs: libauth.InputTemplate<libauth.CompilerBCH>[] = [];
  const outputs: libauth.OutputTemplate<libauth.CompilerBCH>[] = []
  for (const pool_trade of input_pool_trade_list) {
    const { source_output, input, output } = constructPoolTxSIO(pool_trade);
    source_outputs.push(source_output);
    inputs.push(input);
    outputs.push(output);
  }
  // add input coins
  for (const coin of input_coins) {
    if (coin.type == SpendableCoinType.P2PKH) {
      const source_output = {
        lockingBytecode: coin.output.locking_bytecode,
        valueSatoshis: coin.output.amount,
        token: coin.output.token ? {
          amount: coin.output.token.amount,
          category: convertTokenIdToUint8Array(coin.output.token.token_id),
        } : undefined,
      };
      const data: libauth.CompilationData<never> = {
        keys: {
          privateKeys: {
            user_key: coin.key,
          },
        },
      };
      const input = {
        outpointIndex: coin.outpoint.index,
        outpointTransactionHash: coin.outpoint.txhash,
        sequenceNumber: 0,
        unlockingBytecode: {
          compiler,
          script: 'p2pkh_unlock',
          data,
          valueSatoshis: coin.output.amount,
          token: !coin.output.token ? undefined : {
            amount: coin.output.token.amount,
            category: convertTokenIdToUint8Array(coin.output.token.token_id),
          },
        },
      };
      source_outputs.push(source_output);
      inputs.push(input);
    } else {
      throw new ValueError(`input_coin has an unknown type: ${coin.type}`)
    }
  }
  // add payout outputs
  const payouts_info: Array<{ output: Output, index: number }> = []
  for (const payout_output of payout_outputs) {
    const output = {
      lockingBytecode: payout_output.locking_bytecode,
      token: payout_output.token ? {
        amount: payout_output.token.amount,
        category: convertTokenIdToUint8Array(payout_output.token.token_id),
      } : undefined,
      valueSatoshis: payout_output.amount,
    };
    payouts_info.push({ output: payout_output, index: outputs.length });
    outputs.push(output);
  }
  // add data output
  if (data_locking_bytecode != null) {
    const output = {
      lockingBytecode: data_locking_bytecode,
      valueSatoshis: 0n,
    };
    outputs.push(output);
  }
  return {
    result: libauth.generateTransaction({
      locktime: 0,
      version: 2,
      inputs, outputs,
    }),
    source_outputs,
    payouts_info,
  };
};
