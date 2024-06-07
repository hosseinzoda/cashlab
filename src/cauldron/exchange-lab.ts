import type {
  Fraction, TokenId, PayoutRule, Output, OutputWithFT, SpendableCoin,
} from '../common/types.js';
import { NATIVE_BCH_TOKEN_ID, SpendableCoinType, PayoutAmountRuleType } from '../common/constants.js';
import {
  ceilingValueOfBigIntDivision, convertTokenIdToUint8Array, uint8ArrayToHex,
  bigIntMin, bigIntMax, bigIntArraySortPolyfill, convertFractionDenominator,
} from '../common/util.js';
import type {
  PoolV0, PoolV0Parameters, PoolTrade, TradeResult, TradeTxResult, TradeSummary, AbstractTrade
} from './types.js';
import { ExceptionRegistry, Exception, InvalidProgramState, ValueError } from '../common/exceptions.js';
import cauldron_libauth_template_data from './cauldron-libauth-template.json' assert { type: "json" };
import * as libauth from '@bitauth/libauth';

type PoolPair = { a: bigint, b: bigint, fee_paid_in_a: boolean };

export class InsufficientCapitalInPools extends Exception { };
ExceptionRegistry.add('InsufficientCapitalInPools', InsufficientCapitalInPools);

const calcTradeToBuyTargetAmountFromAPair = (pair: PoolPair, amount: bigint): AbstractTrade | null => {
  const calcFee = (a: bigint): bigint => a * 3n / 1000n;
  const K = pair.a * pair.b;
  const pre_b1 = bigIntMax(1n, pair.b - amount);
  const a1 = ceilingValueOfBigIntDivision(K, pre_b1);
  const b1 = ceilingValueOfBigIntDivision(K, a1);
  if (b1 > pre_b1) {
    throw new InvalidProgramState(`b1 > pre_b1, ${b1} > ${pre_b1}`);
  }
  let pair_a_1, pair_b_1, trade_fee;
  if (pair.fee_paid_in_a) {
    const includeFeeForTarget = (target: bigint, initial: bigint): bigint => {
      let x1 = target;
      let x2 = target + calcFee(target - initial);
      let trylen = 0;
      while (x2 - calcFee(x2 - initial) < target) {
        const more_fee = bigIntMax(1n, calcFee(x2 - x1));
        x1 = x2;
        x2 = x1 + more_fee;
        if (more_fee == 1n && trylen++ > 5) {
          throw new InvalidProgramState('too many attempt to add more_fee=1n!!')
        }
      }
      return x2;
    };
    pair_a_1 = includeFeeForTarget(a1, pair.a);
    pair_b_1 = b1;
    trade_fee = calcFee(pair_a_1 - pair.a);
  } else {
    /*
      The fee is included in b1, To deduct the fee from it, the following formula is used.
      --- bx1 = b1 - fee
      C = 3n / 1000n
      bx1 = b1 - fee
      bx1 = b1 - (bx1 - b0) * C
      bx1 = b1 - bx1 * C + b0 * C
      bx1 * (1 + C) = b1 + b0 * C
      bx1 = (b1 + b0 * C) / (1 + C)
      bx1 = 1/1000 * (1000 * b1 + b0 * 3) * 1000 / 1003
      bx1 = b1 * 1000 + b0 * 3 / 1003
     */
    pair_a_1 = a1;
    pair_b_1 = ((b1 * 1000n + pair.b * 3n) / 1003n);

    const reserved_trade_fee = pair_b_1 - b1;
    trade_fee = calcFee(pair.b - pair_b_1);

    const error_threshold = 1n;
    if (trade_fee - reserved_trade_fee > error_threshold) {
      throw new InvalidProgramState(`expecting the difference of trade fee and calculated reserved_trade_fee to not exceed the threshold (${error_threshold}), diff = ${trade_fee - reserved_trade_fee}!!`);
    } else if (reserved_trade_fee > trade_fee) {
      throw new InvalidProgramState(`expecting the reserved_trade_fee to not be greater than trade fee by a threshold, threshold: (${error_threshold}), ${reserved_trade_fee} > ${trade_fee}!!`);
    } else {
      pair_b_1 += trade_fee - reserved_trade_fee;
    }
  }
  if (pair_b_1 > pair.b) {
    throw new InvalidProgramState('expecting pair_b_1 to be <= pair.a!!');
  }
  if (pair_a_1 * pair_b_1 < K) {
    throw new InvalidProgramState('pair_a_1 * pair_b_1 is not >= K!!')
  }
  if (pair.fee_paid_in_a) {
    if ((pair_a_1 - trade_fee) * pair_b_1 < K) {
      throw new InvalidProgramState('(pair_a_1 - trade_fee) * pair_b_1 < K!!');
    }
    if ((pair_a_1 - 1n - trade_fee) * pair_b_1 >= K) {
      throw new InvalidProgramState('(pair_a_1 - 1n - trade_fee) * pair_b_1 >= K!!');
    }
    if ((pair_a_1 - trade_fee) * (pair_b_1 - 1n) >= K) {
      throw new InvalidProgramState('(pair_a_1 - trade_fee) * (pair_b_1 - 1n) >= K!!');
    }
  } else {
    if (pair_a_1 * (pair_b_1 - trade_fee) < K) {
      throw new InvalidProgramState('pair_a_1 * (pair_b_1 - trade_fee) < K!!');
    }
    if ((pair_a_1 - 1n) * (pair_b_1 - trade_fee) >= K) {
      throw new InvalidProgramState('(pair_a_1 - 1n) * (pair_b_1 - trade_fee) >= K!!');
    }
    if (pair_a_1 * (pair_b_1 - 1n - trade_fee) >= K) {
      throw new InvalidProgramState('pair_a_1 * (pair_b_1 - 1n - trade_fee) >= K!!');
    }
  }
  const supply = pair_a_1 - pair.a;
  const demand = pair.b - pair_b_1;
  return demand > 0n && supply > 0n ? {
    demand, supply,
    trade_fee,
  } : null;
};
const sizeOfPoolV0InAnExchangeTx = (): bigint => 197n
/* UNUSED CODE START
const calcTradeToBuyFromAPair = (pair: { a: bigint, b: bigint }, amount: bigint, rate_denominator: bigint): AbstractTrade | null => {
  const K = pair.a * pair.b;
  const pair_a_1 = ceilingValueOfBigIntDivision(K, pair.b + amount);
  const pair_b_1 = ceilingValueOfBigIntDivision(K, pair_a_1);
  if (pair_a_1 * pair_b_1 < K) {
    throw new InvalidProgramState('pair_a_1 * pair_b_1 is not >= K!!')
  }
  if ((pair_a_1 - 1n) * pair_b_1 >= K) {
    throw new InvalidProgramState('(pair_a_1 - 1n) * pair_b_1 is >= K!!')
  }
  if (pair_a_1 * (pair_b_1 - 1n) >= K) {
    throw new InvalidProgramState('pair_a_1 * (pair_b_1 - 1n) is >= K!!')
  }
  const supply = pair_a_1 - pair.a;
  const demand = pair_b_1 - pair.b;
  return supply > 0n && supply > 0n ? {
    demand, supply,
    rate: { numerator: supply * rate_denominator / demand, denominator: rate_denominator },
  } : null;
};
// approximate the amount can be taken, trading a for b
// in a pool that has pair.a & pair.b (excluding fees)
const approxAvailableToBuyForTargetRate = (pair: { a: bigint, b: bigint }, target_rate: Fraction, max_budget: bigint): AbstractTrade | null => {
  const K = pair.a * pair.b;
  let lower_bound: bigint, upper_bound: bigint, trade;
  lower_bound = 1n;
  { // verify lower_bound trade (initial value) before proceeding
    trade = calcTradeToBuyFromAPair(pair, lower_bound, target_rate.denominator)
    if (trade == null || trade.rate.numerator > target_rate.numerator) {
      return null;
    }
  }
  // lower_bound >= result < upper_bound
  upper_bound = pair.b - ceilingValueOfBigIntDivision(K, pair.a + max_budget) + 1n;
  // upper_bound should be greater than lower_bound, since upper_bound is not in the range of possible values
  if (upper_bound <= lower_bound) {
    return null;
  }
  while (lower_bound < upper_bound) {
    const guess = lower_bound + (upper_bound - lower_bound) / 2n;
    const guess_trade = calcTradeToBuyFromAPair(pair, guess, target_rate.denominator);
    if (guess_trade == null) {
      throw new InvalidProgramState('guess_trade is null!!')
    }
    if (guess_trade.rate.numerator > target_rate.numerator) {
      upper_bound = guess;
    } else {
      lower_bound = guess + 1n;
      trade = guess_trade;
    }
  }
  return trade;
};
    UNUSED CODE END */

