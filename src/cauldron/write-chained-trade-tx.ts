import type { Fraction, TokenId, PayoutRule, OutputWithFT, SpendableCoin } from '../common/types.js';
import { NATIVE_BCH_TOKEN_ID, SpendableCoinType } from '../common/constants.js';
import { bigIntArraySortPolyfill } from '../common/util.js';
import { InvalidProgramState, ValueError } from '../common/exceptions.js';
import { writeTradeTx } from './write-trade-tx.js';
import * as libauth from '@bitauth/libauth';
import type {
  BCHCauldronContext, PoolTrade, WriteChainedTradeTxController, TradeTxResult,
  GenerateChainedTradeTxResult,
} from './types.js';
import { calcTradeAvgRate, sizeOfPoolV0InAnExchangeTx } from './util.js';

export const writeChainedTradeTx = async (context: BCHCauldronContext, compiler: libauth.CompilerBCH, pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_rules: PayoutRule[], data_locking_bytecode: Uint8Array | null, txfee_per_byte: number | bigint, controller?: WriteChainedTradeTxController): Promise<TradeTxResult[]> => {
  const rate_denominator = context.getRateDenominator();
  const grouped_entries_with_rate: Array<{ supply_token_id: TokenId, demand_token_id: TokenId, list: Array<{ item: PoolTrade, rate: Fraction }> }> = [];
  for (const input_pool_trade of pool_trade_list) {
    let entries = grouped_entries_with_rate.find((a) => input_pool_trade.supply_token_id == a.supply_token_id && input_pool_trade.demand_token_id == a.demand_token_id);
    if (entries == null) {
      entries = { supply_token_id: input_pool_trade.supply_token_id, demand_token_id: input_pool_trade.demand_token_id, list: [] };
      grouped_entries_with_rate.push(entries);
    }
    entries.list.push({ item: input_pool_trade, rate: calcTradeAvgRate(input_pool_trade, rate_denominator) });
  }
  for (const entries of grouped_entries_with_rate) {
    bigIntArraySortPolyfill(entries.list, (a, b) => a.rate.numerator - b.rate.numerator);
  }
  const trade_tx_chain: TradeTxResult[] = [];
  let grouped_entries: Array<{ supply_token_id: TokenId, demand_token_id: TokenId, list: PoolTrade[] }> = grouped_entries_with_rate.map((a) => ({ supply_token_id: a.supply_token_id, demand_token_id: a.demand_token_id, list: a.list.map((b) => b.item) }));
  let available_input_coins: SpendableCoin[] = input_coins;
  while (grouped_entries.reduce((a, b) => a + b.list.length, 0) > 0) {
    let result: GenerateChainedTradeTxResult = writeChainedExchangeTxSub(grouped_entries, available_input_coins, [...payout_rules], controller);
    if (typeof controller?.generateMiddleware == 'function') {
      result = await controller.generateMiddleware(result, grouped_entries, available_input_coins)
    }
    if (result.pool_trade_list.length == 0) {
      break; // done
    }
    grouped_entries = result.remained_grouped_entries;
    const trade_tx: TradeTxResult = writeTradeTx(context, compiler, result.pool_trade_list, result.input_coins, result.payout_rules, data_locking_bytecode, txfee_per_byte);
    // extract spendable
    const trade_txhash = libauth.hashTransactionUiOrder(trade_tx.txbin);
    const payout_coins = trade_tx.payouts_info.map((a) => {
      if (a.payout_rule.spending_parameters == null) {
        return null;
      }
      if (a.payout_rule.spending_parameters.type != SpendableCoinType.P2PKH) {
        throw new ValueError(`Unknown spending_paramters.type in a payout_rule: ${a.payout_rule.spending_parameters.type}`);
      }
      return {
        type: a.payout_rule.spending_parameters.type,
        output: a.output,
        outpoint: {
          index: a.index,
          txhash: trade_txhash,
        },
        key: a.payout_rule.spending_parameters.key
      };
    }).filter((a) => !!a) as SpendableCoin[];
    if (typeof controller?.didGenerateTx == 'function') {
      controller.didGenerateTx(trade_tx, payout_coins);
    }
    let unused_input_coins = available_input_coins.filter((a) => result.input_coins.indexOf(a) == -1);
    trade_tx_chain.push(trade_tx);
    available_input_coins = [
      ...unused_input_coins,
      ...payout_coins,
    ];
  }
  return trade_tx_chain;
}


