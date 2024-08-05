import type {
  Fraction, TokenId, PayoutRule, Output, SpendableCoin,
} from '../common/types.js';
import { NATIVE_BCH_TOKEN_ID } from '../common/constants.js';
import {
  convertTokenIdToUint8Array, bigIntMax,
  bigIntArraySortPolyfill, convertFractionDenominator,
} from '../common/util.js';
import type {
  PoolV0, PoolV0Parameters, PoolTrade, TradeResult, TradeTxResult, TradeSummary, AbstractTrade,
  WriteChainedTradeTxController,
} from './types.js';
import { ExceptionRegistry, Exception, InvalidProgramState, ValueError, NotFoundError, InsufficientFunds } from '../common/exceptions.js';
import cauldron_libauth_template_data from './cauldron-libauth-template.json' assert { type: "json" };
import * as libauth from '@bitauth/libauth';
import { writeTradeTx } from './write-trade-tx.js';
import { writeChainedTradeTx } from './write-chained-trade-tx.js';
import {
  PoolPair, calcPairRate, calcTradeSummary, sizeOfPoolV0InAnExchangeTx,
  calcTradeWithTargetSupplyFromAPair,
  approxAvailableAmountInAPairAtTargetAvgRate, approxAvailableAmountInAPairAtTargetRate,
  fillTradeToTargetDemandFromPairsWithFillingStepper, bestRateToTradeInPoolsForTargetDemand,
  eliminateNetNegativePoolsInATradeWithTargetDemand,
  requiredSupplyToMaxOutAPair,
  bestRateToTradeInPoolsForTargetSupply,
  eliminateNetNegativePoolsInATradeWithTargetSupply,
  fillTradeToTargetSupplyFromPairsWithFillingStepper,
} from './util.js';

const defaultOutputMinBCHReserve = (): bigint => 693n;

export class InsufficientCapitalInPools extends Exception { };
ExceptionRegistry.add('InsufficientCapitalInPools', InsufficientCapitalInPools);

const prepareForARequestToConstructTrade = (exlab: ExchangeLab, supply_token_id: TokenId, demand_token_id: TokenId, input_pools: PoolV0[]): { pools_pair: Array<PoolPair & { pool: PoolV0 }> } => {
  const pools_pair: Array<PoolPair & { pool: PoolV0 }> = [];
  if (demand_token_id == NATIVE_BCH_TOKEN_ID) {
    for (const pool of input_pools) {
      pools_pair.push({
        a: pool.output.token.amount,
        b: pool.output.amount,
        a_min_reserve: exlab.getMinTokenReserve(supply_token_id),
        b_min_reserve: exlab.getMinTokenReserve(demand_token_id),
        fee_paid_in_a: false,
        pool,
      })
    }
  } else {
    for (const pool of input_pools) {
      pools_pair.push({
        a: pool.output.amount,
        b: pool.output.token.amount,
        a_min_reserve: exlab.getMinTokenReserve(supply_token_id),
        b_min_reserve: exlab.getMinTokenReserve(demand_token_id),
        fee_paid_in_a: true,
        pool,
      })
    }
  }
  input_pools.forEach((pool) => {
    if (supply_token_id == NATIVE_BCH_TOKEN_ID) {
      if (demand_token_id == NATIVE_BCH_TOKEN_ID) {
        throw new ValueError('either demand_token_id or supply_token_id should be NATIVE_BCH_TOKEN_ID')
      }
      if (demand_token_id != pool.output?.token?.token_id) {
        throw new ValueError('expecting all input_pools to have token with the token_id equal to demand_token_id: ' + demand_token_id)
      }
    } else {
      if (demand_token_id != NATIVE_BCH_TOKEN_ID) {
        throw new ValueError('either demand_token_id or supply_token_id should be NATIVE_BCH_TOKEN_ID')
      }
      if (supply_token_id != pool.output?.token?.token_id) {
        throw new ValueError('expecting all input_pools to have token with the token_id equal to supply_token_id: ' + supply_token_id)
      }
    }
  });
  return { pools_pair };
};