const calcTradeAvgRate = (trade: AbstractTrade, rate_denominator: bigint): Fraction => {
  return { numerator: trade.supply * rate_denominator / trade.demand, denominator: rate_denominator };
};

const calcPairRate = (pair: PoolPair, rate_denominator: bigint): Fraction => {
  const K = pair.a * pair.b;
  return { numerator: K * rate_denominator / (pair.b * pair.b), denominator: rate_denominator }
};

const calcPairRateWithKB = (K: bigint, b: bigint, rate_denominator: bigint): bigint => {
  return K * rate_denominator / (b * b);
};

/*
const testCalcPairRateResult = (pair: PoolPair, trade: AbstractTrade, rate_denominator: bigint): any => {
  const zero_pair = { a: pair.a + trade.supply, b: pair.b - trade.demand, fee_paid_in_a: pair.fee_paid_in_a };
  const mone_trade = calcTradeToBuyTargetAmountFromAPair({ a: zero_pair.b, b: zero_pair.a, fee_paid_in_a: !pair.fee_paid_in_a }, 1n);
  const mone_trade_rate = mone_trade != null ? mone_trade.demand * rate_denominator / mone_trade.supply : 0n;
  const pone_trade = calcTradeToBuyTargetAmountFromAPair(zero_pair, 1n);
  const pone_trade_rate = pone_trade != null ? calcTradeAvgRate(pone_trade, rate_denominator).numerator : 0n;
  const pair_rate = calcPairRate(zero_pair, rate_denominator);
  if ((mone_trade_rate != 0n && mone_trade_rate > pair_rate.numerator) || (pone_trade_rate != 0n && pone_trade_rate < pair_rate.numerator)) {
    throw new InvalidProgramState('incorrect calcPairRate, ' + JSON.stringify({ c0rate: mone_trade_rate, c1rate: pair_rate.numerator, c2rate: pone_trade_rate }, (_, a) => typeof a == 'bigint' ? a+'' : a, '  ') + ' ---- \n' + JSON.stringify({ mone_trade, trade, pone_trade, pair:{a:pair.a, b:pair.b}, zero_pair,mone_trade_rate }, (_, a) => typeof a == 'bigint' ? a+'' : a, '  '))
  }
  return { zero_pair, mone_trade, mone_trade_rate, pone_trade }
}
*/

