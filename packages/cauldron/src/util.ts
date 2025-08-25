import {
  ceilingValueOfBigIntDivision, bigIntMax, bigIntMin, bigIntArraySortPolyfill
 } from '@cashlab/common/util.js';
import { InvalidProgramState, ValueError, NotFoundError } from '@cashlab/common/exceptions.js';
import type { Fraction } from '@cashlab/common/types.js';
import type { TradeSummary, AbstractTrade } from './types.js';

export type PoolPair = { a: bigint, b: bigint, fee_paid_in_a: boolean, a_min_reserve: bigint, b_min_reserve: bigint };

export const calcTradeAvgRate = (trade: AbstractTrade, rate_denominator: bigint): Fraction => {
  return { numerator: trade.supply * rate_denominator / trade.demand, denominator: rate_denominator };
};

export const calcPairRate = (pair: PoolPair | { a: bigint, b: bigint }, rate_denominator: bigint): Fraction => {
  const K = pair.a * pair.b;
  return { numerator: K * rate_denominator / (pair.b * pair.b), denominator: rate_denominator }
};

export const calcPairRateWithKB = (K: bigint, b: bigint, rate_denominator: bigint): bigint => {
  return (K * rate_denominator) / (b * b);
};

export const sumAbstractTradeList = (trade_list: AbstractTrade[]): AbstractTrade | null => {
  const demand = trade_list.reduce((a, b) => a + b.demand, 0n);
  const supply = trade_list.reduce((a, b) => a + b.supply, 0n);
  return supply > 0n && demand > 0n ? {
    demand, supply,
    trade_fee: trade_list.reduce((a, b) => a + b.trade_fee, 0n),
  } : null;
};

export const calcTradeSummary = (trade_list: AbstractTrade[], rate_denominator: bigint): TradeSummary | null => {
  const demand = trade_list.reduce((a, b) => a + b.demand, 0n);
  const supply = trade_list.reduce((a, b) => a + b.supply, 0n);
  return supply > 0n && demand > 0n ? {
    demand, supply,
    rate: { numerator: supply * rate_denominator / demand, denominator: rate_denominator },
    trade_fee: trade_list.reduce((a, b) => a + b.trade_fee, 0n),
  } : null;
};

export const calcTradeFee = (a: bigint): bigint => a * 3n / 1000n;
/* NOT USED
const __includeFeeToAmount = (amount: bigint): bigint => {
  let x1 = amount;
  let x2 = amount + calcTradeFee(amount);
  let trylen = 0;
  while (true) {
    const x2_more_fee = calcTradeFee(x2 - x1);
    if (!(x2_more_fee > 0n)) {
      break;
    }
    x1 = x2;
    x2 += x2_more_fee;
    if (trylen++ > 5) {
      / * c8 ignore next * /
      throw new InvalidProgramState('too many attempt to add x2_more_fee!!')
    }
  }
  return x2;
};
*/
const __pairIncludeFeeForTarget = (target: bigint, initial: bigint): bigint => {
  let x1 = target;
  let x2 = target + calcTradeFee(target - initial);
  let trylen = 0;
  while (x2 - calcTradeFee(x2 - initial) < target) {
    const more_fee = bigIntMax(1n, calcTradeFee(x2 - x1));
    x1 = x2;
    x2 = x1 + more_fee;
    if (more_fee == 1n && trylen++ > 5) {
      /* c8 ignore next */
      throw new InvalidProgramState('too many attempt to add more_fee=1n!!')
    }
  }
  return x2;
};

/* NOT COMPLETE
const __pairLeaveFeeInPoolForMinTarget__ = (target: bigint, initial: bigint) => {
  /*
    x1 = x0 + fee
    C = 3n / 1000n
    x1 = x0 + fee
    x1 = x0 + (x1 - initial) * C
    x1 = x0 + x1 * C - initial * C
    x1 = x0 * (1 + C) - initial * c
    x1 * (1 - C) = x0 - initial * C
    x1 = (x0 - initial * C) / (1 - C)
    x1 = (x0 - initial * 3 / 1000) / (1 - 3 / 1000)
    x1 = (x0 - initial * 3 / 1000) / (1000 / 1000 - 3 / 1000)
    x1 = (x0 - initial * 3 / 1000) / (997 / 1000)
    x1 = ((x0 * 1000 - initial * 3) / 1000) * (1000 / 997)
    x1 = (x0 * 1000 - initial * 3) / 997
  * /
  const x1 = ((target * 1000n - initial * 3n) / 997n);
  const reserved_trade_fee = target - x1;
  const trade_fee = calcTradeFee(initial - target);
  const error_threshold = 1n;
  if (trade_fee - reserved_trade_fee > error_threshold) {
    / * c8 ignore next * /
    throw new InvalidProgramState(`expecting the difference of trade fee and calculated reserved_trade_fee to not exceed the threshold (${error_threshold}), diff = ${trade_fee - reserved_trade_fee}!!`);
  } else if (reserved_trade_fee > trade_fee) {
    / * c8 ignore next * /
    throw new InvalidProgramState(`expecting the reserved_trade_fee to not be greater than trade fee by a threshold, threshold: (${error_threshold}), ${reserved_trade_fee} > ${trade_fee}!!`);
  } else {
    return { x1, x2: x1 + trade_fee - reserved_trade_fee, trade_fee, reserved_trade_fee }
  }
};
*/
const __pairLeaveFeeInPoolForTarget = (target: bigint, initial: bigint) => {
  /*
    initial > target
    Assuming x0 contains the fee in it, The following formula deducts the fee from target.
    --- x1 = x0 - fee
    C = 3n / 1000n
    x1 = x0 - fee
    x1 = x0 - (x1 - initial) * C
    x1 = x0 - x1 * C + initial * C
    x1 * (1 + C) = x0 + initial * C
    x1 = (x0 + initial * C) / (1 + C)
    x1 = 1/1000 * (1000 * x0 + initial * 3) * 1000 / 1003
    x1 = (x0 * 1000 + initial * 3) / 1003
  */
  const x1 = ((target * 1000n + initial * 3n) / 1003n);
  for (const entry of  [ [0n, x1 + 1n], [1n, x1] ]) {
    const error_threshold: bigint = entry[0] as any;
    const x1i: bigint = entry[1] as any;
    const reserved_trade_fee = x1i - target;
    const trade_fee = calcTradeFee(initial - x1i);
    const diff = trade_fee - reserved_trade_fee;
    if (diff >= 0n && diff <= error_threshold) {
      return { value: x1i + diff, trade_fee }
    }
  }
  console.error({ x1, target, initial });
  throw new InvalidProgramState(`__pairLeaveFeeInPoolForTarget failed to return a value!!`);
  /*
  const reserved_trade_fee = x1 - target;
  const trade_fee = calcTradeFee(initial - x1);
  const error_threshold = 1n;
  if (trade_fee - reserved_trade_fee > error_threshold) {
    / * c8 ignore next * /
    throw new InvalidProgramState(`expecting the difference of trade fee and calculated reserved_trade_fee to not exceed the threshold (${error_threshold}), diff = ${trade_fee - reserved_trade_fee}!!`);
  } else if (reserved_trade_fee > trade_fee) {
    / * c8 ignore next * /
    throw new InvalidProgramState(`expecting the reserved_trade_fee to not be greater than trade fee by a threshold, threshold: (${error_threshold}), ${reserved_trade_fee} > ${trade_fee}!!`);
  } else {
    return { x1, x2: x1 + trade_fee - reserved_trade_fee, trade_fee, reserved_trade_fee }
  }
  */
};
const __pairLeaveFeeInPoolForMinTarget = (target: bigint, initial: bigint) => {
  /*
    initial > target
    x1 = x0 + fee
    C = 3n / 1000n
    x1 = x0 + fee
    x1 = x0 + (x0 - initial) * C
    x1 = x0 + x0 * C - initial * C
    x1 = x0 * (1 + C) - initial * C
    x1 = x0 * (1003 / 1000) - initial * 3 / 1000
    x1 = 1/1000 * (x0 * 1003 - initial * 3)
    x1 = (x0 * 1003 - initial * 3) / 1000
  */
  const x1 = (target * 1003n - initial * 3n) / 1000n;
  for (const entry of  [ [0n, x1 + 1n], [1n, x1] ]) {
    const error_threshold: bigint = entry[0] as any;
    const x1i: bigint = entry[1] as any;
    const reserved_trade_fee = target - x1i;
    const trade_fee = calcTradeFee(initial - target);
    const diff = reserved_trade_fee - trade_fee;
    if (diff >= 0n && diff <= error_threshold) {
      return { value: x1i - diff, trade_fee }
    }
  }
  console.error({ x1, target, initial });
  throw new InvalidProgramState(`__pairLeaveFeeInPoolForMinTarget failed to return a value!!`);
};



