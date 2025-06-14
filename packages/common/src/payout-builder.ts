import { BurnTokenException, InsufficientFunds, ValueError, InvalidProgramState } from './exceptions.js';
import type { Output, TokenId, PayoutRule, PayoutChangeRule } from './types.js';
import { PayoutAmountRuleType, NATIVE_BCH_TOKEN_ID } from './constants.js';

/**
 * Payout builder's needed context. The build function uses calcTxFeeWithOutputs to construct the payouts, Paying the tx fee by reducing from the payouts.
 * The min bch amount, Requires the change to contain at least the min amount.
 * The non-mixed token payouts will use the preferred bch amount or the min amount as the bch amount of its output.
 */
export type PayoutBuilderContext = {
  getOutputMinAmount (output: Output): bigint;
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null;
  calcTxFeeWithOutputs (outputs: Output[]): bigint;
};

type PayoutBuilderContextWithInternalProperties = PayoutBuilderContext & {
  should_allow_mixing_native_and_token_when_bch_change_is_dust?: boolean;
};

/**
 * Result of the payouts generated by payout rules.
 */
export type PayoutBuildResult = {
  txfee: bigint,
  payout_outputs: Array<{ output: Output, payout_rule: PayoutRule }>,
  token_burns: Array<{ token_id: TokenId, amount: bigint }>
};

/**
 * Generate payout outputs with the provided `available_payout` and `payout_rules`.
 *
 * @param context payout builder's context.
 * @param available_payouts A list of available payouts for each token_id.
 * @param payout_rules A list of payout rules used as instructions to build the payout outputs.
 * @param verify_all_payouts_are_paid When true, The function verifies all available payouts are paid out.
 *
 * @returns the generated payouts result.
 * @throws ValueError
 * @throws InsufficientFunds
 */
