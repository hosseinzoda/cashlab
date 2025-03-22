import type {
  Fraction, TokenId, PayoutRule, Output, SpendableCoin,
} from '@cashlab/common/types.js';
import { NATIVE_BCH_TOKEN_ID } from '@cashlab/common/constants.js';
import {
  convertTokenIdToUint8Array, bigIntMax,
  bigIntArraySortPolyfill, convertFractionDenominator,
} from '@cashlab/common/util.js';
import type {
  PoolV0, PoolV0Parameters, PoolTrade, TradeResult, TradeTxResult, TradeSummary, AbstractTrade,
  CreateChainedTradeTxController,
} from './types.js';
import { ExceptionRegistry, Exception, InvalidProgramState, ValueError, NotFoundError, InsufficientFunds } from '@cashlab/common/exceptions.js';
import cauldron_libauth_template_data from './cauldron-libauth-template.json' with { type: "json" };
import * as libauth from '@cashlab/common/libauth.js';
import { createTradeTx } from './create-trade-tx.js';
import { createChainedTradeTx } from './create-chained-trade-tx.js';
import {
  PoolPair, calcPairRate, calcTradeSummary, sizeOfPoolV0InAnExchangeTx,
  calcTradeWithTargetSupplyFromAPair,
  approxAvailableAmountInAPairAtTargetAvgRate, approxAvailableAmountInAPairAtTargetRate, calcTradeWithTargetDemandFromAPair,
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

/**
 * Apply checks to verify a trade requset for a bch/token pair and return a list of PoolPair.
 * @param exlab an instance of ExchangeLab
 * @param supply_token_id the supply token of the trade
 * @param demand_token_id the demand token of the trade
 * @param input_pools a list of input cauldron pools
 * @returns a list of PoolPair based on the supply_token_id & demand_token_id
 */
export const prepareForARequestToConstructTrade = (exlab: ExchangeLab, supply_token_id: TokenId, demand_token_id: TokenId, input_pools: PoolV0[]): { pools_pair: Array<PoolPair & { pool: PoolV0 }> } => {
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

/**
 * Cauldron pool selector & transaction generator tool.
 * Features:
 * - Exchange bch/token pairs with cauldron's pool selectors.
 * - Generate & verify exchange transactions
 */
export default class ExchangeLab {
  _rate_denominator: bigint;
  _template: libauth.WalletTemplate;
  _compiler: libauth.CompilerBCH;
  _default_preferred_token_output_bch_amount: bigint | null;
  constructor () {
    // default lab parameters
    this._rate_denominator = 10000000000000n;
    this._default_preferred_token_output_bch_amount = null;
    // init libauth cauldron template compiler
    const template_result = libauth.importWalletTemplate(cauldron_libauth_template_data);
    if (typeof template_result == 'string') {
      /* c8 ignore next */
      throw new InvalidProgramState(`Failed import libauth template, error: ${template_result}`)
    }
    this._template = template_result;
    this._compiler = libauth.walletTemplateToCompilerBCH(this._template);
  }
  /**
   * Set the default exchange rate's denominator.
   * A higher value will increase the rate's percision, A lower value reduces it.
   * initial value: 10000000000000n
   * @param denominator the default rate's denominator
   */
  setRateDenominator (denominator: bigint): void {
    this._rate_denominator = denominator;
  }
  /**
   * Get the default exchange rate's denominator
   * @returns the default denominator value of the rate
   */
  getRateDenominator (): bigint {
    return this._rate_denominator;
  }
  /**
   * @param output the subject output
   * @return the min bch amount required for the output to meet the network threshold
   */
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
  /**
   * @param token_id the subject token_id
   * @return the min token in reserve needed for any cauldron pool.
   */
  getMinTokenReserve (token_id: TokenId): bigint {
    // min token reserve should be greater than zero
    if (token_id == NATIVE_BCH_TOKEN_ID) {
      return defaultOutputMinBCHReserve()
    } else {
      return 1n;
    }
  }
  /**
   * @param output the subject output
   * @return the preferred bch amount for a token output
   */
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null {
    if (output == null) {
      throw new ValueError('output should not be null');
    }
    return this._default_preferred_token_output_bch_amount;
  }
  /**
   * @param value the default preferred token bch amount
   */
  setDefaultPreferredTokenOutputBCHAmount (value: bigint | null): void {
    this._default_preferred_token_output_bch_amount = value;
  }

  /**
   * Reduce the supply of a constructed trade.
   * @param pool_trade_list a pre-constructed list of trades with pools.
   * @param reduce_supply the amount to reduce the supply.
   * @returns the reconstructed trades, represented in a list pools with the trade details
   * @throws ValueError
   */
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

  /**
   * Construct a trade from a set of `input_pools` with the following condition, Demands as much possible below a target rate.
   * Meaning the differential rate of the demand at the highest rate is below the provided rate.
   * @param supply_token_id the supply token of the trade
   * @param demand_token_id the demand token of the trade
   * @param rate the target rate
   * @param input_pools a list of input cauldron pools
   * @returns the constructed trade result or null if no trade can be generated with the given condition
   * @throws ValueError
   */
  constructTradeAvailableAmountBelowTargetRate (supply_token_id: TokenId, demand_token_id: TokenId, rate: Fraction, input_pools: PoolV0[]): TradeResult | null {
    const target_rate = convertFractionDenominator(rate, this._rate_denominator);
    const { pools_pair } = prepareForARequestToConstructTrade(this, supply_token_id, demand_token_id, input_pools);
    const result_entries: PoolTrade[] = [];
    for (const pool_pair of pools_pair) {
      const lower_bound = 1n;
      const upper_bound = pool_pair.b - pool_pair.b_min_reserve + 1n;
      const best_guess = approxAvailableAmountInAPairAtTargetRate(pool_pair, target_rate, lower_bound, upper_bound);
      let trade = null;
      if (best_guess != null) {
        trade = calcTradeWithTargetDemandFromAPair(pool_pair, best_guess);
        if (trade == null) {
          /* c8 ignore next */
          throw new InvalidProgramState('derived trade from best guess is null!!')
        }
      }
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
  /**
   * Construct a trade from a set of `input_pools` with the following condition, Demands as much possible with a target average rate.
   * Meaning the differential rate of the demand at the highest rate is below the provided rate.
   * @param supply_token_id the supply token of the trade
   * @param demand_token_id the demand token of the trade
   * @param rate the target rate
   * @param input_pools a list of input cauldron pools
   * @returns the constructed trade result or null
   * @throws ValueError
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
  /**
   * Construct a trade from a set of `input_pools` with the following condition, Demands at least the target `amount` at the best rate.
   * The best rate is estimated based on the state of `input_pools` and the fixed cost of network transaction fee.
   * @param supply_token_id the supply token of the trade
   * @param demand_token_id the demand token of the trade
   * @param amount the order's target demand
   * @param input_pools a list of input cauldron pools
   * @param txfee_per_byte the network fee to be paid per byte
   * @returns the constructed trade result
   * @throws InsufficientCapitalInPools
   * @throws ValueError
   */
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
    const stepper_size = 10n;
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
        rate_lower_bound = result.rate.numerator;
        const summary = calcTradeSummary(result.trade.map((a) => a.trade), rate_denominator);
        if (summary == null) {
          /* c8 ignore next */
          throw new InvalidProgramState('summary == null!!');
        }
        if (summary.demand < amount) {
          // fill to order size
          const tmp = fillTradeToTargetDemandFromPairsWithFillingStepper(result.trade, amount, bigIntMax(1n, (amount - summary.demand) / stepper_size), rate_denominator);
          if (tmp != null) {
            const summary = calcTradeSummary(tmp.map((a) => a.trade), rate_denominator);
            if (summary == null) {
              /* c8 ignore next */
              throw new InvalidProgramState('summary == null!!');
            }
            candidate_trade = { entries: tmp, rate: null, summary };
          }
        } else {
          candidate_trade = { entries: result.trade, rate: result.rate, summary };
        }
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
  /**
   * Construct a trade from a set of `input_pools` with the following condition, Supply at most the target `amount` at the best rate.
   * The best rate is estimated based on the state of `input_pools` and the fixed cost of network transaction fee.
   * @param supply_token_id the supply token of the trade
   * @param demand_token_id the demand token of the trade
   * @param amount the order's target demand
   * @param input_pools a list of input cauldron pools
   * @param txfee_per_byte the network fee to be paid per byte
   * @returns the constructed trade result
   * @throws InsufficientCapitalInPools
   * @throws ValueError
   */
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
    const stepper_size = 10n;
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
        if (summary.supply < amount) {
          // fill to order size
          const tmp = fillTradeToTargetSupplyFromPairsWithFillingStepper(result.trade, amount, bigIntMax(1n, (amount - summary.supply) / stepper_size), rate_denominator);
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
          candidate_trade = { entries: result.trade, rate: result.rate, summary };
        }
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

  /**
   * Create a transaction from constructed trade.
   * @param input_pool_trade_list a list of trades with pools.
   * @param input_coins a set of spendable coins used provide the supply side of the trade
   * @param payout_rules a set of rules for the trade's payout + a pocket change
   * @param data_locking_bytecode an optional message to insert in the transaction as an OP_RETURN output
   * @param txfee_per_byte the rate of network fee (sat/byte)
   * @returns the trade's transaction result.
   * @throws ValueError
   * @throws InsufficientFunds
   */
  createTradeTx (input_pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_rules: PayoutRule[], data_locking_bytecode: Uint8Array | null, txfee_per_byte: number | bigint): TradeTxResult {
    return createTradeTx(this, this._compiler, input_pool_trade_list, input_coins, payout_rules, data_locking_bytecode, txfee_per_byte);
  }
  /**
   * Create a chain of transactions from constructed trade.
   * @param input_pool_trade_list a list of trades with pools.
   * @param input_coins a set of spendable coins used provide the supply side of the trade
   * @param payout_rules a set of rules for the trade's payout + a pocket change
   * @param data_locking_bytecode an optional message to insert in the transaction as an OP_RETURN output
   * @param txfee_per_byte the rate of network fee (sat/byte)
   * @param controller an optional controller used when generating the transactions
   * @returns the trade's transaction result.
   * @throws ValueError
   * @throws InsufficientFunds
   */
  async createChainedTradeTx (input_pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_rules: PayoutRule[], data_locking_bytecode: Uint8Array | null, txfee_per_byte: number | bigint, controller?: CreateChainedTradeTxController): Promise<TradeTxResult[]> {
    return createChainedTradeTx(this, this._compiler, input_pool_trade_list, input_coins, payout_rules, data_locking_bytecode, txfee_per_byte, controller);
  }
  /**
   * Verify the validity of a TradeTxResult, Expecting all generated transactions should be valid.
   * @param trade_tx_result the result of createTradeTx or createChainedTradeTx
   * @throws InvalidProgramState
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
  /**
   * Generate a pool's locking with {@link PoolV0Parameters}
   * @param parameters `{ withdraw_pubkey_hash }`
   * @returns the pool's p2sh locking bytecode
   */
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


