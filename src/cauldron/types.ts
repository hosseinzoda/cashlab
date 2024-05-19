import type { Output, OutputWithFT, Fraction } from '../common/types.js';
import type { Transaction as LibauthTransaction, Output as LibauthOutput } from '@bitauth/libauth';

export type AbstractTrade = {
  demand: bigint;
  supply: bigint;
  trade_fee: bigint;
}

export type Trade = AbstractTrade & {
  demand_token_id: string;
  supply_token_id: string;
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
  outpoint: {
    index: number;
    txhash: Uint8Array;
  };
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
  libauth_source_outputs: LibauthOutput[],
  libauth_generated_transaction: LibauthTransaction;
  payout_outputs: Output[];
};