export function build (context: PayoutBuilderContext, available_payouts: Array<{ token_id: TokenId, amount: bigint }>, payout_rules: PayoutRule[], verify_all_payouts_are_paid: boolean = true): PayoutBuildResult {
  available_payouts = structuredClone(available_payouts);
  const token_burns: Array<{ token_id: TokenId, amount: bigint }> = [];
  const payout_outputs: Array<{ output: Output, payout_rule: PayoutRule }> = [];
  if (payout_rules.filter((a) => a.type == PayoutAmountRuleType.CHANGE).length != 1) {
    throw new ValueError(`Only one change payout_rule is required!`);
  }
  const change_payout_rule: PayoutChangeRule | undefined = payout_rules.find((a) => a.type == PayoutAmountRuleType.CHANGE);
  const other_payout_rules = change_payout_rule ? payout_rules.filter((a) => a != change_payout_rule) : payout_rules;
  /** sort by precedence (NOT NEEDED)
  const payout_type_precedence = Object.fromEntries([
    [ PayoutAmountRuleType.FIXED, 2 ],
    [ PayoutAmountRuleType.CHANGE, 1 ],
  ]);
  const sorted_payout_rules: PayoutRule[] = Array.from(other_payout_rules).sort((a, b) => {
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
  */
  for (const payout_rule of other_payout_rules) {
    if (payout_rule.type == PayoutAmountRuleType.FIXED) {
      const output = {
        locking_bytecode: payout_rule.locking_bytecode,
        token: payout_rule.token ? {
          amount: payout_rule.token.amount,
          token_id: payout_rule.token.token_id,
        } : undefined,
        amount: payout_rule.amount,
      };
      const bch_payout = available_payouts.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID);
      if (bch_payout == null) {
        /* c8 ignore next */
        throw new InvalidProgramState('native token is not in available_payouts!!')
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
        const token_payout = available_payouts.find((a) => a.token_id == payout_rule_token.token_id);
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
    } else {
      const payout_rule_type = (payout_rule as any).type;
      throw new ValueError(`Invalid payout_rule.type: ${payout_rule_type}`)
    }
  }
  let txfee: bigint = 0n;
  if (change_payout_rule != null) {
    const generateChangeLockingBytecode = (output: Output): Uint8Array => {
      if ((!(change_payout_rule.locking_bytecode instanceof Uint8Array) ||
           change_payout_rule.locking_bytecode.length == 0) &&
          typeof change_payout_rule.generateChangeLockingBytecodeForOutput != 'function') {
        throw new ValueError(`change payout rule needs to define locking_bytecode or generateChangeLockingBytecodeForOutput`);
      }
      if (typeof change_payout_rule.generateChangeLockingBytecodeForOutput == 'function') {
        const bytecode = change_payout_rule.generateChangeLockingBytecodeForOutput(output);
        if (!(bytecode instanceof Uint8Array) || bytecode.length == 0) {
          throw new ValueError(`The returned value from generateChangeLockingBytecodeForOutput is expected to be non-empty Uint8Array!`);
        }
        return bytecode;
      }
      return change_payout_rule.locking_bytecode;
    };
    let mixed_payout: { bch: { token_id: TokenId, amount: bigint }, token: { token_id: TokenId, amount: bigint } } | undefined;
    // an initial value assigned cause, tsc emitting used before being assigned.
    let payouts: Array<{ token_id: TokenId, amount: bigint }> = [];
    const native_payout = available_payouts.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID);
    if (!native_payout) {
      /* c8 ignore next */
      throw new InvalidProgramState('native token is not in available_payouts!!')
    }
    if (change_payout_rule.allow_mixing_native_and_token ||
      (change_payout_rule.allow_mixing_native_and_token_when_bch_change_is_dust &&
        (context as PayoutBuilderContextWithInternalProperties).should_allow_mixing_native_and_token_when_bch_change_is_dust)) {
      const other_tokens_payout_list = available_payouts.filter((a) => a.token_id != NATIVE_BCH_TOKEN_ID);
      let chosen_token_idx = -1;
      for (let i = 0; i < other_tokens_payout_list.length; ) {
        const entry = other_tokens_payout_list[i];
        if (entry == null) {
          i++;
          continue;
        }
        try {
          if (typeof change_payout_rule.shouldBurn == 'function') {
            change_payout_rule.shouldBurn(entry.token_id, entry.amount);
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
      payouts = available_payouts.filter((a) => a.token_id != NATIVE_BCH_TOKEN_ID);
    }
    for (const payout of payouts) {
      if (payout.amount > 0n) {
        if (payout.token_id == NATIVE_BCH_TOKEN_ID) {
          throw new InvalidProgramState('payout.token_id == NATIVE_BCH_TOKEN_ID!!!');
        }
        try {
          if (typeof change_payout_rule.shouldBurn == 'function') {
            change_payout_rule.shouldBurn(payout.token_id, payout.amount);
          }
          const output = {
            locking_bytecode: undefined as any,
            token: {
              amount: payout.amount,
              token_id: payout.token_id,
            },
            amount: 0n,
          };
          output.locking_bytecode = generateChangeLockingBytecode(output);
          let utxo_bch_amount: bigint | null =  context.getPreferredTokenOutputBCHAmount(output);
          if (utxo_bch_amount == null || native_payout.amount < utxo_bch_amount) {
            utxo_bch_amount = context.getOutputMinAmount(output);
          }
          if (native_payout.amount < utxo_bch_amount) {
            const required_amount = utxo_bch_amount - native_payout.amount;
            throw new InsufficientFunds(`Not enough satoshis left to allocate min bch amount in a token (change) output, required amount: ${required_amount}`, { required_amount });
          }
          output.amount = utxo_bch_amount;
          payout_outputs.push({ output, payout_rule: change_payout_rule });
          native_payout.amount -= output.amount;
          payout.amount = 0n;
        } catch (err) {
          if (err instanceof BurnTokenException) {
            token_burns.push({ token_id: payout.token_id, amount: payout.amount });
          } else {
            throw err;
          }
        }
      }
    }
    // add the last change & pay the txfee
    if (mixed_payout != null) {
      // mixed change payout
      const payout_output = {
        locking_bytecode: undefined as any,
        token: {
          amount: mixed_payout.token.amount,
          token_id: mixed_payout.token.token_id,
        },
        amount: mixed_payout.bch.amount,
      };
      payout_output.locking_bytecode = generateChangeLockingBytecode(payout_output);
      txfee = context.calcTxFeeWithOutputs([
        ...payout_outputs.map((a) => a.output),
        payout_output,
      ]);
      if (mixed_payout.bch.amount < txfee) {
        const required_amount = txfee - mixed_payout.bch.amount;
        throw new InsufficientFunds(`Not enough change remained to pay the tx fee, fee = ${txfee}, required amount: ${required_amount}`, { required_amount });
      }
      payout_output.amount = mixed_payout.bch.amount - txfee;
      const min_amount = context.getOutputMinAmount(payout_output);
      if (payout_output.amount - txfee < min_amount) {
        const required_amount = min_amount - payout_output.amount;
        throw new InsufficientFunds(`Not enough satoshis left to have the min amount in a mixed (change) output, min: ${min_amount}, required amount: ${required_amount}`, { required_amount });
      }
      payout_outputs.push({ output: payout_output, payout_rule: change_payout_rule });
      mixed_payout.bch.amount -= payout_output.amount;
      mixed_payout.token.amount = 0n;
    } else {
      // native change payout
      const payout_output = {
        locking_bytecode: undefined as any,
        amount: native_payout.amount,
      };
      payout_output.locking_bytecode = generateChangeLockingBytecode(payout_output);
      txfee = context.calcTxFeeWithOutputs([
        ...payout_outputs.map((a) => a.output),
        payout_output,
      ]);
      if (native_payout.amount < txfee) {
        const required_amount = txfee - native_payout.amount;
        throw new InsufficientFunds(`Not enough change remained to pay the transaction fee, fee = ${txfee}, required amount: ${required_amount}`, { required_amount });
      }
      if (native_payout.amount > txfee) {
        payout_output.amount = native_payout.amount - txfee;
        const min_amount = context.getOutputMinAmount(payout_output);
        if (payout_output.amount - txfee < min_amount) {
          if (!change_payout_rule.allow_mixing_native_and_token &&
              change_payout_rule.allow_mixing_native_and_token_when_bch_change_is_dust &&
              !(context as PayoutBuilderContextWithInternalProperties).should_allow_mixing_native_and_token_when_bch_change_is_dust) {
            // re-build with allow mixing
            return build({
              ...context,
              should_allow_mixing_native_and_token_when_bch_change_is_dust: true,
            } as PayoutBuilderContext, available_payouts, payout_rules, verify_all_payouts_are_paid);
          } else if (change_payout_rule.add_change_to_txfee_when_bch_change_is_dust) {
            txfee = native_payout.amount;
          } else {
            const required_amount = min_amount - (payout_output.amount - txfee);
            throw new InsufficientFunds(`Not enough satoshis left to have the min amount in a (change) output, min: ${min_amount}, txfee: ${txfee}, required amount: ${required_amount}`, { required_amount });
          }
        } else {
          payout_outputs.push({ output: payout_output, payout_rule: change_payout_rule });
          native_payout.amount -= payout_output.amount;
        }
      }
    }
  }
  // verify nothing has left in the available_payouts
  if (verify_all_payouts_are_paid) {
    for (const available_payout of available_payouts) {
      if (available_payout.token_id == NATIVE_BCH_TOKEN_ID &&
          available_payout.amount <= txfee) {
        // exclude from the check if the txfee is not paid and the left out payout is lower than or equal to txfee
        continue;
      }
      if (available_payout.amount != 0n) {
        let burned = false;
        const token_burn = token_burns.find((a) => a.token_id == available_payout.token_id);
        if (token_burn != null && token_burn.amount >= available_payout.amount) {
          burned = true;
        }
        if (!burned) {
          throw new ValueError(`payout_rules is not collecting the aggregate payouts from the exchange, unpaid token_id: ${available_payout.token_id}, amount: ${available_payout.amount}`)
        }
      }
    }
  }
  return { txfee, payout_outputs, token_burns };
};
