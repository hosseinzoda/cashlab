import type { TokenId, PayoutRule, Output, OutputWithFT, SpendableCoin } from '../common/types.js';
import { NATIVE_BCH_TOKEN_ID, SpendableCoinType, PayoutAmountRuleType } from '../common/constants.js';
import { InvalidProgramState, ValueError, BurnTokenException, InsufficientFunds } from '../common/exceptions.js';
import { convertTokenIdToUint8Array } from '../common/util.js';
import * as libauth from '@bitauth/libauth';
const { compactUintPrefixToLength, bigIntToCompactUint } = libauth;
import { buildPoolV0UnlockingBytecode } from './binutil.js';
import type { BCHCauldronContext, PoolTrade, TradeTxResult } from './types.js';

export const writeTradeTx = (context: BCHCauldronContext, compiler: libauth.CompilerBCH, pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_rules: PayoutRule[], data_locking_bytecode: Uint8Array | null, txfee_per_byte: number | bigint): TradeTxResult => {
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
  const { payout_outputs, txfee, token_burns } = buildPayoutOutputs(context, payout_rules, aggregate_payout_list, calcTxFeeWithOutputs, true);
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

export const buildPayoutOutputs = (context: BCHCauldronContext, payout_rules: PayoutRule[], aggregate_payout_list: Array<{ token_id: TokenId, amount: bigint }>, calcTxFeeWithOutputs: (outputs: Output[]) => bigint, verify_payouts_are_paid: boolean): { txfee: bigint, payout_outputs: Array<{ output: Output, payout_rule: PayoutRule }>, token_burns: Array<{ token_id: TokenId, amount: bigint }> } => {
  aggregate_payout_list = structuredClone(aggregate_payout_list);
  const token_burns: Array<{ token_id: TokenId, amount: bigint }> = [];
  const payout_outputs: Array<{ output: Output, payout_rule: PayoutRule }> = [];
  const payout_type_precedence = Object.fromEntries([
    [ PayoutAmountRuleType.FIXED, 2 ],
    [ PayoutAmountRuleType.CHANGE, 1 ],
  ]);
  const sorted_payout_rules: PayoutRule[] = Array.from(payout_rules).sort((a, b) => {
    let bval: number = payout_type_precedence[b.type] as number;
    let aval: number = payout_type_precedence[a.type] as number;
    if (bval == null) {
      bval = -1;
    }
    if (aval == null) {
      aval = -1;
    }
    return bval - aval;
  });
  let txfee: bigint = 0n;
  let txfee_paid = false;
  for (const payout_rule of sorted_payout_rules) {
    if (payout_rule.type == PayoutAmountRuleType.FIXED) {
      const output = {
        locking_bytecode: payout_rule.locking_bytecode,
        token: payout_rule.token ? {
          amount: payout_rule.token.amount,
          token_id: payout_rule.token.token_id,
        } : undefined,
        amount: payout_rule.amount,
      };
      const bch_payout = aggregate_payout_list.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID);
      if (bch_payout == null) {
        /* c8 ignore next */
        throw new InvalidProgramState('native token is not in aggregate_payout_list!!')
      }
      const min_amount = context.getOutputMinAmount(output);
      if (output.amount == -1n) {
        let amount = null;
        if (payout_rule.token != null) {
          amount = context.getPreferredTokenOutputBCHAmount(output);
        }
        if (amount == null) {
          // set the amount to dust limit if amount is -1
          amount = min_amount;
        }
        output.amount = amount;
      }
      if (output.amount < min_amount) {
        throw new ValueError(`Amount of a fixed payout rule is less than min amount (dust limit), amount: ${payout_rule.amount}, min: ${min_amount}`);
      }
      if (payout_rule.amount > output.amount) {
        throw new ValueError(`Cannot satisfy a fixed payout rule, not enough satoshis in the payout. amount: ${payout_rule.amount}`);
      }
      if (payout_rule.token != null) {
        const payout_rule_token = payout_rule.token;
        const token_payout = aggregate_payout_list.find((a) => a.token_id == payout_rule_token.token_id);
        if (token_payout == null) {
          throw new ValueError(`Cannot satisfy a fixed token payout rule, token_id: ${payout_rule_token.token_id}`);
        }
        if (payout_rule_token.amount <= 0n) {
          throw new ValueError(`Token amount of a fixed payout rule is less than or equal to zero, token_id: ${payout_rule_token.token_id}, amount: ${payout_rule_token.amount}`);
        }
        if (payout_rule_token.amount > token_payout.amount) {
          throw new ValueError(`Cannot satisfy a fixed payout rule, not enough tokens in the payout. token_id: ${payout_rule_token.token_id}, amount: ${payout_rule_token.amount}`);
        }
        if ((payout_rule_token as any).nft) {
          throw new ValueError(`nft is defined in a payout_rule, nft payouts are not supported. token_id: ${payout_rule_token.token_id}`);
        }
        // output.token.amount should have a value, as bigint is used to force the compiler to accept the value
        token_payout.amount -= payout_rule_token.amount
      }
      bch_payout.amount -= output.amount;
      payout_outputs.push({ output, payout_rule });
    } else if (payout_rule.type == PayoutAmountRuleType.CHANGE) {
      let mixed_payout: { bch: { token_id: TokenId, amount: bigint }, token: { token_id: TokenId, amount: bigint } } | undefined;
      // an initial value assigned cause, tsc emitting used before being assigned.
      let payouts: Array<{ token_id: TokenId, amount: bigint }> = [];
      const native_payout = aggregate_payout_list.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID);
      if (!native_payout) {
        /* c8 ignore next */
        throw new InvalidProgramState('native token is not in aggregate_payout_list!!')
      }
      if (payout_rule.allow_mixing_native_and_token) {
        const other_tokens_payout_list = aggregate_payout_list.filter((a) => a.token_id != NATIVE_BCH_TOKEN_ID);
        let chosen_token_idx = -1;
        for (let i = 0; i < other_tokens_payout_list.length; ) {
          const entry = other_tokens_payout_list[i];
          if (entry == null) {
            i++;
            continue;
          }
          try {
            if (typeof payout_rule.shouldBurn == 'function') {
              payout_rule.shouldBurn(entry.token_id, entry.amount);
            }
            chosen_token_idx = i;
            break;
          } catch (err) {
            if (err instanceof BurnTokenException) {
              i++;
            } else {
              throw err;
            }
          }
        }
        if (chosen_token_idx != -1) {
          mixed_payout = {
            bch: native_payout,
            // tsc does not get that value of index 0 has a value, relax the type checking
            token: other_tokens_payout_list[chosen_token_idx] as any,
          };
          payouts = [ ...other_tokens_payout_list.slice(0, chosen_token_idx), ...other_tokens_payout_list.slice(chosen_token_idx + 1) ];
        }
      }
      if (!mixed_payout) {
        // place native token payout at the end
        payouts = aggregate_payout_list.filter((a) => a.token_id != NATIVE_BCH_TOKEN_ID);
        payouts.push(native_payout);
      }
      for (const payout of payouts) {
        if (payout.amount > 0n) {
          if (payout.token_id == NATIVE_BCH_TOKEN_ID) {
            // if executed, this payout is the last payout
            txfee = calcTxFeeWithOutputs([
              ...payout_outputs.map((a) => a.output),
              {
                locking_bytecode: payout_rule.locking_bytecode,
                amount: payout.amount,
              },
            ]);
            if (!txfee_paid) {
              if (payout.amount < txfee) {
                const required_amount = txfee - payout.amount;
                throw new InsufficientFunds(`Not enough change remained to pay the transaction fee, fee = ${txfee}, required amount: ${required_amount}`, { required_amount });
              }
              if (payout.amount > txfee) {
                const payout_output = {
                  locking_bytecode: payout_rule.locking_bytecode,
                  amount: payout.amount - txfee,
                };
                const min_amount = context.getOutputMinAmount(payout_output);
                if (payout_output.amount - txfee < min_amount) {
                  const required_amount = min_amount - (payout_output.amount - txfee);
                  throw new InsufficientFunds(`Not enough satoshis left to have the min amount in a (change) output, min: ${min_amount}, txfee: ${txfee}, required amount: ${required_amount}`, { required_amount });
                }
                payout_outputs.push({ output: payout_output, payout_rule });
              }
            } else {
              const payout_output = {
                locking_bytecode: payout_rule.locking_bytecode,
                amount: payout.amount,
              };
              const min_amount = context.getOutputMinAmount(payout_output);
              if (payout_output.amount < min_amount) {
                const required_amount = min_amount - payout_output.amount;
                throw new InsufficientFunds(`Not enough satoshis left to have the min amount in a (change) output, min: ${min_amount}, required amount: ${required_amount}`, { required_amount });
              }
              payout_outputs.push({ output: payout_output, payout_rule });
            }
            txfee_paid = true;
          } else {
            try {
              if (typeof payout_rule.shouldBurn == 'function') {
                payout_rule.shouldBurn(payout.token_id, payout.amount);
              }
              const output = {
                locking_bytecode: payout_rule.locking_bytecode,
                token: {
                  amount: payout.amount,
                  token_id: payout.token_id,
                },
                amount: 0n,
              }
              let utxo_bch_amount: bigint | null =  context.getPreferredTokenOutputBCHAmount(output);
              if (utxo_bch_amount == null || native_payout.amount < utxo_bch_amount) {
                utxo_bch_amount = context.getOutputMinAmount(output);
              }
              if (native_payout.amount < utxo_bch_amount) {
                const required_amount = utxo_bch_amount - native_payout.amount;
                throw new InsufficientFunds(`Not enough satoshis left to allocate min bch amount in a token (change) output, required amount: ${required_amount}`, { required_amount });
              }
              output.amount = utxo_bch_amount;
              payout_outputs.push({ output, payout_rule });
              native_payout.amount -= output.amount;
            } catch (err) {
              if (err instanceof BurnTokenException) {
                token_burns.push({ token_id: payout.token_id, amount: payout.amount });
              } else {
                throw err;
              }
            }
          }
          payout.amount = 0n;
        }
      }
      if (mixed_payout) {
        // if executed, this payout is the last payout
        txfee = calcTxFeeWithOutputs([
          ...payout_outputs.map((a) => a.output),
          {
            locking_bytecode: payout_rule.locking_bytecode,
            token: {
              amount: mixed_payout.token.amount,
              token_id: mixed_payout.token.token_id,
            },
            amount: mixed_payout.bch.amount,
          },
        ]);
        if (!txfee_paid && mixed_payout.bch.amount < txfee) {
          const required_amount = txfee - mixed_payout.bch.amount;
          throw new InsufficientFunds(`Not enough change remained to pay the tx fee, fee = ${txfee}, required amount: ${required_amount}`, { required_amount });
        }
        const payout_output = {
          locking_bytecode: payout_rule.locking_bytecode,
          token: {
            amount: mixed_payout.token.amount,
            token_id: mixed_payout.token.token_id,
          },
          amount: mixed_payout.bch.amount - txfee,
        };
        const min_amount = context.getOutputMinAmount(payout_output);
        if (payout_output.amount - txfee < min_amount) {
          const required_amount = min_amount - payout_output.amount;
          throw new InsufficientFunds(`Not enough satoshis left to have the min amount in a mixed (change) output, min: ${min_amount}, required amount: ${required_amount}`, { required_amount });
        }
        txfee_paid = true;
        payout_outputs.push({ output: payout_output, payout_rule });
        mixed_payout.bch.amount = 0n;
        mixed_payout.token.amount = 0n;
      }
    } else {
      const payout_rule_type = (payout_rule as any).type;
      throw new ValueError(`Invalid payout_rule.type: ${payout_rule_type}`)
    }
  }
  // verify nothing has left in the aggregate_payout_list
  if (verify_payouts_are_paid) {
    for (const aggregate_payout of aggregate_payout_list) {
      if (aggregate_payout.token_id == NATIVE_BCH_TOKEN_ID && !txfee_paid &&
          aggregate_payout.amount <= txfee) {
        // exclude from the check if the txfee is not paid and the left out payout is lower than or equal to txfee
        continue;
      }
      if (aggregate_payout.amount != 0n) {
        let burned = false;
        const token_burn = token_burns.find((a) => a.token_id == aggregate_payout.token_id);
        if (token_burn != null && token_burn.amount >= aggregate_payout.amount) {
          burned = true;
        }
        if (!burned) {
          throw new ValueError(`payout_rules is not collecting the aggregate payouts from the exchange, unpaid token_id: ${aggregate_payout.token_id}, amount: ${aggregate_payout.amount}`)
        }
      }
    }
  }
  return { txfee, payout_outputs, token_burns };
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