const __tradeSanityCheck = (data: { pair_a_1: bigint, pair_b_1: bigint, trade_fee: bigint, K: bigint, pair: PoolPair }) => {
  const { pair_a_1, pair_b_1, trade_fee, K, pair } = data;
  try {
    if (pair_b_1 > pair.b) {
      /* c8 ignore next */
      throw new InvalidProgramState('expecting pair_b_1 to be <= pair.a!!');
    }
    if (pair_a_1 * pair_b_1 < K) {
      /* c8 ignore next */
      throw new InvalidProgramState('pair_a_1 * pair_b_1 is not >= K!!')
    }
    if (pair.fee_paid_in_a) {
      if ((pair_a_1 - trade_fee) * pair_b_1 < K) {
        /* c8 ignore next */
        throw new InvalidProgramState('(pair_a_1 - trade_fee) * pair_b_1 < K!!');
      }
      if ((pair_a_1 - 1n - trade_fee) * pair_b_1 >= K) {
        /* c8 ignore next */
        throw new InvalidProgramState('(pair_a_1 - 1n - trade_fee) * pair_b_1 >= K!!');
      }
      if ((pair_a_1 - trade_fee) * (pair_b_1 - 1n) >= K) {
        /* c8 ignore next */
        throw new InvalidProgramState('(pair_a_1 - trade_fee) * (pair_b_1 - 1n) >= K!!');
      }
    } else {
      if (pair_a_1 * (pair_b_1 - trade_fee) < K) {
        /* c8 ignore next */
        throw new InvalidProgramState('pair_a_1 * (pair_b_1 - trade_fee) < K!!');
      }
      if ((pair_a_1 - 1n) * (pair_b_1 - trade_fee) >= K) {
        /* c8 ignore next */
        throw new InvalidProgramState('(pair_a_1 - 1n) * (pair_b_1 - trade_fee) >= K!!');
      }
      if (pair_a_1 * (pair_b_1 - 1n - trade_fee) >= K) {
        /* c8 ignore next */
        throw new InvalidProgramState('pair_a_1 * (pair_b_1 - 1n - trade_fee) >= K!!');
      }
    }
    if (pair_a_1 < pair.a_min_reserve) {
      /* c8 ignore next */
      throw new InvalidProgramState('expecting pair_a_1 to not be less than min reserve!!');
    }
    if (pair_b_1 < pair.b_min_reserve) {
      /* c8 ignore next */
      throw new InvalidProgramState('expecting pair_b_1 to not be less than min reserve!!');
    }
    if (pair_a_1 <= pair.a) {
      /* c8 ignore next */
      throw new InvalidProgramState('pair_a_1 <= pair.a!!');
    }
    if (pair.b <= pair_b_1) {
      /* c8 ignore next */
      throw new InvalidProgramState('pair.b <= pair_b_1!!');
    }
  } catch (err) {
    console.debug({ ...data, name: (err as any).name, message: (err as any).message, stack: (new Error()).stack });
    throw err;
  }
}
export const calcTradeWithTargetDemandFromAPair = (pair: PoolPair, amount: bigint): AbstractTrade | null => {
  const K = pair.a * pair.b;
  const pre_b1 = bigIntMax(pair.b_min_reserve, pair.b - amount);
  const a1 = ceilingValueOfBigIntDivision(K, pre_b1);
  const b1 = ceilingValueOfBigIntDivision(K, a1);
  if (b1 > pre_b1) {
    /* c8 ignore next */
    throw new InvalidProgramState(`b1 > pre_b1, ${b1} > ${pre_b1}`);
  }
  let pair_a_1, pair_b_1, trade_fee;
  if (pair.fee_paid_in_a) {
    pair_a_1 = __pairIncludeFeeForTarget(a1, pair.a);
    pair_b_1 = b1;
    trade_fee = calcTradeFee(pair_a_1 - pair.a);
  } else {
    pair_a_1 = a1;
    const tmp = __pairLeaveFeeInPoolForTarget(b1, pair.b);
    pair_b_1 = tmp.value;
    trade_fee = tmp.trade_fee;
  }
  __tradeSanityCheck({ pair_a_1, pair_b_1, trade_fee, K, pair });
  const supply = pair_a_1 - pair.a;
  const demand = pair.b - pair_b_1;
  return demand > 0n && supply > 0n ? {
    demand, supply,
    trade_fee,
  } : null;
};
export const constructATradeWithMinDemandFromAPair = (pair: PoolPair, amount: bigint): AbstractTrade => {
  const K = pair.a * pair.b;
  let pair_a_1, pair_b_1, trade_fee;
  if (pair.b - amount < pair.b_min_reserve) {
    throw new ValueError(`Not enough amount in the pool for the required demand!`);
  }
  if (pair.fee_paid_in_a) {
    const pre_b1 = pair.b - amount;
    const a1 = ceilingValueOfBigIntDivision(K, pre_b1);
    const b1 = ceilingValueOfBigIntDivision(K, a1);
    if (b1 > pre_b1 || b1 < pair.b_min_reserve) {
      /* c8 ignore next */
      throw new InvalidProgramState(`b1 > pre_b1 || b1 < pair.b_min_reserve, ${b1} > ${pre_b1}`);
    }
    pair_a_1 = __pairIncludeFeeForTarget(a1, pair.a);
    pair_b_1 = b1;
    trade_fee = calcTradeFee(pair_a_1 - pair.a);
  } else {
    const tmp0 = __pairLeaveFeeInPoolForMinTarget(pair.b - amount, pair.b);
    const pre_b1 = tmp0.value;
    const a1 = ceilingValueOfBigIntDivision(K, pre_b1);
    const b1 = ceilingValueOfBigIntDivision(K, a1);
    const tmp1 = __pairLeaveFeeInPoolForTarget(b1, pair.b);
    pair_a_1 = a1;
    pair_b_1 = tmp1.value;
    trade_fee = tmp1.trade_fee;
    if (pair_b_1 < pair.b_min_reserve) {
      throw new ValueError(`Not enough amount in the pool for the required demand!`);
    }
    if (pair.b - pair_b_1 < amount) {
      /* c8 ignore next */
      throw new InvalidProgramState(`pair.b - pair_b_1 < amount, ${pair.b} - ${pair_b_1} < ${amount}`);
    }
  }
  const supply = pair_a_1 - pair.a;
  const demand = pair.b - pair_b_1;
  __tradeSanityCheck({ pair_a_1, pair_b_1, trade_fee, K, pair });
  if (demand < amount) {
    throw new ValueError(`Not enough amount in the pool for the required demand!`);
  }
  return {
    demand, supply,
    trade_fee,
  };
};

export const sizeOfPoolV0InAnExchangeTx = (): bigint => 197n


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

/*
const testCalcPairRateResult = (pair: PoolPair, trade: AbstractTrade, rate_denominator: bigint): any => {
  const zero_pair = { a: pair.a + trade.supply, b: pair.b - trade.demand, fee_paid_in_a: pair.fee_paid_in_a };
  const mone_trade = calcTradeWithTargetDemandFromAPair({ a: zero_pair.b, b: zero_pair.a, fee_paid_in_a: !pair.fee_paid_in_a }, 1n);
  const mone_trade_rate = mone_trade != null ? mone_trade.demand * rate_denominator / mone_trade.supply : 0n;
  const pone_trade = calcTradeWithTargetDemandFromAPair(zero_pair, 1n);
  const pone_trade_rate = pone_trade != null ? calcTradeAvgRate(pone_trade, rate_denominator).numerator : 0n;
  const pair_rate = calcPairRate(zero_pair, rate_denominator);
  if ((mone_trade_rate != 0n && mone_trade_rate > pair_rate.numerator) || (pone_trade_rate != 0n && pone_trade_rate < pair_rate.numerator)) {
    throw new InvalidProgramState('incorrect calcPairRate, ' + JSON.stringify({ c0rate: mone_trade_rate, c1rate: pair_rate.numerator, c2rate: pone_trade_rate }, (_, a) => typeof a == 'bigint' ? a+'' : a, '  ') + ' ---- \n' + JSON.stringify({ mone_trade, trade, pone_trade, pair:{a:pair.a, b:pair.b}, zero_pair,mone_trade_rate }, (_, a) => typeof a == 'bigint' ? a+'' : a, '  '))
  }
  return { zero_pair, mone_trade, mone_trade_rate, pone_trade }
}
*/