// lower_bound >= result < upper_bound
const approxAvailableAmountInAPairAtTargetAvgRate = (pair: PoolPair, target_rate: Fraction, lower_bound: bigint, upper_bound: bigint): AbstractTrade | null => {
  let trade = null
  while (lower_bound < upper_bound) {
    const guess = lower_bound + (upper_bound - lower_bound) / 2n;
    const guess_trade = calcTradeToBuyTargetAmountFromAPair(pair, guess);
    if (guess_trade == null) {
      throw new InvalidProgramState('guess_trade.rate is undefined!!')
    }
    const guess_trade_rate = calcTradeAvgRate(guess_trade, target_rate.denominator);
    if (guess_trade_rate.numerator > target_rate.numerator) {
      upper_bound = guess;
    } else {
      lower_bound = guess + 1n;
      trade = guess_trade;
    }
  }
  return trade;
};

// lower_bound >= result < upper_bound
const approxAvailableAmountInAPairAtTargetRate = (pair: PoolPair, target_rate: Fraction, lower_bound: bigint, upper_bound: bigint): AbstractTrade | null => {
  let best_guess = null;
  let trade = null
  while (lower_bound < upper_bound) {
    const guess = lower_bound + (upper_bound - lower_bound) / 2n;
    const K = pair.a * pair.b;
    const b1 = pair.b - guess;
    const rate = calcPairRateWithKB(K, b1, target_rate.denominator);
    if (rate > target_rate.numerator) {
      upper_bound = guess;
    } else {
      lower_bound = guess + 1n;
      best_guess = guess;
    }
  }
  if (best_guess != null) {
    trade = calcTradeToBuyTargetAmountFromAPair(pair, best_guess);
    if (trade == null) {
      throw new InvalidProgramState('derived trade from best guess is null!!')
    }
  }
  return trade;
};

const sumAbstractTradeList = (trade_list: AbstractTrade[]): AbstractTrade | null => {
  const demand = trade_list.reduce((a, b) => a + b.demand, 0n);
  const supply = trade_list.reduce((a, b) => a + b.supply, 0n);
  return supply > 0n && demand > 0n ? {
    demand, supply,
    trade_fee: trade_list.reduce((a, b) => a + b.trade_fee, 0n),
  } : null;
};

const calcTradeSummary = (trade_list: AbstractTrade[], rate_denominator: bigint): TradeSummary | null => {
  const demand = trade_list.reduce((a, b) => a + b.demand, 0n);
  const supply = trade_list.reduce((a, b) => a + b.supply, 0n);
  return supply > 0n && demand > 0n ? {
    demand, supply,
    rate: { numerator: supply * rate_denominator / demand, denominator: rate_denominator },
    trade_fee: trade_list.reduce((a, b) => a + b.trade_fee, 0n),
  } : null;
};