export default class ExchangeLab {
  _rate_denominator: bigint;
  _template: libauth.WalletTemplate;
  _compiler: libauth.CompilerBCH;
  constructor () {
    // default lab parameters
    this._rate_denominator = 10000000000n;
    // init libauth cauldron template compiler
    const template_result = libauth.importWalletTemplate(cauldron_libauth_template_data);
    if (typeof template_result == 'string') {
      /* c8 ignore next */
      throw new InvalidProgramState(`Failed import libauth template, error: ${template_result}`)
    }
    this._template = template_result;
    this._compiler = libauth.walletTemplateToCompilerBCH(this._template);
  }
  setRateDenominator (denominator: bigint) {
    this._rate_denominator = denominator;
  }
  getRateDenominator (): bigint {
    return this._rate_denominator;
  }
  getOutputMinAmount (output: Output): bigint {
    const lauth_output: libauth.Output = {
      lockingBytecode: output.locking_bytecode,
      valueSatoshis: output.amount,
      token: output.token != null ? {
        amount: output.token.amount as bigint,
        category: convertTokenIdToUint8Array(output.token.token_id),
        nft: output.token.nft != null ? {
          capability: output.token.nft.capability,
          commitment: output.token.nft.commitment,
        } : undefined,
      } : undefined,
    };
    return libauth.getDustThreshold(lauth_output);
  }
  getMinTokenReserve (token_id: TokenId): bigint {
    // min token reserve should be greater than zero
    if (token_id == NATIVE_BCH_TOKEN_ID) {
      return defaultOutputMinBCHReserve()
    } else {
      return 1n;
    }
  }

  reconstructTradePoolsByReducingSupply (pool_trade_list: PoolTrade[], reduce_supply: bigint): PoolTrade[] {
    bigIntArraySortPolyfill(pool_trade_list, (a, b) => b.supply - a.supply);
    const reduce_per_pool = bigIntMax(1n, reduce_supply / BigInt(pool_trade_list.length));
    let reduced_supply = 0n;
    // eliminate
    let index = pool_trade_list.length - 1;
    while (index >= 0 && reduced_supply < reduce_supply) {
      const pool_trade: PoolTrade = pool_trade_list[index] as PoolTrade;
      if (pool_trade.supply <= reduce_supply - reduced_supply) {
        // eliminate
        pool_trade_list.splice(index, 1);
        reduced_supply += pool_trade.supply;
        index--;
      } else {
        break;
      }
    }
    // reduce
    index = 0;
    while (index < pool_trade_list.length && reduced_supply < reduce_supply) {
      const pool_trade: PoolTrade = pool_trade_list[index] as PoolTrade;
      if (pool_trade.supply <= reduce_per_pool) {
        pool_trade_list.splice(index, 1);
        reduced_supply += pool_trade.supply;
      } else {
        const supply_bch = pool_trade.supply_token_id == NATIVE_BCH_TOKEN_ID;
        const pair: PoolPair = {
          a: supply_bch ? pool_trade.pool.output.amount : pool_trade.pool.output.token.amount,
          b: !supply_bch ? pool_trade.pool.output.amount : pool_trade.pool.output.token.amount,
          a_min_reserve: this.getMinTokenReserve(pool_trade.supply_token_id),
          b_min_reserve: this.getMinTokenReserve(pool_trade.demand_token_id),
          fee_paid_in_a: supply_bch,
        };
        let new_supply = pool_trade.supply - reduce_per_pool;
        const new_trade = calcTradeWithTargetSupplyFromAPair(pair, new_supply);
        reduced_supply += pool_trade.supply - (new_trade != null ? new_trade.supply : 0n);
        if (new_trade == null) {
          pool_trade_list.splice(index, 1);
        } else {
          pool_trade_list.splice(index, 1, {
            ...pool_trade,
            supply: new_trade.supply,
            demand: new_trade.demand,
            trade_fee: new_trade.trade_fee,
          });
          index++;
        }
      }
      if (index >= pool_trade_list.length) {
        index = 0;
      }
    }
    return pool_trade_list;
  }