const writeChainedExchangeTxSub = (grouped_entries: Array<{ supply_token_id: TokenId, demand_token_id: TokenId, list: PoolTrade[] }>, input_coins: SpendableCoin[], payout_rules: PayoutRule[], controller?: WriteChainedTradeTxController): GenerateChainedTradeTxResult => {
  // copy input arguments
  grouped_entries = grouped_entries.map((a) => Object.assign({}, a, { list: a.list.slice() }));
  const popFromEntryStack = () => {
    const entries = grouped_entries.find((a) => a.list.length > 0);
    if (entries == null) {
      return null;
    }
    return entries.list.pop();
  };
  const pushToEntryStack = (entry: PoolTrade) => {
    const entries = grouped_entries.find((a) => a.supply_token_id == entry.supply_token_id && a.demand_token_id == entry.demand_token_id);
    if (entries == null) {
      throw new InvalidProgramState(`Expecting grouped_entries to have the entry that is being push to the!`);
    }
    entries.list.push(entry);
  };
  const getAggregateBalanceForToken = (aggregate_balance_list: Array<{ token_id: TokenId, balance: bigint }>, token_id: TokenId): { token_id: TokenId, balance: bigint } => {
    const idx = aggregate_balance_list.findIndex((a) => a.token_id == token_id);
    let output: { token_id: TokenId, balance: bigint };
    if (idx == -1) {
      output = { token_id, balance: 0n };
      aggregate_balance_list.push(output);
    } else {
      output = aggregate_balance_list[idx] as any;
    }
    return output;
  };
  const inputCoinsToHavePositiveBalance = (aggregate_balance_list: Array<{ token_id: TokenId, balance: bigint }>, input_coins: SpendableCoin[]): SpendableCoin[] => {
    aggregate_balance_list = structuredClone(aggregate_balance_list);
    const aggbal_list = aggregate_balance_list.filter((a) => a.balance < 0n);
    if (aggbal_list.length == 0) {
      return [];
    }
    const native_bch_aggregate_balance = getAggregateBalanceForToken(aggregate_balance_list, NATIVE_BCH_TOKEN_ID);
    let prevent_default = false;
    const preventDefault = () => prevent_default = true;
    let output: SpendableCoin[] = [];
    if (typeof controller?.inputCoinsToHavePositiveBalance == 'function') {
      output = controller.inputCoinsToHavePositiveBalance(structuredClone(aggbal_list), input_coins.slice(), { preventDefault });
      for (const coin of output) {
        if (input_coins.indexOf(coin) == -1) {
          throw new ValueError(`inputCoinsToHavePositiveBalance's output should come from the input_coins that has been passed as its argument`);
        }
        native_bch_aggregate_balance.balance += coin.output.amount;
        if (coin.output.token != null) {
          getAggregateBalanceForToken(aggregate_balance_list, coin.output.token.token_id).balance += coin.output.token.amount;
        }
      }
    } else {
      output = []
    }
    if (prevent_default) {
      return output;
    }
    for (const aggbal of aggbal_list) {
      const sub_input_coins = aggbal.token_id == NATIVE_BCH_TOKEN_ID ? input_coins :
        input_coins.filter((a) => a.output?.token?.token_id == aggbal.token_id && output.indexOf(a) == -1);
      if (aggbal.token_id == NATIVE_BCH_TOKEN_ID) {
        bigIntArraySortPolyfill(sub_input_coins, (a, b) => b.output.amount - a.output.amount);
      } else {
        bigIntArraySortPolyfill(sub_input_coins, (a, b) => (b.output as OutputWithFT).token.amount - (a.output as OutputWithFT).token.amount);
      }
      for (const input_coin of sub_input_coins) {
        if (aggbal.balance >= 0n) {
          break // cleared
        }
        native_bch_aggregate_balance.balance += input_coin.output.amount;
        if (input_coin.output.token != null) {
          getAggregateBalanceForToken(aggregate_balance_list, input_coin.output.token.token_id).balance += input_coin.output.token.amount;
        }
        output.push(input_coin);
      }
    }
    return output;
  }
  const poolsToClearAggregateBalance = (aggregate_balance_list: Array<{ token_id: TokenId, balance: bigint }>, input_coins: SpendableCoin[]): { pools_info: Array<{ entries: any[], item: PoolTrade, index: number }>, input_coins: SpendableCoin[] }  => {
    const addToIncludedInputCoins = () => {
      const sub_input_coins = input_coins.filter((a) => included_input_coins.indexOf(a) == -1);
      for (const input_coin of inputCoinsToHavePositiveBalance(aggregate_balance_list, sub_input_coins)) {
        bch_aggbal.balance += input_coin.output.amount;
        if (input_coin.output.token != null) {
          getAggregateBalanceForToken(aggregate_balance_list, input_coin.output.token.token_id).balance += input_coin.output.token.amount;
        }
        included_input_coins.push(input_coin);
      }
    };
    let max_clear_attempts = 5;
    let pools_info: Array<{ entries: any[], item: PoolTrade, index: number }> = [];
    let included_input_coins: SpendableCoin[] = [];
    const bch_aggbal = getAggregateBalanceForToken(aggregate_balance_list, NATIVE_BCH_TOKEN_ID);
    while (true) {
      const aggbal_list = aggregate_balance_list.filter((a) => a.balance < 0n);
      if (aggbal_list.length == 0) {
        break; // all clear
      }
      if (max_clear_attempts-- < 0) {
        throw new ValueError(`max clear balance attempts reached!`);
      }
      for (const aggbal of aggbal_list) {
        const counter_entries = grouped_entries.find((a) => a.demand_token_id == aggbal.token_id);
        if (counter_entries == null) {
          break;
        }
        const counter_entries_enum = counter_entries.list.map((a, i) => [ i, a ]);
        while (true) {
          const next_counter_entry_enum = counter_entries_enum.find((a) => pools_info.find((b) => b.item == a[1]) == null);
          if (next_counter_entry_enum == null) {
            break;
          }
          const counter_item: PoolTrade = next_counter_entry_enum[1] as PoolTrade;
          pools_info.push({ index: next_counter_entry_enum[0] as number, item: counter_item, entries: counter_entries.list });
          getAggregateBalanceForToken(aggregate_balance_list, counter_item.supply_token_id).balance -= counter_item.supply;
          aggbal.balance += counter_item.demand;
          if (aggbal.balance >= 0n) {
            break;
          }
          addToIncludedInputCoins();
        }
        if (aggbal.balance >= 0n) {
          break;
        }
      }
      addToIncludedInputCoins();
    }
    return { pools_info, input_coins: included_input_coins };
  };
  const max_tx_size: bigint = 100000n;
  const txsize_reserve: bigint = 500n;
  const aninput_coin_size: bigint = 150n;
  const anoutput_size: bigint = 100n;
  let size = txsize_reserve;
  let aggregate_balance_list: Array<{ token_id: TokenId, balance: bigint }> = [];
  const included_tokens_id: TokenId[] = [ NATIVE_BCH_TOKEN_ID ];
  const output: GenerateChainedTradeTxResult = { remained_grouped_entries: grouped_entries, input_coins: [], pool_trade_list: [], payout_rules };
  while (true) {
    const entry = popFromEntryStack();
    if (entry == null) {
      break; // done
    }
    const next_aggregate_balance_list = structuredClone(aggregate_balance_list);
    getAggregateBalanceForToken(next_aggregate_balance_list, entry.supply_token_id).balance -= entry.supply;
    getAggregateBalanceForToken(next_aggregate_balance_list, entry.demand_token_id).balance += entry.demand;
    const sub_input_coins = input_coins.filter((a) => output.input_coins.indexOf(a) == -1);
    const counter_balance_data = poolsToClearAggregateBalance(next_aggregate_balance_list, sub_input_coins);
    { // add to included_tokens_id
      for (const pool of [entry, ...counter_balance_data.pools_info.map((a) => a.item)]) {
        if (included_tokens_id.indexOf(pool.supply_token_id) == -1) {
          included_tokens_id.push(pool.supply_token_id);
        }
        if (included_tokens_id.indexOf(pool.demand_token_id) == -1) {
          included_tokens_id.push(pool.demand_token_id);
        }
      }
      for (const input_coin of counter_balance_data.input_coins) {
        if (input_coin.output.token != null) {
          if (included_tokens_id.indexOf(input_coin.output.token.token_id) == -1) {
            included_tokens_id.push(input_coin.output.token.token_id);
          }
        }
      }
    }
    let next_size = size +
      sizeOfPoolV0InAnExchangeTx() * (1n + BigInt(counter_balance_data.pools_info.length)) + // pools
      aninput_coin_size * BigInt(counter_balance_data.input_coins.length); // input coins
    // expected payout count
    const expected_payout_output_size = anoutput_size * BigInt(included_tokens_id.length)
    if (next_size + expected_payout_output_size > max_tx_size) {
      pushToEntryStack(entry);
      break; // reached the limit
    }
    output.pool_trade_list.push(entry);
    while (true) {
      const c_pool_info = counter_balance_data.pools_info.pop();
      if (c_pool_info == null) {
        break;
      }
      if (c_pool_info.entries.splice(c_pool_info.index, 1)[0] != c_pool_info.item) {
        /* c8 ignore next */
        throw new InvalidProgramState(`c_pool_info.entries.splice(c_pool_info.index, 1)[0] != c_pool_info.item`)
      }
      output.pool_trade_list.push(c_pool_info.item);
    }
    for (const c_input_coin of counter_balance_data.input_coins) {
      output.input_coins.push(c_input_coin);
    }
    aggregate_balance_list = next_aggregate_balance_list;
    size = next_size;
  }
  return output;
};