const fillOrderFromPoolPairsWithStepperFilling = (initial_pair_trade_list: Array<{ trade: AbstractTrade | null, pair: PoolPair }>, requested_amount: bigint, step_size: bigint, rate_denominator: bigint): Array<{ trade: AbstractTrade | null, pair: any }> | null => {
  if (step_size <= 0n) {
    throw new ValueError('step size should be greater than zero')
  }
  const pair_trade_list: Array<{ trade: AbstractTrade | null, next_step_trade: any, pair: PoolPair }> = initial_pair_trade_list.map((a) => ({ trade: a.trade, next_step_trade: null, pair: a.pair }));
  let total_available = pair_trade_list.reduce((a, b) => a + bigIntMax(0n, b.pair.b - 1n), 0n);
  let total_acquired = pair_trade_list.reduce((a, b) => a + (b.trade != null ? b.trade.demand + (!b.pair.fee_paid_in_a ? b.trade.trade_fee : 0n) : 0n), 0n);
  const getStepForPair = (pair: PoolPair): bigint => bigIntMax(1n, bigIntMax(0n, pair.b - 1n) * step_size / total_available)
  while (total_acquired < requested_amount) {
    pair_trade_list.forEach((entry) => {
      if (!entry.next_step_trade) {
        const next_step = getStepForPair(entry.pair);
        const next_trade = calcTradeToBuyTargetAmountFromAPair(entry.pair, (entry.trade ? entry.trade.demand : 0n) + next_step);
        entry.next_step_trade = next_trade != null ? {
          ...next_trade,
          rate: calcTradeAvgRate(next_trade, rate_denominator),
        } : null;
      }
    })
    const sub_trade_list = pair_trade_list.filter((a) => a.next_step_trade != null);
    // sort pools by rate in ascending order
    bigIntArraySortPolyfill(sub_trade_list, (a, b) => (a.next_step_trade.rate.numerator as bigint) - (b.next_step_trade.rate.numerator as bigint));
    // fill from the sorted pairs
    let did_fill = false;
    for (const entry of sub_trade_list) {
      const next_addition = (entry.next_step_trade.demand as bigint) - (entry.trade != null ? entry.trade.demand : 0n) +
        (!entry.pair.fee_paid_in_a ? entry.next_step_trade.trade_fee - (entry.trade != null ? entry.trade.trade_fee : 0n) : 0n);
      if (next_addition > 0n) {
        if (next_addition > requested_amount - total_acquired) {
          const trade_demand = (requested_amount - total_acquired) + (entry.trade != null ? entry.trade.demand + (!entry.pair.fee_paid_in_a ? entry.trade.trade_fee : 0n) : 0n);
          const trade = calcTradeToBuyTargetAmountFromAPair(entry.pair, trade_demand);
          if (trade == null || trade.demand + (!entry.pair.fee_paid_in_a ? trade.trade_fee : 0n) < trade_demand ||
            (trade.demand + (!entry.pair.fee_paid_in_a ? trade.trade_fee : 0n)) - (entry.trade != null ? entry.trade.demand + (!entry.pair.fee_paid_in_a ? entry.trade.trade_fee : 0n) : 0n) <= 0n) {
            throw new InvalidProgramState('trade == null || trade.demand + trade_fee_if_paid_with_demand < trade_demand!! (attempt to fill up a trade)');
          }
          total_acquired += (trade.demand + (!entry.pair.fee_paid_in_a ? trade.trade_fee : 0n)) -
            (entry.trade != null ? entry.trade.demand + (!entry.pair.fee_paid_in_a ? entry.trade.trade_fee : 0n) : 0n);
          entry.trade = trade;
        } else {
          entry.trade = {
            demand: entry.next_step_trade.demand as bigint,
            supply: entry.next_step_trade.supply as bigint,
            trade_fee: entry.next_step_trade.trade_fee as bigint,
          };
          total_acquired += next_addition;
        }
        entry.next_step_trade = null;
        did_fill = true;
        break;
      }
    }
    if (!did_fill) {
      // not enough tokens acquire the requested tokens
      return null;
    }
  }
  if (total_acquired != pair_trade_list.reduce((a, b) => a + (b.trade ? b.trade.demand + (!b.pair.fee_paid_in_a ? b.trade.trade_fee : 0n) : 0n), 0n)) {
    throw new InvalidProgramState('total_acquired do not match the sum!! (attempt to add to trade amount)')
  }
  if (total_acquired < requested_amount) {
    throw new InvalidProgramState('total_acquired < requested_amount!! (attempt to add to trade amount)')
  }
  return pair_trade_list.map((entry) => {
    delete (entry as any).next_step_trade;
    return entry;
  });
};

const bestRateToTradeInPoolsForTargetAmount = (fee_paid_in_demand: boolean, pools_pair: Array<PoolPair>, amount: bigint, rate_denominator: bigint): { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } | null  => {
  /*
    The best is the lowest found aggregate rate.
    The successive approximation algorithm is used to find lowest rate to acquire the most.
    Based on available amount at a rate.
  */
  let candidate_trade: Array<{ pair: PoolPair, trade: AbstractTrade }> | null = null;
  let best_rate = null;
  let highest_found_demand = 0n;
  let lower_bound = 1n;
  // TODO:: verify upper_bound is actually the highest possible rate + 1n
  let upper_bound = bigIntMax(...pools_pair.map((pair) => calcPairRate({ a: pair.a + pair.b - 1n, b: 1n, fee_paid_in_a: pair.fee_paid_in_a }, rate_denominator).numerator + 1n));
  while (lower_bound < upper_bound) {
    const guess = lower_bound + (upper_bound - lower_bound) / 2n;
    const next_candidate_trade = pools_pair.map((pair) => ({
      pair,
      trade: approxAvailableAmountInAPairAtTargetRate(pair, { numerator: guess, denominator: rate_denominator }, 1n, pair.b),
    }));
    const next_trade_list = next_candidate_trade.map((a) => a.trade).filter((a) => !!a) as Array<AbstractTrade>;
    const next_demand_sum = next_trade_list.reduce((a, b) => a + b.demand, 0n) +
      (fee_paid_in_demand ? next_trade_list.reduce((a, b) => a + b.trade_fee, 0n) : 0n);
    if (next_demand_sum <= amount) {
      lower_bound = guess + 1n;
      if (next_demand_sum > 0 && next_demand_sum > highest_found_demand) {
        candidate_trade = next_candidate_trade.filter((a)=> a.trade != null) as Array<{ pair: PoolPair, trade: AbstractTrade }>;
        highest_found_demand = next_demand_sum;
        best_rate = guess;
      }
    } else {
      upper_bound = guess;
    }
  }
  return candidate_trade == null ? null : {
    trade: candidate_trade,
    rate: { numerator: best_rate as bigint, denominator: rate_denominator },
  };
}