  constructTradeAvailableAmountBelowTargetRate (supply_token_id: TokenId, demand_token_id: TokenId, rate: Fraction, input_pools: PoolV0[]): TradeResult | null {
    const target_rate = convertFractionDenominator(rate, this._rate_denominator);
    const { pools_pair } = prepareForARequestToConstructTrade(this, supply_token_id, demand_token_id, input_pools);
    const result_entries: PoolTrade[] = [];
    for (const pool_pair of pools_pair) {
      const lower_bound = 1n;
      const upper_bound = pool_pair.b - pool_pair.b_min_reserve + 1n;
      const trade = approxAvailableAmountInAPairAtTargetRate(pool_pair, target_rate, lower_bound, upper_bound);
      if (trade != null && trade.demand > 0n) {
        result_entries.push({
          pool: pool_pair.pool,
          supply_token_id, demand_token_id,
          supply: trade.supply,
          demand: trade.demand,
          trade_fee: trade.trade_fee,
        });
      }
    }
    // sort pools by its liquidity depth in descending order
    bigIntArraySortPolyfill(result_entries, (a, b) => b.demand - a.demand);
    return result_entries.length > 0 ? {
      entries: result_entries,
      summary: calcTradeSummary(result_entries, this._rate_denominator) as TradeSummary,
    } : null;
  }
  /*
    Calculate available amount that can be taken from input_pools for the target avg rate
   */
  constructTradeAvailableAmountForTargetAvgRate (supply_token_id: TokenId, demand_token_id: TokenId, rate: Fraction, input_pools: PoolV0[]): TradeResult | null {
    const target_rate = convertFractionDenominator(rate, this._rate_denominator);
    const { pools_pair } = prepareForARequestToConstructTrade(this, supply_token_id, demand_token_id, input_pools);
    const result_entries: PoolTrade[] = [];
    for (const pool_pair of pools_pair) {
      const lower_bound = 1n;
      const upper_bound = pool_pair.b - pool_pair.b_min_reserve + 1n;
      const trade = approxAvailableAmountInAPairAtTargetAvgRate(pool_pair, target_rate, lower_bound, upper_bound);
      if (trade != null && trade.demand > 0n) {
        result_entries.push({
          pool: pool_pair.pool,
          supply_token_id, demand_token_id,
          supply: trade.supply,
          demand: trade.demand,
          trade_fee: trade.trade_fee,
        });
      }
    }
    // sort pools by its liquidity depth in descending order
    bigIntArraySortPolyfill(result_entries, (a, b) => b.demand - a.demand);
    return result_entries.length > 0 ? {
      entries: result_entries,
      summary: calcTradeSummary(result_entries, this._rate_denominator) as TradeSummary,
    } : null;
  }
  constructTradeBestRateForTargetDemand (supply_token_id: TokenId, demand_token_id: TokenId, amount: bigint, input_pools: PoolV0[], txfee_per_byte: bigint): TradeResult {
    const rate_denominator = this._rate_denominator;
    const { pools_pair } = prepareForARequestToConstructTrade(this, supply_token_id, demand_token_id, input_pools);
    if (txfee_per_byte < 0n) {
      throw new ValueError('txfee_per_byte should be greater than or equal to zero!')
    }
    if (amount <= 0n) {
      throw new ValueError('amount should be greater than zero!')
    }
    if (input_pools.length == 0) {
      throw new InsufficientCapitalInPools('Nothing available to trade.', { requires: amount, pools: input_pools });
    }
    const fee_paid_in_demand = demand_token_id == NATIVE_BCH_TOKEN_ID ? true : false;
    const pool_fixed_cost = {
      supply: !fee_paid_in_demand ? sizeOfPoolV0InAnExchangeTx() * txfee_per_byte : 0n,
      demand: fee_paid_in_demand ? sizeOfPoolV0InAnExchangeTx() * txfee_per_byte : 0n,
    };
    let rate_lower_bound = 1n;
    // TODO:: verify upper_bound is actually the highest possible rate + 1n
    let rate_upper_bound = bigIntMax(...pools_pair.map((pair) => calcPairRate({ a: pair.a + pair.b - pair.b_min_reserve, b: pair.b_min_reserve, fee_paid_in_a: pair.fee_paid_in_a, a_min_reserve: pair.a_min_reserve, b_min_reserve: pair.b_min_reserve }, rate_denominator).numerator + 1n));
    let candidate_trade: { entries: Array<{ pair: PoolPair, trade: AbstractTrade }>, summary: TradeSummary, rate: Fraction | null } | null = null;
    if (input_pools.length > 1) {
      let pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }> = pools_pair.map((pair) => ({ pair, lower_bound: 1n, upper_bound: pair.b - pair.b_min_reserve + 1n }));
      const result = bestRateToTradeInPoolsForTargetDemand(pools_set, amount, rate_lower_bound, rate_upper_bound, rate_denominator);
      if (result != null) {
        const summary = calcTradeSummary(result.trade.map((a) => a.trade), rate_denominator);
        if (summary == null) {
          /* c8 ignore next */
          throw new InvalidProgramState('summary == null!!');
        }
        rate_lower_bound = result.rate.numerator;
        candidate_trade = { entries: result.trade, rate: result.rate, summary };
      }
    }
    /*
      the need, set a lower limit on included pools by taking trade's fixed cost into account.
      eliminate net negative pools based on the demand amount
    */
    if (candidate_trade != null && candidate_trade.entries.length > 1 && txfee_per_byte > 0n) {
      try {
        const result = eliminateNetNegativePoolsInATradeWithTargetDemand(pool_fixed_cost, candidate_trade.entries, amount, rate_lower_bound, rate_upper_bound, rate_denominator);
        if (result != null) {
          const summary = calcTradeSummary(result.trade.map((a) => a.trade), rate_denominator);
          if (summary == null) {
            / * c8 ignore next * /
              throw new InvalidProgramState('summary == null!!');
          }
          candidate_trade = { entries: result.trade, rate: result.rate, summary };
        }
      } catch (err) {
        if (!(err instanceof NotFoundError)) {
          throw err;
        }
      }
    }
    // fill up the remaining amount if needed
    const stepper_size = 10n;
    if (candidate_trade == null) {
      const tmp = fillTradeToTargetDemandFromPairsWithFillingStepper(pools_pair.map((pair) => ({ pair, trade: null })), amount, bigIntMax(1n, amount / stepper_size), rate_denominator);
      if (tmp != null) {
        const summary = calcTradeSummary(tmp.map((a) => a.trade), rate_denominator);
        if (summary == null) {
          /* c8 ignore next */
          throw new InvalidProgramState('summary == null!!');
        }
        candidate_trade = { entries: tmp, rate: null, summary };
      }
    } else {
      if (candidate_trade.summary.demand < amount) {
        // fill to order size
        const pair_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }> = candidate_trade.entries;
        const entries = pools_pair.map((pair) => {
          const pair_trade = pair_trade_list.find((a) => (a.pair as any).pool == pair.pool);
          return { pair, trade: pair_trade != null ? pair_trade.trade : null };
        });
        const tmp = fillTradeToTargetDemandFromPairsWithFillingStepper(entries, amount, bigIntMax(1n, (amount - candidate_trade.summary.demand) / stepper_size), rate_denominator);
        if (tmp == null) {
          candidate_trade = null;
        } else {
          const summary = calcTradeSummary(tmp.map((a) => a.trade), rate_denominator);
          if (summary == null) {
            /* c8 ignore next */
            throw new InvalidProgramState('summary == null!!');
          }
          candidate_trade = { entries: tmp, rate: null, summary };
        }
      }
    }
    if (candidate_trade == null) {
      throw new InsufficientCapitalInPools('Not enough tokens available in input pools.', { requires: amount, pools: input_pools });
    }
    const result_entries: PoolTrade[] = [];
    for (const entry of candidate_trade.entries) {
      if (entry.trade == null) {
        continue;
      }
      result_entries.push({
        pool: (entry.pair as any).pool,
        supply_token_id, demand_token_id,
        supply: entry.trade.supply,
        demand: entry.trade.demand,
        trade_fee: entry.trade.trade_fee,
      });
    }
    return {
      entries: result_entries,
      summary: candidate_trade.summary,
    };
  }

  constructTradeBestRateForTargetSupply (supply_token_id: TokenId, demand_token_id: TokenId, amount: bigint, input_pools: PoolV0[], txfee_per_byte: bigint): TradeResult {
    const rate_denominator = this._rate_denominator;
    const { pools_pair } = prepareForARequestToConstructTrade(this, supply_token_id, demand_token_id, input_pools);
    if (txfee_per_byte < 0n) {
      throw new ValueError('txfee_per_byte should be greater than or equal to zero!')
    }
    if (amount <= 0n) {
      throw new ValueError('amount should be greater than zero!')
    }
    if (input_pools.length == 0) {
      throw new InsufficientCapitalInPools('Nothing available to trade.', { requires: amount, pools: input_pools });
    }
    const fee_paid_in_demand = demand_token_id == NATIVE_BCH_TOKEN_ID ? true : false;
    const pool_fixed_cost = {
      supply: !fee_paid_in_demand ? sizeOfPoolV0InAnExchangeTx() * txfee_per_byte : 0n,
      demand: fee_paid_in_demand ? sizeOfPoolV0InAnExchangeTx() * txfee_per_byte : 0n,
    };
    let rate_lower_bound = 1n;
    // TODO:: verify upper_bound is actually the highest possible rate + 1n
    let rate_upper_bound = bigIntMax(...pools_pair.map((pair) => calcPairRate({ a: pair.a + pair.b - pair.b_min_reserve, b: pair.b_min_reserve, fee_paid_in_a: pair.fee_paid_in_a, a_min_reserve: pair.a_min_reserve, b_min_reserve: pair.b_min_reserve }, rate_denominator).numerator + 1n));
    let candidate_trade: { entries: Array<{ pair: PoolPair, trade: AbstractTrade }>, summary: TradeSummary, rate: Fraction | null } | null = null;
    if (input_pools.length > 1) {
      let pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }> = pools_pair.map((pair) => ({ pair, lower_bound: 1n, upper_bound: requiredSupplyToMaxOutAPair(pair) }));
      const result = bestRateToTradeInPoolsForTargetSupply(pools_set, amount, rate_lower_bound, rate_upper_bound, rate_denominator);
      if (result != null) {
        const summary = calcTradeSummary(result.trade.map((a) => a.trade), rate_denominator);
        if (summary == null) {
          /* c8 ignore next */
          throw new InvalidProgramState('summary == null!!');
        }
        rate_lower_bound = result.rate.numerator;
        candidate_trade = { entries: result.trade, rate: result.rate, summary };
      }
    }
    /*
      the need, set a lower limit on included pools by taking trade's fixed cost into account.
      eliminate net negative pools based on the supply amount
    */
    if (candidate_trade != null && candidate_trade.entries.length > 1 && txfee_per_byte > 0n) {
      try {
        const result = eliminateNetNegativePoolsInATradeWithTargetSupply(pool_fixed_cost, candidate_trade.entries, amount, rate_lower_bound, rate_upper_bound, rate_denominator);
        if (result != null) {
          const summary = calcTradeSummary(result.trade.map((a) => a.trade), rate_denominator);
          if (summary == null) {
            / * c8 ignore next * /
              throw new InvalidProgramState('summary == null!!');
          }
          candidate_trade = { entries: result.trade, rate: result.rate, summary };
        }
      } catch (err) {
        if (!(err instanceof NotFoundError)) {
          throw err;
        }
      }
    }
    // fill up the remaining amount if needed
    const stepper_size = 10n;
    if (candidate_trade == null) {
      const tmp = fillTradeToTargetSupplyFromPairsWithFillingStepper(pools_pair.map((pair) => ({ pair, trade: null })), amount, bigIntMax(1n, amount / stepper_size), rate_denominator);
      if (tmp != null) {
        if (tmp.length == 0) {
          throw new InsufficientFunds(`Can't acquire any token with the given target supply.`);
        }
        const summary = calcTradeSummary(tmp.map((a) => a.trade), rate_denominator);
        if (summary == null) {
          /* c8 ignore next */
          throw new InvalidProgramState('summary == null!!');
        }
        candidate_trade = { entries: tmp, rate: null, summary };
      }
    } else {
      if (candidate_trade.summary.supply < amount) {
        // fill to order size
        const pair_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }> = candidate_trade.entries;
        const entries = pools_pair.map((pair) => {
          const pair_trade = pair_trade_list.find((a) => (a.pair as any).pool == pair.pool);
          return { pair, trade: pair_trade != null ? pair_trade.trade : null };
        });
        const tmp = fillTradeToTargetSupplyFromPairsWithFillingStepper(entries, amount, bigIntMax(1n, (amount - candidate_trade.summary.supply) / stepper_size), rate_denominator);
        if (tmp == null) {
          candidate_trade = null;
        } else {
          if (tmp.length == 0) {
            throw new InsufficientFunds(`Can't acquire any token with the given target supply.`);
          }
          const summary = calcTradeSummary(tmp.map((a) => a.trade), rate_denominator);
          if (summary == null) {
            /* c8 ignore next */
            throw new InvalidProgramState('summary == null!!');
          }
          candidate_trade = { entries: tmp, rate: null, summary };
        }
      }
    }
    if (candidate_trade == null) {
      throw new InsufficientCapitalInPools('Not enough tokens available in input pools.', { requires: amount, pools: input_pools });
    }
    const result_entries: PoolTrade[] = [];
    for (const entry of candidate_trade.entries) {
      if (entry.trade == null) {
        continue;
      }
      result_entries.push({
        pool: (entry.pair as any).pool,
        supply_token_id, demand_token_id,
        supply: entry.trade.supply,
        demand: entry.trade.demand,
        trade_fee: entry.trade.trade_fee,
      });
    }
    return {
      entries: result_entries,
      summary: candidate_trade.summary,
    };
  }

  /*
    input_pool_trade_list
    input_coins should have enough tokens to fund sum of supply + trade_fee.
    payout_rules define the payout outputs for the demand side + change.
   */
  writeTradeTx (input_pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_rules: PayoutRule[], data_locking_bytecode: Uint8Array | null, txfee_per_byte: number | bigint): TradeTxResult {
    return writeTradeTx(this, this._compiler, input_pool_trade_list, input_coins, payout_rules, data_locking_bytecode, txfee_per_byte);
  }
  async writeChainedTradeTx (input_pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_rules: PayoutRule[], data_locking_bytecode: Uint8Array | null, txfee_per_byte: number | bigint, controller?: WriteChainedTradeTxController): Promise<TradeTxResult[]> {
    return writeChainedTradeTx(this, this._compiler, input_pool_trade_list, input_coins, payout_rules, data_locking_bytecode, txfee_per_byte, controller);
  }
  /*
    Verify the validity of writeTradeTx result, Expecting it should always get verified.
   */
  verifyTradeTx (trade_tx_result: TradeTxResult): void {
    const vm = libauth.createVirtualMachineBCH();
    const result = vm.verify({
      sourceOutputs: trade_tx_result.libauth_source_outputs,
      transaction: trade_tx_result.libauth_generated_transaction,
    });
    if (typeof result == 'string') {
      /* c8 ignore next */
      throw new InvalidProgramState(result);
    }
  }
  generatePoolV0LockingBytecode (parameters: PoolV0Parameters): Uint8Array {
    const locking_data: libauth.CompilationData<never> = {
      bytecode: {
        pool_owner_public_key_hash160: parameters.withdraw_pubkey_hash,
      },
    };
    const locking_bytecode_result = this._compiler.generateBytecode({
      data: locking_data,
      scriptId: 'cauldron_poolv0',
    });
    if (!locking_bytecode_result.success) {
      /* c8 ignore next */
      throw new InvalidProgramState('generate locking code failed, script: cauldron_poolv0, ' + JSON.stringify(locking_bytecode_result, null, '  '))
    }
    return locking_bytecode_result.bytecode;
  }
}