// lower_bound >= result < upper_bound
export const approxAvailableAmountInAPairAtTargetAvgRate = (pair: PoolPair, target_rate: Fraction, lower_bound: bigint, upper_bound: bigint): AbstractTrade | null => {
  let trade = null
  while (lower_bound < upper_bound) {
    const guess = lower_bound + (upper_bound - lower_bound) / 2n;
    const guess_trade = calcTradeWithTargetDemandFromAPair(pair, guess);
    if (guess_trade == null) {
      /* c8 ignore next */
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

/*
  alternative to approxAvailableAmountInAPairAtTargetRate is to calc demand from rate.
  The calc takes sqrt of the rate times a constant. It's not necessarily more efficient method.
  However, Likely only using the approx function once with a constant lower/upper bound is less
  efficient than calculating the sqrt.
  rate = K / b^2
  b^2 / K = 1 / rate
k  b^2 = K / rate
  b = sqrt(K / rate)
  b = sqrt(K / 1 / rate_n / rate_d)
  b = sqrt((K * rate_d) / rate_n)
 */

// lower_bound >= result.demand < upper_bound
export const approxAvailableAmountInAPairAtTargetRate = (pair: PoolPair, target_rate: Fraction, lower_bound: bigint, upper_bound: bigint): bigint | null => {
  let best_guess = null;
  const K = pair.a * pair.b;
  while (lower_bound < upper_bound) {
    const guess = lower_bound + (upper_bound - lower_bound) / 2n;
    const pre_b2 = pair.b - guess;
    const a2 = ceilingValueOfBigIntDivision(K, pre_b2);
    const b2 = ceilingValueOfBigIntDivision(K, a2);
    if (b2 < pair.b_min_reserve) {
      /* c8 ignore next */
      throw new InvalidProgramState('approxAvailableAmountInAPairAtTargetRate, b2 < pair.b_min_reserve!!');
    }
    // min(diff_rate(b2), max(tip_rate, diff_rate(b1)))
    let a1, b1;
    if ((a2 - pair.a) > (pair.b - b2)) {
      b1 = b2 + 1n;
      a1 = ceilingValueOfBigIntDivision(K, b1);
    } else {
      a1 = a2 - 1n;
      b1 = ceilingValueOfBigIntDivision(K, a1);
    }
    const tip_rate = ((a2 - a1) * target_rate.denominator) / (b1 - b2);
    const rate_b1 = calcPairRateWithKB(K, b1, target_rate.denominator);
    const rate_b2 = calcPairRateWithKB(K, b2, target_rate.denominator);
    const rate = bigIntMin(rate_b2, bigIntMax(tip_rate, rate_b1));
    if (rate > target_rate.numerator) {
      upper_bound = guess;
    } else {
      lower_bound = guess + 1n;
      best_guess = guess;
    }
  }
  return best_guess;
};


// lower_bound >= result.demand < upper_bound
export const approxAvailableAmountInAPairBelowTargetRate = (pair: PoolPair, target_rate: Fraction, lower_bound: bigint, upper_bound: bigint): bigint | null => {
  let best_guess = approxAvailableAmountInAPairAtTargetRate(pair, target_rate, lower_bound, upper_bound);
  if (best_guess != null) {
    // up to 10 iteration to fix rounding errors
    const K = pair.a * pair.b;
    let counter = 0;
    while (true) {
      const pre_b2 = pair.b - best_guess;
      const a2 = ceilingValueOfBigIntDivision(K, pre_b2);
      const b2 = ceilingValueOfBigIntDivision(K, a2);
      if (b2 < pair.b_min_reserve) {
        /* c8 ignore next */
        throw new InvalidProgramState('approxAvailableAmountInAPairBelowTargetRate, b2 < pair.b_min_reserve!!');
      }
      let a1, b1;
      if ((a2 - pair.a) > (pair.b - b2)) {
        b1 = b2 + 1n;
        a1 = ceilingValueOfBigIntDivision(K, b1);
      } else {
        a1 = a2 - 1n;
        b1 = ceilingValueOfBigIntDivision(K, a1);
      }
      const tip_rate = ((a2 - a1) * target_rate.denominator) / (b1 - b2);
      if (tip_rate < target_rate.numerator) {
        break;
      }
      const next_guess = pair.b - b1;
      if (next_guess < lower_bound) {
        best_guess = null; // no match found
        break;
      }
      if (next_guess >= best_guess) {
        throw new InvalidProgramState(`next_guess >= best_guess !!`);
      }
      best_guess = next_guess;
      counter += 1;
      if (counter > 10) {
        throw new InvalidProgramState(`10 iteration reached and failed to fix the rounding error!`);
      }
    }
  }
  return best_guess;
};


export const fillTradeToTargetDemandFromPairsWithFillingStepper = (initial_pair_trade_list: Array<{ trade: AbstractTrade | null, pair: PoolPair }>, requested_amount: bigint, step_size: bigint, rate_denominator: bigint): Array<{ trade: AbstractTrade, pair: any }> | null => {
  if (step_size <= 0n) {
    throw new ValueError('step size should be greater than zero')
  }
  const pair_trade_list: Array<{ trade: AbstractTrade | null, next_step_trade: any, pair: PoolPair }> = initial_pair_trade_list.map((a) => ({ trade: a.trade, next_step_trade: null, pair: a.pair }));
  let total_available = pair_trade_list.reduce((a, b) => a + bigIntMax(0n, b.pair.b - b.pair.b_min_reserve - calcTradeFee(b.pair.b - b.pair.b_min_reserve)), 0n);
  if (total_available <= 0n) {
    return null;
  }
  let total_acquired = pair_trade_list.reduce((a, b) => a + (b.trade != null ? b.trade.demand: 0n), 0n);
  const getStepForPair = (pair: PoolPair): bigint => bigIntMax(1n, bigIntMax(0n, total_available == 0n ? 0n : pair.b - pair.b_min_reserve) * step_size / total_available)
  while (total_acquired < requested_amount) {
    pair_trade_list.forEach((entry) => {
      if (!entry.next_step_trade) {
        const next_step = getStepForPair(entry.pair);
        const next_demand = (entry.trade ? entry.trade.demand + (!entry.pair.fee_paid_in_a ? entry.trade.trade_fee : 0n) : 0n) + next_step;
        const next_trade = calcTradeWithTargetDemandFromAPair(entry.pair, next_demand);
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
      const next_addition = (entry.next_step_trade.demand as bigint) - (entry.trade != null ? entry.trade.demand : 0n);
      if (next_addition > 0n) {
        if (next_addition > requested_amount - total_acquired) {
          try {
            const trade_demand = (requested_amount - total_acquired) + (entry.trade != null ? entry.trade.demand : 0n);
            const trade = constructATradeWithMinDemandFromAPair(entry.pair, trade_demand);
            total_acquired += trade.demand - (entry.trade != null ? entry.trade.demand : 0n);
            entry.trade = trade;
          } catch (err) {
            if (err instanceof ValueError) {
              return null; // not enough tokens
            } else {
              throw err;
            }
          }
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
  if (total_acquired != pair_trade_list.reduce((a, b) => a + (b.trade ? b.trade.demand : 0n), 0n)) {
    /* c8 ignore next */
    throw new InvalidProgramState('total_acquired do not match the sum!! (attempt to add to trade amount)')
  }
  if (total_acquired < requested_amount) {
    /* c8 ignore next */
    throw new InvalidProgramState('total_acquired < requested_amount!! (attempt to add to trade amount)')
  }
  return pair_trade_list.map((entry) => {
    delete (entry as any).next_step_trade;
    return entry;
  }).filter((a) => a.trade != null) as Array<{ pair: PoolPair, trade: AbstractTrade }>;
};
export const constructTradeInPoolsBelowTargetRateInDemandRange = (pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }>, rate: Fraction): Array<{ pair: PoolPair, trade: AbstractTrade, best_guess: bigint }> => {
  return pools_set.map((a) => {
    let best_guess = approxAvailableAmountInAPairAtTargetRate(a.pair, rate, a.lower_bound, a.upper_bound);
    let trade = null;
    if (best_guess != null) {
      trade = calcTradeWithTargetDemandFromAPair(a.pair, best_guess);
      if (trade == null) {
        /* c8 ignore next */
        throw new InvalidProgramState('derived trade from best guess is null!!')
      }
    }
    return { pair: a.pair, trade, best_guess };
  })
    .filter((a)=> a.trade != null) as Array<{ pair: PoolPair, trade: AbstractTrade, best_guess: bigint }>;
};
export const bestRateToTradeInPoolsForTargetDemand = (pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }>, amount: bigint, lower_bound: bigint, upper_bound: bigint, rate_denominator: bigint): { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } | null  => {
  /*
    The best is the lowest found aggregate rate.
    The successive approximation algorithm is used to find lowest rate to acquire the most.
    Based on available amount at a rate.
  */
  let candidate_trade: Array<{ pair: PoolPair, trade: AbstractTrade, best_guess: bigint }> | null = null;
  let candidate_sum: AbstractTrade | null = null;
  let best_rate = null;
  while (lower_bound < upper_bound) {
    const guess = lower_bound + (upper_bound - lower_bound) / 2n;
    const next_candidate_trade = constructTradeInPoolsBelowTargetRateInDemandRange(pools_set, { numerator: guess, denominator: rate_denominator });
    const next_candidate_sum = sumAbstractTradeList(next_candidate_trade.map((a) => a.trade));
    if (next_candidate_sum == null) { // no liquidity at this rate
      lower_bound = guess + 1n;
      continue;
    }
    if (next_candidate_sum.demand <= amount &&
        (candidate_sum == null || next_candidate_sum.demand > candidate_sum.demand ||
          (next_candidate_sum.demand == candidate_sum.demand && next_candidate_sum.supply < candidate_sum.supply))) {
      candidate_trade = next_candidate_trade;
      candidate_sum = next_candidate_sum;
      best_rate = guess;
    }
    if (next_candidate_sum.demand < amount) {
      lower_bound = guess + 1n;
      pools_set = pools_set.map((entry) => {
        const target_pair_trade = next_candidate_trade.find((a) => a.pair == entry.pair);
        if (target_pair_trade != null && target_pair_trade.trade != null) {
          entry = { pair: entry.pair, lower_bound: target_pair_trade.best_guess - 1n, upper_bound: entry.upper_bound };
        }
        return entry;
      });
    } else {
      upper_bound = guess;
      pools_set = pools_set.map((entry) => {
        const target_pair_trade = next_candidate_trade.find((a) => a.pair == entry.pair);
        if (target_pair_trade != null && target_pair_trade.trade != null) {
          entry = { pair: entry.pair, lower_bound: entry.lower_bound, upper_bound: bigIntMin(target_pair_trade.best_guess + 1n, entry.pair.b - entry.pair.b_min_reserve + 1n) };
        }
        return entry;
      });
    }
  }
  return candidate_trade == null ? null : {
    trade: candidate_trade.map((a) => ({ pair: a.pair, trade: a.trade })),
    rate: { numerator: best_rate as bigint, denominator: rate_denominator },
  };
}
/* Not Used
const eliminateNetNegativePoolsInATrade = (pool_fixed_cost: { supply: bigint, demand: bigint }, candidate_trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate_denominator: bigint): Array<{ pair: PoolPair, trade: AbstractTrade }> => {
  if (pool_fixed_cost.supply <= 0n && pool_fixed_cost.demand <= 0n) {
    return candidate_trade;
  }
  const changeInRateWithFixedCost = (trade: AbstractTrade, cost_pool_count: bigint): bigint | null => {
    const ratio_with_cost = ratioFixedCostWithCost(trade, cost_pool_count);
    if (ratio_with_cost == null) {
      return null;
    }
    return ratio_with_cost - (trade.supply * rate_denominator / trade.demand);
  };
  const ratioFixedCostWithCost = (trade: AbstractTrade, cost_pool_count: bigint): bigint | null => {
    const v0 = trade.demand - (pool_fixed_cost.demand * cost_pool_count);
    if (v0 <= 0n) {
      return null;
    }
    return ((trade.supply + (pool_fixed_cost.supply * cost_pool_count)) * rate_denominator)  / v0;
  };
  const tradeExcludingSubTrade = (trade: AbstractTrade, sub_trade: AbstractTrade): { trade: AbstractTrade, ratio: bigint } => {
    if (trade.supply < sub_trade.supply) {
      throw new ValueError('trade.supply should be greater than sub_trade.supply');
    }
    if (trade.demand < sub_trade.demand) {
      throw new ValueError('trade.demand should be greater than sub_trade.demand');
    }
    const xtrade = {
      supply: trade.supply - sub_trade.supply,
      demand: trade.demand - sub_trade.demand,
      trade_fee: trade.trade_fee - sub_trade.trade_fee,
    };
    return { trade: xtrade, ratio: (xtrade.supply * rate_denominator) / xtrade.demand };
  };
  const initial_entries: Array<{ pair: PoolPair, trade: AbstractTrade, change_in_rate_with_fixed_cost: bigint }> = candidate_trade.map((a) => ({ pair: a.pair, trade: a.trade, change_in_rate_with_fixed_cost: changeInRateWithFixedCost(a.trade, 1n) }))
    // eliminate when fixed cost's change in rate is null
    .filter((a) => a.change_in_rate_with_fixed_cost != null) as Array<{ pair: PoolPair, trade: AbstractTrade, change_in_rate_with_fixed_cost: bigint }>;
  bigIntArraySortPolyfill(initial_entries, (a, b) => a.change_in_rate_with_fixed_cost - b.change_in_rate_with_fixed_cost);
  let entries = initial_entries;
  let entries_sum = sumAbstractTradeList(entries.map((a) => a.trade)) as AbstractTrade;
  if (entries.length == 0 || entries_sum == null) {
    return [];
  }
  while (entries.length > 1) {
    const keep_candidate = entries.slice(0, entries.length - 1);
    const eliminate_candidate = entries.slice(entries.length - 1);
    const eliminate_candidate_sum = sumAbstractTradeList(eliminate_candidate.map((a) => a.trade));
    if (eliminate_candidate_sum == null) {
        / * c8 ignore next * /
      throw new ValueError('sum of eliminate_candidate is null!');
    }
    let keep_trade_sum: AbstractTrade, keep_trade_ratio: bigint;
    {
      const tmp = tradeExcludingSubTrade(entries_sum, eliminate_candidate_sum);
      keep_trade_sum = tmp.trade;
      keep_trade_ratio = tmp.ratio;
    }
    const ratio_with_cost = ratioFixedCostWithCost(entries_sum, BigInt(eliminate_candidate.length));
    if (ratio_with_cost == null || ratio_with_cost > keep_trade_ratio) {
      entries = keep_candidate;
      entries_sum = keep_trade_sum;
    } else {
      break; // done
    }
  }
  return entries.map((a) => ({ pair: a.pair, trade: a.trade }));
};
*/
export const eliminatePoolsBasedOnMinTransferInATrade  = (pool_fixed_cost: { supply: bigint, demand: bigint }, candidate_trade: Array<{ pair: PoolPair, trade: AbstractTrade }>): Array<{ pair: PoolPair, trade: AbstractTrade }> => {
  if (pool_fixed_cost.supply <= 0n && pool_fixed_cost.demand <= 0n) {
    return candidate_trade;
  }
  candidate_trade = candidate_trade.slice();
  for (let i = 0; i < candidate_trade.length; ) {
    const entry = candidate_trade[i];
    if (entry != null && entry.trade.demand > pool_fixed_cost.demand &&
        entry.trade.supply > pool_fixed_cost.supply) {
      i++;
    } else {
      candidate_trade.splice(i, 1);
    }
  }
  return candidate_trade;
};

export const eliminateNetNegativePoolsInATradeWithTargetDemand = (pool_fixed_cost: { supply: bigint, demand: bigint }, candidate_trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, amount: bigint, rate_lower_bound: bigint, rate_upper_bound: bigint, rate_denominator: bigint): { keep_pool_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }>, trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } => {
  return eliminateNetNegativePoolsInATradeATarget(pool_fixed_cost, candidate_trade, amount, rate_lower_bound, rate_upper_bound, rate_denominator, {
    name: 'demand',
    fillTrade: fillTradeToTargetDemandFromPairsWithFillingStepper,
    bestRate: bestRateToTradeInPoolsForTargetDemand,
  });
};
export const eliminateNetNegativePoolsInATradeWithTargetSupply = (pool_fixed_cost: { supply: bigint, demand: bigint }, candidate_trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, amount: bigint, rate_lower_bound: bigint, rate_upper_bound: bigint, rate_denominator: bigint): { keep_pool_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }>, trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction }  => {
  return eliminateNetNegativePoolsInATradeATarget(pool_fixed_cost, candidate_trade, amount, rate_lower_bound, rate_upper_bound, rate_denominator, {
    name: 'supply',
    fillTrade: fillTradeToTargetSupplyFromPairsWithFillingStepper,
    bestRate: bestRateToTradeInPoolsForTargetSupply,
  });
};

const eliminateNetNegativePoolsInATradeATarget = (
  pool_fixed_cost: { supply: bigint, demand: bigint },
  input_trade: Array<{ pair: PoolPair, trade: AbstractTrade }>,
  amount: bigint, rate_lower_bound: bigint, rate_upper_bound: bigint, rate_denominator: bigint,
  target: {
    name: 'demand' | 'supply',
    bestRate: (pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }>, amount: bigint, lower_bound: bigint, upper_bound: bigint, rate_denominator: bigint) => { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } | null,
    fillTrade: (initial_pair_trade_list: Array<{ trade: AbstractTrade | null, pair: PoolPair }>, requested_amount: bigint, step_size: bigint, rate_denominator: bigint) => Array<{ trade: AbstractTrade, pair: any }> | null,
  }
): { keep_pool_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }>, trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } => {
  if (pool_fixed_cost.supply == 0n && pool_fixed_cost.demand == 0n) {
    throw new NotFoundError();
  }
  const changeInRateWithFixedCost = (trade: AbstractTrade): bigint | null => {
    if (trade.demand - pool_fixed_cost.demand <= 0n) {
      return null;
    }
    return (trade.supply + pool_fixed_cost.supply) * rate_denominator  / (trade.demand - pool_fixed_cost.demand) - (trade.supply * rate_denominator / trade.demand);
  };
  type EntryType = { pair: PoolPair, lower_bound: bigint, upper_bound: bigint, trade: AbstractTrade };
  let entries: EntryType[];
  { // sort by changeInRateWithFixedCost in asc order
    const tmp: Array<{ item: any, value: bigint }> = input_trade.map((a) => ({ item: a, value: changeInRateWithFixedCost(a.trade) }))
          .filter((a) => a.value != null) as Array<{ item: any, value: bigint }>;
    bigIntArraySortPolyfill(tmp, (a, b) => a.value - b.value);
    entries = tmp.map((a) => ({ pair: a.item.pair, lower_bound: a.item.trade[target.name], upper_bound: (target.name == 'demand' ? a.item.pair.b - a.item.pair.b_min_reserve : requiredSupplyToMaxOutAPair(a.item.pair)), trade: a.item.trade })) as any;
  }
  const entries_sum = sumAbstractTradeList(entries.map((a) => a.trade));
  if (entries.length == 0 || entries_sum == null) {
    return { keep_pool_trade_list: [], trade: [], rate: { numerator: 0n, denominator: rate_denominator } };
  }
  const elimiateSub = (keep_candidate: EntryType[], eliminate_candidate: EntryType[]): { candidate: { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction }, sum: AbstractTrade, rate_with_benefit: bigint } | null => {
    let next_candidate = target.bestRate(keep_candidate, amount, rate_lower_bound, rate_upper_bound, rate_denominator);
    let next_candidate_sum = next_candidate == null ? null : sumAbstractTradeList(next_candidate.trade.map((a) => a.trade));
    if (next_candidate != null && next_candidate_sum != null && next_candidate_sum[target.name] < amount) {
      const tmp = target.fillTrade(next_candidate.trade, amount, amount - next_candidate_sum[target.name], rate_denominator);
      if (tmp == null || tmp.length == 0) {
        next_candidate = null;
      } else {
        next_candidate.trade = tmp;
        next_candidate_sum  = next_candidate == null ? null : sumAbstractTradeList(next_candidate.trade.map((a) => a.trade));
      }
    }
    if (next_candidate == null || next_candidate_sum == null) {
      return null;
    }
    const next_candidate_avg_rate_with_benefit = (next_candidate_sum.supply - (pool_fixed_cost.supply * BigInt(eliminate_candidate.length))) * rate_denominator / (next_candidate_sum.demand + (pool_fixed_cost.demand * BigInt(eliminate_candidate.length)));
    counter++;
    return { candidate: next_candidate, sum: next_candidate_sum, rate_with_benefit: next_candidate_avg_rate_with_benefit };
  };
  const entries_avg_rate = (entries_sum.supply * rate_denominator) / entries_sum.demand;
  let counter = 0;
  let candidate: { keep_pool_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }>, trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction, rate_with_benefit: bigint, split_index: number } | null = null;
  { // find the first candidate
    let lower_bound = 1;
    let upper_bound = entries.length;
    while (lower_bound < upper_bound) {
      const guess = lower_bound + Math.floor((upper_bound - lower_bound) / 2);
      const keep_candidate = entries.slice(0, guess);
      const eliminate_candidate = entries.slice(guess);
      const result = elimiateSub(keep_candidate, eliminate_candidate);
      if (result != null && result.rate_with_benefit < entries_avg_rate) {
        candidate = {
          keep_pool_trade_list: keep_candidate.map((a) => ({ pair: a.pair, trade: a.trade })),
          trade: result.candidate.trade,
          rate: result.candidate.rate,
          rate_with_benefit: result.rate_with_benefit,
          split_index: guess,
        };
        break;
      } else {
        lower_bound = guess + 1;
      }
    }
  }
  if (candidate != null) {
    const bounds = [ { side: 'left', lower: 1, upper: candidate.split_index }, { side: 'right', lower: candidate.split_index, upper: entries.length } ];
    while (true) {
      const abound = bounds.shift();
      if (abound == null) {
        break;
      }
      const guess = abound.lower + Math.floor((abound.upper - abound.lower) / 2);
      const keep_candidate = entries.slice(0, guess);
      const eliminate_candidate = entries.slice(guess);
      const result = elimiateSub(keep_candidate, eliminate_candidate);
      if (result != null && result.rate_with_benefit < candidate.rate_with_benefit) {
        candidate = {
          keep_pool_trade_list: keep_candidate.map((a) => ({ pair: a.pair, trade: a.trade })),
          trade: result.candidate.trade,
          rate: result.candidate.rate,
          rate_with_benefit: result.rate_with_benefit,
          split_index: guess,
        };
        for (let i = 0; i < bounds.length; ) {
          const other_bound = bounds[i];
          if (!other_bound) {
            break;
          }
          if (other_bound.side == 'left') {
            other_bound.upper = guess;
          } else {
            other_bound.lower = guess;
          }
          if (!(other_bound.lower < other_bound.upper)) {
            bounds.splice(i, 1);
          } else {
            i++;
          }
        }
        if (abound.side == 'left') {
          abound.lower = guess + 1;
        } else {
          abound.upper = guess;
        }
        if (abound.lower < abound.upper) {
          bounds.push(abound);
        }
      } else {
        let lower, upper, side;
        if (candidate.split_index < guess) {
          lower = candidate.split_index;
          upper = guess;
          side = 'right';
        } else {
          lower = guess + 1;
          upper = candidate.split_index;
          side = 'left';
        }
        if (lower < upper) {
          bounds.push({ lower, upper, side });
        }
      }
    }
  }
  if (candidate == null) {
    throw new NotFoundError();
  }
  return candidate;
};

/*****
const eliminateNetNegativePoolsInATradeATargetTestAll = (
  pool_fixed_cost: { supply: bigint, demand: bigint },
  input_trade: Array<{ pair: PoolPair, trade: AbstractTrade }>,
  amount: bigint, rate_lower_bound: bigint, rate_upper_bound: bigint, rate_denominator: bigint,
  target: {
    name: 'demand' | 'supply',
    bestRate: (pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }>, amount: bigint, lower_bound: bigint, upper_bound: bigint, rate_denominator: bigint) => { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } | null,
    fillTrade: (initial_pair_trade_list: Array<{ trade: AbstractTrade | null, pair: PoolPair }>, requested_amount: bigint, step_size: bigint, rate_denominator: bigint) => Array<{ trade: AbstractTrade, pair: any }> | null,
  }
): { keep_pool_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }>, trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } => {
  if (pool_fixed_cost.supply == 0n && pool_fixed_cost.demand == 0n) {
    throw new NotFoundError();
  }
  const changeInRateWithFixedCost = (trade: AbstractTrade): bigint | null => {
    if (trade.demand - pool_fixed_cost.demand <= 0n) {
      return null;
    }
    return (trade.supply + pool_fixed_cost.supply) * rate_denominator  / (trade.demand - pool_fixed_cost.demand) - (trade.supply * rate_denominator / trade.demand);
  };
  type EntryType = { pair: PoolPair, lower_bound: bigint, upper_bound: bigint, trade: AbstractTrade };
  let entries: EntryType[];
  { // sort by changeInRateWithFixedCost in asc order
    const tmp: Array<{ item: any, value: bigint }> = input_trade.map((a) => ({ item: a, value: changeInRateWithFixedCost(a.trade) }))
          .filter((a) => a.value != null) as Array<{ item: any, value: bigint }>;
    bigIntArraySortPolyfill(tmp, (a, b) => a.value - b.value);
    entries = tmp.map((a) => ({ pair: a.item.pair, lower_bound: a.item.trade[target.name], upper_bound: (target.name == 'demand' ? a.item.pair.b - a.item.pair.b_min_reserve : requiredSupplyToMaxOutAPair(a.item.pair)), trade: a.item.trade })) as any;
  }
  const entries_sum = sumAbstractTradeList(entries.map((a) => a.trade));
  if (entries.length == 0 || entries_sum == null) {
    return { keep_pool_trade_list: [], trade: [], rate: { numerator: 0n, denominator: rate_denominator } };
  }
  const elimiateSub = (keep_candidate: EntryType[], eliminate_candidate: EntryType[]): { candidate: { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction }, sum: AbstractTrade, rate_with_benefit: bigint } | null => {
    let next_candidate = target.bestRate(keep_candidate, amount, rate_lower_bound, rate_upper_bound, rate_denominator);
    let next_candidate_sum = next_candidate == null ? null : sumAbstractTradeList(next_candidate.trade.map((a) => a.trade));
    if (next_candidate != null && next_candidate_sum != null && next_candidate_sum[target.name] < amount) {
      const tmp = target.fillTrade(next_candidate.trade, amount, amount - next_candidate_sum[target.name], rate_denominator);
      if (tmp == null || tmp.length == 0) {
        next_candidate = null;
      } else {
        next_candidate.trade = tmp;
        next_candidate_sum  = next_candidate == null ? null : sumAbstractTradeList(next_candidate.trade.map((a) => a.trade));
      }
    }
    if (next_candidate == null || next_candidate_sum == null) {
      return null;
    }
    const next_candidate_avg_rate_with_benefit = (next_candidate_sum.supply - (pool_fixed_cost.supply * BigInt(eliminate_candidate.length))) * rate_denominator / (next_candidate_sum.demand + (pool_fixed_cost.demand * BigInt(eliminate_candidate.length)));
    counter++;
    return { candidate: next_candidate, sum: next_candidate_sum, rate_with_benefit: next_candidate_avg_rate_with_benefit };
  };
  const entries_avg_rate = (entries_sum.supply * rate_denominator) / entries_sum.demand;
  let counter = 0;
  let candidate: { keep_pool_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }>, trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction, rate_with_benefit: bigint, split_index: number } | null = null;
  for (let keep = 1; keep <= entries.length; keep++) {
    const keep_candidate = entries.slice(0, keep);
    const eliminate_candidate = entries.slice(keep);
    const result = elimiateSub(keep_candidate, eliminate_candidate);
    if (result != null && result.rate_with_benefit < (candidate == null ? entries_avg_rate : candidate.rate_with_benefit)) {
      candidate = {
        keep_pool_trade_list: keep_candidate.map((a) => ({ pair: a.pair, trade: a.trade })),
        trade: result.candidate.trade,
        rate: result.candidate.rate,
        rate_with_benefit: result.rate_with_benefit,
        split_index: keep,
      };
    }
  }
  if (candidate == null) {
    throw new NotFoundError();
  }
  return candidate;
};
*****/
/* Not used
const increaseTradeDemandWithBestRate = (fee_paid_in_demand: boolean, initial_candidate_trade: Array<{ trade: AbstractTrade, pair: PoolPair }>, amount: bigint, rate_lower_bound: bigint, rate_upper_bound: bigint, rate_denominator: bigint): { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } | null => {
  let candidate_trade = null;
  let best_rate = null;
  let highest_found_demand = initial_candidate_trade.reduce((a, b) => a + b.trade.demand, 0n);
  if (highest_found_demand >= amount) {
    throw new ValueError(`amount should be higher than the sum of current trade demand!`);
  }
  let known_trade = initial_candidate_trade;
  while (rate_lower_bound < rate_upper_bound) {
    const guess = rate_lower_bound + (rate_upper_bound - rate_lower_bound) / 2n;
    const next_candidate_trade = known_trade.map((a) => {
      const pool_lower_bound = a.trade.demand +
        (fee_paid_in_demand ? a.trade.trade_fee : 0n);
      const pool_upper_bound = bigIntMin(a.pair.b - a.pair.b_min_reserve, amount) + 1n;
      if (pool_lower_bound >= pool_upper_bound) {
        / * c8 ignore next * /
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
*/
/* Not used
const reduceFillOrderFromPoolPairsWithFillingStepper = (pair_trade_list: Array<{ trade: AbstractTrade | null, pair: PoolPair }>, requested_amount: bigint, step_size: bigint, rate_denominator: bigint): Array<{ trade: AbstractTrade | null, pair: any }> => {
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
          const trade = calcTradeWithTargetDemandFromAPair(entry.pair, trade_demand, rate_denominator);
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
export const calcTradeWithTargetSupplyFromAPair = (pair: PoolPair, amount: bigint): AbstractTrade | null => {
  const K = pair.a * pair.b;
  let pair_a_1, pair_b_1, trade_fee;
  if (pair.fee_paid_in_a) {
    const pre_a1 = pair.a + amount - calcTradeFee(amount);
    const b1 = ceilingValueOfBigIntDivision(K, pre_a1);
    const a1 = ceilingValueOfBigIntDivision(K, b1);
    if (a1 <= pair.a || b1 >= pair.b || b1 < pair.b_min_reserve) {
      return null; // given supply is not enough to acquire min demand
    }
    pair_a_1 = __pairIncludeFeeForTarget(a1, pair.a);
    pair_b_1 = b1;
    trade_fee = calcTradeFee(pair_a_1 - pair.a);
    if (pair_a_1 <= pair.a) {
      /* c8 ignore next */
      throw new InvalidProgramState(`pair_a_1 <= pair.a`);
    }
  } else {
    const pre_a1 = pair.a + amount;
    const pre_b1 = bigIntMax(pair.b_min_reserve, ceilingValueOfBigIntDivision(K, pre_a1));
    const a1 = ceilingValueOfBigIntDivision(K, pre_b1);
    const b1 = ceilingValueOfBigIntDivision(K, a1);
    const tmp = __pairLeaveFeeInPoolForTarget(b1, pair.b);
    pair_a_1 = a1;
    pair_b_1 = tmp.value;
    trade_fee = tmp.trade_fee;
    if (pair.b - pair_b_1 <= 0n || pair_b_1 < pair.b_min_reserve) {
      return null; // given supply is not enough to acquire min demand
    }
  }
  __tradeSanityCheck({ pair_a_1, pair_b_1, trade_fee, K, pair });
  const supply = pair_a_1 - pair.a;
  const demand = pair.b - pair_b_1;
  if (supply > amount) {
    /* c8 ignore next */
    throw new InvalidProgramState(`calcTradeWithTargetSupplyFromAPair, supply > amount, amount: ${amount}, pair.a: ${pair.a}, pair.b: ${pair.b}, pair_a_1: ${pair_a_1}`);
  }
  return demand > 0n && supply > 0n ? {
    demand, supply,
    trade_fee,
  } : null;
};
// lower_bound >= result.supply < upper_bound
export const approxAvailableAmountInASupplyRangeForAPair = (pair: PoolPair, target_rate: Fraction, lower_bound: bigint, upper_bound: bigint): { best_guess: bigint, trade: AbstractTrade } | null => {
  let best_trade = null;
  let best_guess = null;
  const K = pair.a * pair.b;
  while (lower_bound < upper_bound) {
    const guess = lower_bound + (upper_bound - lower_bound) / 2n;
    const trade = calcTradeWithTargetSupplyFromAPair(pair, guess);
    if (trade == null) {
      lower_bound = guess + 1n;
      continue;
    }
    const b2 = pair.b - trade.demand;
    if (b2 < pair.b_min_reserve) {
      /* c8 ignore next */
      throw new InvalidProgramState('approxAvailableAmountInAPairAtTargetRate, b2 < pair.b_min_reserve!!');
    }
    const a2 = ceilingValueOfBigIntDivision(K, b2);
    // min(diff_rate(b2), max(tip_rate, diff_rate(b1)))
    let a1, b1;
    if ((a2 - pair.a) > (pair.b - b2)) {
      b1 = b2 + 1n;
      a1 = ceilingValueOfBigIntDivision(K, b1);
    } else {
      a1 = a2 - 1n;
      b1 = ceilingValueOfBigIntDivision(K, a1);
    }
    const tip_rate = ((a2 - a1) * target_rate.denominator) / (b1 - b2);
    const rate_b1 = calcPairRateWithKB(K, b1, target_rate.denominator);
    const rate_b2 = calcPairRateWithKB(K, b2, target_rate.denominator);
    const rate = bigIntMin(rate_b2, bigIntMax(tip_rate, rate_b1));
    if (rate > target_rate.numerator) {
      upper_bound = guess;
    } else {
      lower_bound = guess + 1n;
      best_trade = trade;
      best_guess = guess;
    }
  }
  return best_trade != null && best_guess != null ? { trade: best_trade, best_guess } : null;
};