const increaseTradeDemandWithBestRate = (fee_paid_in_demand: boolean, initial_candidate_trade: Array<{ trade: AbstractTrade, pair: PoolPair }>, amount: bigint, rate_lower_bound: bigint, rate_upper_bound: bigint, rate_denominator: bigint): { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } | null => {
  let candidate_trade = null;
  let best_rate = null;
  let highest_found_demand = initial_candidate_trade.reduce((a, b) => a + b.trade.demand, 0n) +
      (fee_paid_in_demand ? initial_candidate_trade.reduce((a, b) => a + b.trade.trade_fee, 0n) : 0n);
  if (highest_found_demand >= amount) {
    throw new ValueError(`amount should be higher than the sum of current trade demand!`);
  }
  let known_trade = initial_candidate_trade;
/*
  let lower_bound = bigIntMin(...initial_candidate_trade.map((a) => calcPairRate({ a: a.pair.a + a.trade.supply, b: a.pair.b - a.trade.demand, fee_paid_in_a: a.pair.fee_paid_in_a }, rate_denominator).numerator));
  // TODO:: verify upper_bound is actually the highest possible rate + 1n
  let upper_bound = bigIntMax(...initial_candidate_trade.map((a) => calcPairRate({ a: a.pair.a + a.pair.b - 1n, b: 1n, fee_paid_in_a: pair.fee_paid_in_a }, rate_denominator).numerator + 1n));
  */
  while (rate_lower_bound < rate_upper_bound) {
    const guess = rate_lower_bound + (rate_upper_bound - rate_lower_bound) / 2n;
    const next_candidate_trade = known_trade.map((a) => {
      const pool_lower_bound = a.trade.demand +
        (fee_paid_in_demand ? a.trade.trade_fee : 0n);
      const pool_upper_bound = bigIntMin(a.pair.b, amount + 1n);
      if (pool_lower_bound >= pool_upper_bound) {
        throw new InvalidProgramState(`candidate trade approx bound does not fit!,  pool_lower_bound > pool_upper_bound!!`);
      }
      const next_trade = approxAvailableAmountInAPairAtTargetRate(a.pair, { numerator: guess, denominator: rate_denominator }, pool_lower_bound, pool_upper_bound);
      return {
        pair: a.pair,
        trade: next_trade != null ? next_trade : a.trade,
      };
    });
    const next_trade_list = next_candidate_trade.map((a) => a.trade).filter((a) => !!a) as Array<AbstractTrade>;
    const next_demand_sum = next_trade_list.reduce((a, b) => a + b.demand, 0n) +
      (fee_paid_in_demand ? next_trade_list.reduce((a, b) => a + b.trade_fee, 0n) : 0n);
    if (next_demand_sum <= amount) {
      rate_lower_bound = guess + 1n;
      if (next_demand_sum > 0 && next_demand_sum > highest_found_demand) {
        known_trade = candidate_trade = next_candidate_trade;
        highest_found_demand = next_demand_sum;
        best_rate = guess;
      }
    } else {
      rate_upper_bound = guess;
    }
  }
  return candidate_trade == null ? null : {
    trade: candidate_trade,
    rate: { numerator: best_rate as bigint, denominator: rate_denominator },
  };
}

/* Not used
const reduceFillOrderFromPoolPairsWithStepperFilling = (pair_trade_list: Array<{ trade: AbstractTrade | null, pair: PoolPair }>, requested_amount: bigint, step_size: bigint, rate_denominator: bigint): Array<{ trade: AbstractTrade | null, pair: any }> => {
  if (step_size <= 0n) {
    throw new ValueError('step size should be greater than zero')
  }
  // copy the input pair_trade_list
  pair_trade_list = pair_trade_list.map((a) => ({ trade: structuredClone(a.trade), pair: a.pair }));
  let total_available = pair_trade_list.reduce((a, b) => a + bigIntMax(0n, b.pair.b - 1n), 0n);
  let total_acquired = pair_trade_list.reduce((a, b) => a + (b.trade ? b.trade.demand : 0n), 0n);
  const getStepForPair = (pair: PoolPair): bigint => bigIntMax(1n, bigIntMax(0n, pair.b - 1n) * step_size / total_available);
  while (total_acquired > requested_amount) {
    // list of items with trade
    const sub_trade_list: Array<{ trade: AbstractTrade, pair: PoolPair }> = pair_trade_list.filter((a) => a.trade != null) as any;
    // sort pools by rate in descending order
    bigIntArraySortPolyfill(sub_trade_list, (a, b) => b.trade.rate.numerator - a.trade.rate.numerator);
    // reduce fill from the sorted pairs
    let did_reduce = false;
    for (const entry of sub_trade_list) {
      const next_deduction = bigIntMin(getStepForPair(entry.pair), entry.trade.demand, total_acquired - requested_amount);
      if (next_deduction > 0n) {
        const trade_demand = entry.trade.demand - next_deduction;
        if (trade_demand <= 0n) {
          // entry will not get used beyond this point, cast to allow trade = null
          (entry as any).trade = null;
        } else {
          const trade = calcTradeToBuyTargetAmountFromAPair(entry.pair, trade_demand, rate_denominator);
          if (trade == null || trade.demand != trade_demand) {
            throw new InvalidProgramState('trade == null || demand != trade_demand!! (attempt to reduce order size)');
          }
          entry.trade = trade;
        }
        total_acquired -= next_deduction;
        did_reduce = true;
        break;
      }
    }
    if (!did_reduce) {
      throw new InvalidProgramState('reduce step fail!! (invalid size)');
    }
  }
  if (total_acquired != pair_trade_list.reduce((a, b) => a + (b.trade ? b.trade.demand : 0n), 0n)) {
    throw new InvalidProgramState('total_acquired do not match the sum!! (attempt to add to trade amount)')
  }
  if (total_acquired != requested_amount) {
    throw new InvalidProgramState('total_acquired != requested_amount!! (attempt to add to trade amount)')
  }
  return pair_trade_list;
};
*/

