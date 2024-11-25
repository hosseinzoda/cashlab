import type { Output, OutputWithFT, Fraction, TokenId, PayoutRule, SpendableCoin, Outpoint } from '../common/types.js';
import type { Transaction as LibauthTransaction, Output as LibauthOutput } from '@bitauth/libauth';

export type AbstractTrade = {
  demand: bigint;
  supply: bigint;
  trade_fee: bigint;
};

export type Trade = AbstractTrade & {
  demand_token_id: TokenId;
  supply_token_id: TokenId;
};
export type TradeSummary = AbstractTrade & {
  rate: Fraction;
};

export type PoolV0Parameters = {
  withdraw_pubkey_hash: Uint8Array;
};

export type PoolV0 = {
  version: '0';
  parameters: PoolV0Parameters;
  outpoint: Outpoint;
  output: OutputWithFT;
};

export type PoolTrade = Trade & {
  pool: PoolV0;
};

export type TradeResult = {
  entries: PoolTrade[];
  summary: TradeSummary;
};

export type TradeTxResult = {
  txbin: Uint8Array;
  txfee: bigint;
  libauth_source_outputs: LibauthOutput[];
  libauth_generated_transaction: LibauthTransaction;
  payouts_info: Array<{
    output: Output;
    index: number;
    payout_rule: PayoutRule;
  }>;
  token_burns: Array<{
    token_id: TokenId,
    amount: bigint,
  }>;
};

export type GenerateChainedTradeTxResult = {
  remained_grouped_entries: Array<{ supply_token_id: TokenId, demand_token_id: TokenId, list: PoolTrade[] }>;
  input_coins: SpendableCoin[];
  pool_trade_list: PoolTrade[];
  payout_rules: PayoutRule[];
};

export type WriteChainedTradeTxController = {
  inputCoinsToHavePositiveBalance?: (aggregate_balance_list: Array<{ token_id: TokenId, balance: bigint }>, input_coins: SpendableCoin[], options: { preventDefault: () => void } ) => SpendableCoin[];
  generateMiddleware?: (result: GenerateChainedTradeTxResult, grouped_entries: Array<{ supply_token_id: TokenId, demand_token_id: TokenId, list: PoolTrade[] }>, input_coins: SpendableCoin[]) => Promise<GenerateChainedTradeTxResult>;
  didGenerateTx?: (trade_tx: TradeTxResult, payout_coins: SpendableCoin[]) => void;
};

export type BCHCauldronContext = {
  getRateDenominator (): bigint;
  getOutputMinAmount (output: Output): bigint;
  getMinTokenReserve (token_id: TokenId): bigint;
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null;
};