export const constructTradeInPoolsBelowTargetRateInSupplyRange = (pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }>, rate: Fraction): Array<{ pair: PoolPair, trade: AbstractTrade, best_guess: bigint }> => {
  return pools_set.map((a) => {
    const result = approxAvailableAmountInASupplyRangeForAPair(a.pair, rate, a.lower_bound, a.upper_bound);
    if (result != null) {
      return { pair: a.pair, trade: result.trade, best_guess: result.best_guess };
    }
    return { pair: a.pair, trade: null, best_guess: null };
  })
    .filter((a)=> a.trade != null) as Array<{ pair: PoolPair, trade: AbstractTrade, best_guess: bigint }>;
};
export const requiredSupplyToMaxOutAPair = (pair: PoolPair): bigint => {
  const K = pair.a * pair.b;
  const b1 = pair.b_min_reserve;
  if (b1 >= pair.b) {
    return 0n;
  }
  if (pair.b - b1 <= 0) {
    return 0n; // given supply is not enough to acquire min demand
  }
  const a1 = ceilingValueOfBigIntDivision(K, b1);
  if (a1 - pair.a <= 0) {
    /* c8 ignore next */
    throw new InvalidProgramState(`requiredSupplyToMaxOutAPair, a1 - pair.a <= 0, a1: ${a1}, pair.a: ${pair.a}, pair.b: ${pair.b}`);
  }
  return a1 - pair.a;
};
export const bestRateToTradeInPoolsForTargetSupply = (pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }>, amount: bigint, lower_bound: bigint, upper_bound: bigint, rate_denominator: bigint): { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } | null  => {
  /*
    The best is the lowest found aggregate rate.
    The successive approximation algorithm is used to find lowest rate to acquire the most.
    Based on available amount at a rate.
  */
  const pair_max_supply_map: WeakMap<PoolPair, bigint> = new WeakMap();
  for (const entry of pools_set) {
    pair_max_supply_map.set(entry.pair, requiredSupplyToMaxOutAPair(entry.pair));
  }
  let candidate_trade: Array<{ pair: PoolPair, trade: AbstractTrade }> | null = null;
  let candidate_sum: AbstractTrade | null = null;
  let best_rate = null;
  while (lower_bound < upper_bound) {
    const guess = lower_bound + (upper_bound - lower_bound) / 2n;
    const next_candidate_trade = constructTradeInPoolsBelowTargetRateInSupplyRange(pools_set, { numerator: guess, denominator: rate_denominator });
    const next_candidate_sum = sumAbstractTradeList(next_candidate_trade.map((a) => a.trade));
    if (next_candidate_sum == null) { // no liquidity at this rate
      lower_bound = guess + 1n;
      continue;
    }
    if (next_candidate_sum.supply <= amount &&
        (candidate_sum == null || next_candidate_sum.demand > candidate_sum.demand ||
          (next_candidate_sum.demand == candidate_sum.demand && next_candidate_sum.supply < candidate_sum.supply))) {
      candidate_trade = next_candidate_trade;
      candidate_sum = next_candidate_sum;
      best_rate = guess;
    }
    if (next_candidate_sum.supply < amount) {
      lower_bound = guess + 1n;
      pools_set = pools_set.map((entry) => {
        const target_pair_trade = next_candidate_trade.find((a) => a.pair == entry.pair);
        if (target_pair_trade != null && target_pair_trade.trade != null) {
          entry = { pair: entry.pair, lower_bound: target_pair_trade.best_guess - 1n, upper_bound: entry.upper_bound };
        }
        return entry;
      });
    } else {
      upper_bound = guess;
      pools_set = pools_set.map((entry) => {
        const target_pair_trade = next_candidate_trade.find((a) => a.pair == entry.pair);
        if (target_pair_trade != null && target_pair_trade.trade != null) {
          entry = { pair: entry.pair, lower_bound: entry.lower_bound, upper_bound: bigIntMin(target_pair_trade.best_guess + 1n, pair_max_supply_map.get(entry.pair) || requiredSupplyToMaxOutAPair(entry.pair)) };
        }
        return entry;
      });
    }
  }
  return candidate_trade == null ? null : {
    trade: candidate_trade,
    rate: { numerator: best_rate as bigint, denominator: rate_denominator },
  };
};
export const fillTradeToTargetSupplyFromPairsWithFillingStepper = (initial_pair_trade_list: Array<{ trade: AbstractTrade | null, pair: PoolPair }>, requested_amount: bigint, step_size: bigint, rate_denominator: bigint): Array<{ trade: AbstractTrade, pair: any }> | null => {
  if (step_size <= 0n) {
    throw new ValueError('step size should be greater than zero')
  }
  const pair_trade_list: Array<{ trade: AbstractTrade | null, next_step_trade: any, pair: PoolPair }> = initial_pair_trade_list.map((a) => ({ trade: a.trade, next_step_trade: null, pair: a.pair }));
  let total_available = pair_trade_list.reduce((a, b) => a + requiredSupplyToMaxOutAPair(b.pair), 0n);
  if (total_available == 0n) {
    return null;
  }
  let total_acquired = pair_trade_list.reduce((a, b) => a + (b.trade != null ? b.trade.supply: 0n), 0n);
  const getStepForPair = (pair: PoolPair): bigint => requiredSupplyToMaxOutAPair(pair) * step_size / total_available;
  while (total_acquired < requested_amount) {
    pair_trade_list.forEach((entry) => {
      if (!entry.next_step_trade) {
        const next_step = getStepForPair(entry.pair);
        let next_trade
        if (next_step > 0n) {
          const next_supply = (entry.trade ? entry.trade.supply : 0n) + next_step;
          next_trade = calcTradeWithTargetSupplyFromAPair(entry.pair, next_supply);
        }
        if (next_trade == null || (entry.trade != null && next_trade.demand == entry.trade.demand)) { // at least demand one
          try {
            next_trade = constructATradeWithMinDemandFromAPair(entry.pair, (entry.trade ? entry.trade.demand : 0n) + 1n);
          } catch (err) {
            if (!(err instanceof ValueError)) {
              throw err;
            }
            next_trade = null;
          }
        }
        entry.next_step_trade = next_trade != null &&
          (entry.next_step_trade == null || next_trade.demand > entry.next_step_trade.demand) ? {
          ...next_trade,
          rate: calcTradeAvgRate(next_trade, rate_denominator),
        } : null;
      }
    });
    const sub_trade_list = pair_trade_list.filter((a) => a.next_step_trade != null);
    // sort pools by rate in ascending order
    bigIntArraySortPolyfill(sub_trade_list, (a, b) => (a.next_step_trade.rate.numerator as bigint) - (b.next_step_trade.rate.numerator as bigint));
    // fill from the sorted pairs
    let did_fill = false, did_end = false;
    for (const entry of sub_trade_list) {
      const next_addition = (entry.next_step_trade.supply as bigint) - (entry.trade != null ? entry.trade.supply : 0n);
      if (next_addition > 0n) {
        if (next_addition >= requested_amount - total_acquired) {
          const trade_supply = (requested_amount - total_acquired) + (entry.trade != null ? entry.trade.supply : 0n);
          const trade = calcTradeWithTargetSupplyFromAPair(entry.pair, trade_supply);
          if (trade != null && (entry.trade == null || trade.supply > entry.trade.supply)) {
            total_acquired += trade.supply - (entry.trade != null ? entry.trade.supply : 0n);
            entry.trade = trade;
          }
          did_end = true;
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
    if (did_end) {
      break;
    }
    if (!did_fill) {
      // not enough tokens acquire the requested tokens
      return null;
    }
  }
  if (total_acquired != pair_trade_list.reduce((a, b) => a + (b.trade ? b.trade.supply : 0n), 0n)) {
    / * c8 ignore next * /
    throw new InvalidProgramState('total_acquired do not match the sum!! (attempt to add to trade supply)');
  }
  if (total_acquired > requested_amount) {
    / * c8 ignore next * /
    throw new InvalidProgramState('total_acquired > requested_amount!! (attempt to add to trade supply)');
  }
  return pair_trade_list.map((entry) => {
    delete (entry as any).next_step_trade;
    return entry;
  }).filter((a) => a.trade != null) as Array<{ pair: PoolPair, trade: AbstractTrade }>;
};

export const bestRateWithEliminateBasedOnFixedCostAndFillTradeForTargetSupply = (pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }>, amount: bigint, lower_bound: bigint, upper_bound: bigint, pool_fixed_cost: { demand: bigint, supply: bigint }, rate_denominator: bigint): { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } | null  => {
  const result = bestRateToTradeInPoolsForTargetSupply(pools_set, amount, lower_bound, upper_bound, rate_denominator);
  if (result != null) {
    let tmp_sum = sumAbstractTradeList(result.trade.map((a) => a.trade));
    if (result != null && tmp_sum != null) {
      if (tmp_sum.supply < amount) {
        const tmp = fillTradeToTargetSupplyFromPairsWithFillingStepper(result.trade, amount, amount - tmp_sum.supply, rate_denominator);
        if (tmp == null || tmp.length == 0) {
          return null;
        }
        result.trade = tmp;
      }
      try {
        const eliminate_result = eliminateNetNegativePoolsInATradeWithTargetSupply(pool_fixed_cost, result.trade, amount, result.rate.numerator, upper_bound, rate_denominator);
        if (eliminate_result != null) {
          return eliminate_result;
        }
      } catch (err) {
        if (!(err instanceof NotFoundError)) {
          throw err;
        }
      }
      return result;
    }
  }
  return null;
};

export const bestRateWithEliminateBasedOnFixedCostAndFillTradeForTargetDemand = (pools_set: Array<{ pair: PoolPair, lower_bound: bigint, upper_bound: bigint }>, amount: bigint, lower_bound: bigint, upper_bound: bigint, pool_fixed_cost: { demand: bigint, supply: bigint }, rate_denominator: bigint): { trade: Array<{ pair: PoolPair, trade: AbstractTrade }>, rate: Fraction } | null  => {
  const result = bestRateToTradeInPoolsForTargetDemand(pools_set, amount, lower_bound, upper_bound, rate_denominator);
  if (result != null) {
    let tmp_sum = sumAbstractTradeList(result.trade.map((a) => a.trade));
    if (result != null && tmp_sum != null) {
      if (tmp_sum.supply < amount) {
        const tmp = fillTradeToTargetDemandFromPairsWithFillingStepper(result.trade, amount, amount - tmp_sum.supply, rate_denominator);
        if (tmp != null) {
          result.trade = tmp;
        }
      }
      try {
        const eliminate_result = eliminateNetNegativePoolsInATradeWithTargetDemand(pool_fixed_cost, result.trade, amount, result.rate.numerator, upper_bound, rate_denominator);
        if (eliminate_result != null) {
          return eliminate_result;
        }
      } catch (err) {
        if (!(err instanceof NotFoundError)) {
          throw err;
        }
      }
      return result;
    }
  }
  return null;
};

export const addToTradeDemandInOnePoolWithQuickAdder = (pair_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }>, amount: bigint): boolean => {
  if (pair_trade_list.length == 0) {
    return false;
  }
  let selected_pair_trade = pair_trade_list[0] as { pair: PoolPair, trade: AbstractTrade };
  for (let i = 0; i < pair_trade_list.length; i++) {
    const pair_trade = pair_trade_list[i] as { pair: PoolPair, trade: AbstractTrade };
    if (pair_trade.pair.b - pair_trade.trade.demand > selected_pair_trade.pair.b - selected_pair_trade.trade.demand) {
      selected_pair_trade = pair_trade;
    }
  }
  const new_demand = selected_pair_trade.trade.demand + amount;
  if (new_demand > selected_pair_trade.pair.b - selected_pair_trade.pair.b_min_reserve) {
    return false;
  }
  const trade = constructATradeWithMinDemandFromAPair(selected_pair_trade.pair, new_demand);
  if (trade.demand - selected_pair_trade.trade.demand < amount) {
    throw new InvalidProgramState(`new_demand - selected_pair_trade.trade.demand < amount!!`);
  }
  selected_pair_trade.trade = trade;
  return true;
};

export const addToTradeDemandWithQuickAdder = (pair_trade_list: Array<{ pair: PoolPair, trade: AbstractTrade }>, amount: bigint): boolean => {
  if (pair_trade_list.length == 0) {
    return false;
  }
  const amount_per_item = amount / BigInt(pair_trade_list.length);
  let max_try = pair_trade_list.length * 2;
  let queue: Array<{ pair: PoolPair, trade: AbstractTrade }> = [];
  let remained_amount = amount;
  while (max_try-- > 0) {
    if (queue.length == 0) {
      queue = [...pair_trade_list];
    }
    let index = 0;
    let selected_pair_trade = null;
    for (let i = 0; i < queue.length; i++) {
      const pair_trade = queue[i] as { pair: PoolPair, trade: AbstractTrade };
      if (selected_pair_trade == null || pair_trade.pair.b - pair_trade.trade.demand > selected_pair_trade.pair.b - selected_pair_trade.trade.demand) {
        selected_pair_trade = pair_trade;
        index = i;
      }
    }
    queue.splice(index, 1);
    if (selected_pair_trade == null) {
      return false;
    }
    const next_add = bigIntMin(remained_amount, bigIntMax(1n, amount_per_item));
    const new_demand = bigIntMin(selected_pair_trade.trade.demand + next_add, selected_pair_trade.pair.b - selected_pair_trade.pair.b_min_reserve);
    if (new_demand <= selected_pair_trade.trade.demand) {
      return false;
    }
    const trade = constructATradeWithMinDemandFromAPair(selected_pair_trade.pair, new_demand);
    if (trade.demand - selected_pair_trade.trade.demand <= 0n) {
      throw new InvalidProgramState(`trade.demand - selected_pair_trade.trade.demand <= 0n!!`);
    }
    remained_amount -= trade.demand - selected_pair_trade.trade.demand;
    selected_pair_trade.trade = trade;
    if (remained_amount <= 0n) {
      return true;
    }
  }
  return false;
};