const generateExchangeTx = (compiler: libauth.CompilerBCH, input_pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_outputs:  Output[], data_locking_bytecode: Uint8Array | null): { result: libauth.TransactionGenerationAttempt<libauth.AuthenticationProgramStateBCH>, source_outputs: libauth.Output[] } => {
  const source_outputs: libauth.Output[] = [];
  const inputs: libauth.InputTemplate<libauth.CompilerBCH>[] = [];
  const outputs: libauth.OutputTemplate<libauth.CompilerBCH>[] = []
  for (const pool_trade of input_pool_trade_list) {
    const source_output = {
      lockingBytecode: pool_trade.pool.output.locking_bytecode,
      valueSatoshis: pool_trade.pool.output.amount,
      token: {
        amount: pool_trade.pool.output.token.amount as bigint,
        category: convertTokenIdToUint8Array(pool_trade.pool.output.token.token_id),
      },
    };
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
    const output = {
      lockingBytecode: locking_bytecode_result.bytecode,
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
  for (const payout_output of payout_outputs) {
    const output = {
      lockingBytecode: payout_output.locking_bytecode,
      token: payout_output.token ? {
        amount: payout_output.token.amount,
        category: convertTokenIdToUint8Array(payout_output.token.token_id),
      } : undefined,
      valueSatoshis: payout_output.amount,
    };
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
  };
};

const buildPayoutOutputs = (lab: ExchangeLab, payout_rules: PayoutRule[], aggregate_payout_list: Array<{ token_id: TokenId, amount: bigint }>, txfee: bigint, verify_payouts_are_paid: boolean): Output[] => {
  aggregate_payout_list = structuredClone(aggregate_payout_list);
  const payout_outputs: Output[] = [];
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
        throw new InvalidProgramState('native token is not in aggregate_payout_list!!')
      }
      const min_amount = lab.getOutputMinAmount(output);
      // set the amount to dust limit if amount is -1
      if (output.amount == -1n) {
        output.amount = min_amount;
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
      payout_outputs.push(output);
    } else if (payout_rule.type == PayoutAmountRuleType.CHANGE) {
      let mixed_payout: { bch: { token_id: TokenId, amount: bigint }, token: { token_id: TokenId, amount: bigint } } | undefined;
      // an initial value assigned cause, tsc emitting used before being assigned.
      let payouts: Array<{ token_id: TokenId, amount: bigint }> = [];
      const native_payout = aggregate_payout_list.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID);
      if (!native_payout) {
        throw new InvalidProgramState('native token is not in aggregate_payout_list!!')
      }
      if (payout_rule.allow_mixing_native_and_token) {
        const other_tokens_payout_list = aggregate_payout_list.filter((a) => a.token_id != NATIVE_BCH_TOKEN_ID);
        if (other_tokens_payout_list.length > 0 && native_payout.amount > 0n) {
          mixed_payout = {
            bch: native_payout,
            // tsc does not get that value of index 0 has a value, relax the type checking
            token: other_tokens_payout_list[0] as any,
          };
          payouts = other_tokens_payout_list.slice(1);
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
            if (!txfee_paid && payout.amount < txfee) {
              throw new ValueError(`Not enough change remained to pay the tx fee, fee = ${txfee}`)
            }
            if (payout.amount > txfee) {
              const payout_output = {
                locking_bytecode: payout_rule.locking_bytecode,
                amount: payout.amount - txfee,
              }
              const min_amount = lab.getOutputMinAmount(payout_output);
              if (payout_output.amount < min_amount) {
                throw new ValueError(`Not enough satoshis left to have the min amount in a (change) output, min: ${min_amount}`);
              }
              payout_outputs.push(payout_output);
            }
            txfee_paid = true;
          } else {
            const output = {
              locking_bytecode: payout_rule.locking_bytecode,
              token: {
                amount: payout.amount,
                token_id: payout.token_id,
              },
              amount: 0n,
            }
            const min_amount = lab.getOutputMinAmount(output);
            if (native_payout.amount < min_amount) {
              throw new ValueError(`Not enough satoshis left to have the min amount in a token (change) output, min: ${min_amount}`);
            }
            output.amount = min_amount;
            payout_outputs.push(output);
            native_payout.amount -= output.amount;
          }
          payout.amount = 0n;
        }
      }
      if (mixed_payout) {
        if (!txfee_paid && mixed_payout.bch.amount < txfee) {
          throw new ValueError(`Not enough change remained to pay the tx fee, fee = ${txfee}`)
        }
        const payout_output = {
          locking_bytecode: payout_rule.locking_bytecode,
          token: {
            amount: mixed_payout.token.amount,
            token_id: mixed_payout.token.token_id,
          },
          amount: mixed_payout.bch.amount - txfee,
        };
        const min_amount = lab.getOutputMinAmount(payout_output);
        if (payout_output.amount < min_amount) {
          throw new ValueError(`Not enough satoshis left to have the min amount in a mixed (change) output, min: ${min_amount}`);
        }
        txfee_paid = true;
        payout_outputs.push(payout_output);
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
        throw new ValueError(`payout_rules is not collecting the aggregate payouts from the exchange, unpaid token_id: ${aggregate_payout.token_id}, amount: ${aggregate_payout.amount}`)
      }
    }
  }
  return payout_outputs;
};

