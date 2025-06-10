import { ExecutionContext } from 'ava';
import type { MoriaTxResult } from '../../types.js';
import type { UTXOWithNFT, SpendableCoin, TokenId } from '@cashlab/common/types.js';
import { NATIVE_BCH_TOKEN_ID } from '@cashlab/common/constants.js';
import {
  loanAgentNFTHashFromLoanCommitment, principalFromLoanCommitment,
  annualInterestBPFromLoanCommitment, timestampFromLoanCommitment,
  timestampFromDelphiCommitment,
  outputNFTHash,
} from '../../util.js';
import { uint8ArrayEqual, calcAvailablePayoutFromIO } from '@cashlab/common/util.js';

export const validateCreatedLoan = (t: ExecutionContext, params: { loan_amount: bigint, collateral_amount: bigint, annual_interest_bp: bigint }, delphi_utxo: UTXOWithNFT, loan_utxo: UTXOWithNFT, loan_agent_utxo: UTXOWithNFT, loan_agent_locking_bytecode: Uint8Array): void => {
  const loan_commitment = loan_utxo.output.token.nft.commitment;
  t.is(params.loan_amount, principalFromLoanCommitment(loan_commitment));
  t.is(params.annual_interest_bp, annualInterestBPFromLoanCommitment(loan_commitment));
  t.is(timestampFromDelphiCommitment(delphi_utxo.output.token.nft.commitment), timestampFromLoanCommitment(loan_commitment));
  t.is(loan_utxo.output.amount, params.collateral_amount);

  { // validate loan agent
    // nftash should match
    t.assert(uint8ArrayEqual(outputNFTHash(loan_agent_utxo.output), loanAgentNFTHashFromLoanCommitment(loan_utxo.output.token.nft.commitment)), 'loan nfthash do not match!');
    t.assert(uint8ArrayEqual(loan_agent_utxo.output.locking_bytecode, loan_agent_locking_bytecode));
  }
};

export const validateMoriaTxPayouts = (t: ExecutionContext, token_id: TokenId, { bch_diff, token_diff }: { bch_diff: bigint, token_diff: bigint }, input_loan_agent: UTXOWithNFT | null, result: MoriaTxResult, funding_coins: SpendableCoin[], payout_locking_bytecode: Uint8Array): void => {
  t.assert(token_id != NATIVE_BCH_TOKEN_ID);
  const available_payouts = calcAvailablePayoutFromIO(result.payouts.map((utxo) => ({ utxo })), []);
  t.is(available_payouts.length, 2);
  const expected_token_payout = token_diff +
    funding_coins.reduce((a, b) => a + (b.output.token?.token_id == token_id ? b.output.token.amount : 0n), 0n);
  const token_payout = (available_payouts.find((a) => a.token_id == token_id) as { amount: bigint }).amount;
  // console.log({expected_token_payout, token_diff, token_payout});
  t.is(token_payout, expected_token_payout);

  const bch_addition = (input_loan_agent != null ? input_loan_agent.output.amount : 0n);
  const bch_reduction = result.fees.total + result.txfee +
    (result.loan_agent_utxo != null ? result.loan_agent_utxo.output.amount : 0n) +
    (result.interest_utxo != null ? result.interest_utxo.output.amount : 0n);
  const expected_bch_payout = bch_diff + bch_addition - bch_reduction +
    funding_coins.reduce((a, b) => a + b.output.amount, 0n);
  const bch_payout = (available_payouts.find((a) => a.token_id == NATIVE_BCH_TOKEN_ID) as { amount: bigint }).amount;
  // console.log({expected_bch_payout, bch_reduction, bch_addition, bch_payout});
  t.is(bch_payout, expected_bch_payout);
  t.is(result.payouts.filter((a) => uint8ArrayEqual(payout_locking_bytecode, a.output.locking_bytecode)).length, result.payouts.length);
};