const prepareForARequestToConstructTrade = (supply_token_id: TokenId, demand_token_id: TokenId, input_pools: PoolV0[]): { pools_pair: Array<{ a: bigint, b: bigint, fee_paid_in_a: boolean, pool: PoolV0 }> } => {
  const pools_pair: Array<{ a: bigint, b: bigint, fee_paid_in_a: boolean, pool: PoolV0 }> = [];
  if (demand_token_id == NATIVE_BCH_TOKEN_ID) {
    for (const pool of input_pools) {
      pools_pair.push({
        a: pool.output.token.amount,
        b: pool.output.amount,
        fee_paid_in_a: false,
        pool,
      })
    }
  } else {
    for (const pool of input_pools) {
      pools_pair.push({
        a: pool.output.amount,
        b: pool.output.token.amount,
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
      throw new InvalidProgramState(`Failed import libauth template, error: ${template_result}`)
    }
    this._template = template_result;
    this._compiler = libauth.walletTemplateToCompilerBCH(this._template);
  }
  setRateDenominator (denominator: bigint) {
    this._rate_denominator = denominator;
  }
  getRateDenominator () {
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
  constructTradeAvailableAmountBelowTargetRate (supply_token_id: TokenId, demand_token_id: TokenId, rate: Fraction, input_pools: PoolV0[]): TradeResult | null {
    const target_rate = convertFractionDenominator(rate, this._rate_denominator);
    const { pools_pair } = prepareForARequestToConstructTrade(supply_token_id, demand_token_id, input_pools);
    const result_entries: PoolTrade[] = [];
    for (const pool_pair of pools_pair) {
      const lower_bound = 1n;
      const upper_bound = pool_pair.b;
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
    const { pools_pair } = prepareForARequestToConstructTrade(supply_token_id, demand_token_id, input_pools);
    const result_entries: PoolTrade[] = [];
    for (const pool_pair of pools_pair) {
      const lower_bound = 1n;
      const upper_bound = pool_pair.b;
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
  constractTradeBestRateForTargetAmount (supply_token_id: TokenId, demand_token_id: TokenId, amount: bigint, input_pools: PoolV0[], txfee_per_byte: bigint): TradeResult {
    const rate_denominator = this._rate_denominator;
    const { pools_pair } = prepareForARequestToConstructTrade(supply_token_id, demand_token_id, input_pools);
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
    // requested amount is acquired
    // now use the aggregate rate as the base trade and then find the best rate with successive approximation.
    let candidate_trade: Array<{ pair: PoolPair, trade: AbstractTrade }> | null = null;
    let candidate_rate: Fraction | null = null;
    if (input_pools.length > 1) {
      const result = bestRateToTradeInPoolsForTargetAmount(fee_paid_in_demand, pools_pair, amount, rate_denominator);
      if (result != null) {
        candidate_trade = result.trade;
        candidate_rate = result.rate;
      }
    }
    /*
      the need, set a lower limit on included pools by taking trade's fixed cost into account.
      eliminate net negative pools based on the demand amount
    */
    if (candidate_trade != null && candidate_trade.length > 1 && txfee_per_byte > 0n) {
      let exhausted = false;
      const pool_fixed_cost = {
        supply: !fee_paid_in_demand ? sizeOfPoolV0InAnExchangeTx() * txfee_per_byte : 0n,
        demand: fee_paid_in_demand ? sizeOfPoolV0InAnExchangeTx() * txfee_per_byte : 0n,
      };
      const changeInRateWithFixedCost = (trade: AbstractTrade): bigint => (trade.supply + pool_fixed_cost.supply) * rate_denominator  / (trade.demand - pool_fixed_cost.demand) - (trade.supply * rate_denominator / trade.demand);
      while (!exhausted) {
        const entries = candidate_trade.map((a) => ({ pair: a.pair, trade: a.trade, change_in_rate_with_fixed_cost: changeInRateWithFixedCost(a.trade) }));
        bigIntArraySortPolyfill(entries, (a, b) => b.change_in_rate_with_fixed_cost - a.change_in_rate_with_fixed_cost);
        const initial_avg_rate = calcTradeAvgRate(sumAbstractTradeList(candidate_trade.map((a) => a.trade)) as AbstractTrade, rate_denominator);
        let highest_benefit_rate = initial_avg_rate.numerator;
        let highest_benefit_result = null;
        for (let i = entries.length - 1; i > 0; i--) {
          const eliminate_candidate = entries.slice(0, i);
          const keep_candidate = entries.slice(i);
          const rate_lower_bound = (candidate_rate as Fraction).numerator;
          // TODO:: verify upper_bound is actually the highest possible rate + 1n
          const rate_upper_bound = bigIntMax(...keep_candidate.map((a) => calcPairRate({ a: a.pair.a + a.pair.b - 1n, b: 1n, fee_paid_in_a: a.pair.fee_paid_in_a }, rate_denominator).numerator + 1n));
          const result = increaseTradeDemandWithBestRate(fee_paid_in_demand, keep_candidate, amount, rate_lower_bound, rate_upper_bound, rate_denominator);
          if (result != null) {
            const resized_trade_sum = sumAbstractTradeList(result.trade.map((a) => a.trade)) as AbstractTrade;
            // keep ratio with the benefit of eliminating the other pools (avg rate)
            const eliminate_count = BigInt(eliminate_candidate.length);
            const ratio_with_benefit = (resized_trade_sum.supply - pool_fixed_cost.supply * eliminate_count) * rate_denominator / (resized_trade_sum.demand + pool_fixed_cost.demand * eliminate_count);
            // original trade avg rate
            if (ratio_with_benefit < highest_benefit_rate) {
              // replace
              highest_benefit_rate = ratio_with_benefit;
              highest_benefit_result = result;
            }
          }
        }
        if (highest_benefit_result != null) {
          candidate_trade = highest_benefit_result.trade;
          candidate_rate = highest_benefit_result.rate;
        } else {
          break; // no more eliminations
        }
      }
    }
    // fill up the remaining amount if needed
    const stepper_size = 10n;
    if (candidate_trade == null) {
      const tmp = fillOrderFromPoolPairsWithStepperFilling(pools_pair.map((pair) => ({ pair, trade: null })), amount, bigIntMax(1n, amount / stepper_size), rate_denominator);
      if (tmp == null) {
        throw new InsufficientCapitalInPools('Not enough tokens available in input pools.', { requires: amount, pools: input_pools });
      }
      candidate_trade = tmp.filter((a) => a.trade != null) as Array<{ pair: PoolPair, trade: AbstractTrade }>;
    } else {
      const candidate_trade_demand_sum: bigint = candidate_trade.reduce((a, b) => a + b.trade.demand, 0n) +
        (fee_paid_in_demand ? candidate_trade.reduce((a, b) => a + b.trade.trade_fee, 0n) : 0n);
      if (candidate_trade_demand_sum < amount) {
        // fill to order size
        const pair_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }> = candidate_trade;
        const entries = pools_pair.map((pair) => {
          const pair_trade = pair_trade_list.find((a) => (a.pair as any).pool == pair.pool);
          return { pair, trade: pair_trade != null ? pair_trade.trade : null };
        });
        const tmp = fillOrderFromPoolPairsWithStepperFilling(entries, amount, bigIntMax(1n, (amount - candidate_trade_demand_sum) / stepper_size), rate_denominator);
        if (tmp == null) {
          throw new InvalidProgramState('Stepper filling failed to fill order from pools, Enough tokens should exists in the pools!');
        }
        candidate_trade = tmp.filter((a) => a.trade != null) as Array<{ pair: PoolPair, trade: AbstractTrade }>;
      }
    }
    const result_entries: PoolTrade[] = [];
    for (const entry of candidate_trade) {
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
      // the impl requires entires to have at least a trade, So trade summary will not be null
      summary: calcTradeSummary(candidate_trade.map((a) => a.trade).filter((a) => !!a) as Array<AbstractTrade>, rate_denominator) as TradeSummary,
    };
  }
  /*
    input_pool_trade_list
    input_coins should have enough tokens to fund sum of supply + trade_fee.
    payout_rules define the payout outputs for the demand side + change.
   */
  writeTradeTx (input_pool_trade_list: PoolTrade[], input_coins: SpendableCoin[], payout_rules: PayoutRule[], data_locking_bytecode: Uint8Array | null, txfee_per_byte: number | bigint): TradeTxResult {
    txfee_per_byte = typeof txfee_per_byte == 'bigint' ? txfee_per_byte : BigInt(txfee_per_byte);
    if (txfee_per_byte < 0n) {
      throw new ValueError('txfee should be greater than or equal to zero');
    }
    // validate input_pool_trade_list
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
    for (const pool_trade of input_pool_trade_list) {
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
      if (token_total_fund < entry.offer) {
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
          throw new ValueError(`A provided funding coin has a defined nft, outpoint: ${uint8ArrayToHex(coin.outpoint.txhash)}:${coin.outpoint.index}`);
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
    let txfee = 0n;
    // build the payout outputs, apply payout rules
    let payout_outputs: Output[] = buildPayoutOutputs(this, payout_rules, aggregate_payout_list, 0n, txfee_per_byte == 0n ? true : false);
    // construct the transaction
    let { result, source_outputs } = generateExchangeTx(this._compiler, input_pool_trade_list, input_coins, payout_outputs, data_locking_bytecode);
    if (!result.success) {
      throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '));
    }
    let txbin = libauth.encodeTransaction(result.transaction);
    if (txfee_per_byte > 0n) {
      txfee = BigInt(txbin.length) * BigInt(txfee_per_byte)
      payout_outputs = buildPayoutOutputs(this, payout_rules, aggregate_payout_list, txfee, true);
      // regenerate once the fee is deducted from the payout
      ({ result, source_outputs } = generateExchangeTx(this._compiler, input_pool_trade_list, input_coins, payout_outputs, data_locking_bytecode));
      if (!result.success) {
        throw new InvalidProgramState('generate transaction failed!, errors: ' + JSON.stringify(result.errors, null, '  '))
      }
      txbin = libauth.encodeTransaction(result.transaction);
    }
    return {
      txbin,
      txfee,
      payout_outputs,
      libauth_source_outputs: source_outputs,
      libauth_generated_transaction: result.transaction,
    };
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
      throw new InvalidProgramState('generate locking code failed, script: cauldron_poolv0, ' + JSON.stringify(locking_bytecode_result, null, '  '))
    }
    return locking_bytecode_result.bytecode;
  }
}


