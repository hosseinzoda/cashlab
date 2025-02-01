import type { Transaction as libauthTransaction, Output as libauthOutput } from '@bitauth/libauth';
export type NativeBCHTokenId = 'BCH';

export type TokenId = NativeBCHTokenId | string;

export type Fraction = {
  numerator: bigint;
  denominator: bigint;
};

export enum NonFungibleTokenCapability {
  none = 'none',
  mutable = 'mutable',
  minting = 'minting',
};

export type Output = {
  locking_bytecode: Uint8Array;
  token?: {
    amount: bigint;
    token_id: string;
    nft?: {
      capability: `${NonFungibleTokenCapability}`;
      commitment: Uint8Array;
    };
  };
  amount: bigint;
};

export type OutputWithFT = Output & {
  token: {
    amount: bigint;
    token_id: string;
  };
};

export type OutputWithNFT = Output & {
  token: {
    amount: bigint;
    token_id: string;
    nft: {
      capability: `${NonFungibleTokenCapability}`;
      commitment: Uint8Array;
    };
  };
};

export enum SpendableCoinType {
  P2PKH = 'P2PKH',
};

export type Outpoint = { txhash: Uint8Array, index: number };

export type UTXO<OutputType = Output> = {
  output: OutputType;
  outpoint: Outpoint;
  block_height?: number;
};

export type UTXOWithNFT = UTXO<OutputWithNFT>;
export type UTXOWithFT = UTXO<OutputWithFT>;

export type SpendableCoinP2PKH<OutputType> = UTXO<OutputType> & {
  type: SpendableCoinType.P2PKH;
  key: Uint8Array;
};

export type SpendableCoin<OutputType = Output> =
  | SpendableCoinP2PKH<OutputType>;

export enum PayoutAmountRuleType {
  FIXED = 'FIXED',
  CHANGE  = 'CHANGE',
};

export type PayoutRuleCommon = {
  locking_bytecode: Uint8Array;
  spending_parameters?: {
    type: SpendableCoinType;
    key: Uint8Array;
  };
};

export type FixedPayoutRuleApplyMinAmountType = -1n;

export type PayoutFixedAmountRule = PayoutRuleCommon & {
  type: PayoutAmountRuleType.FIXED;
  token?: {
    amount: bigint;
    token_id: string;
  };
  amount: bigint | FixedPayoutRuleApplyMinAmountType;
};
export type PayoutChangeRule = PayoutRuleCommon & {
  type: PayoutAmountRuleType.CHANGE;
  allow_mixing_native_and_token?: boolean;
  /* A command method to burn change for a token when it throws BurnTokenException */
  shouldBurn?: (token_id: TokenId, amount: bigint) => void;
};
export type PayoutRule =
  | PayoutFixedAmountRule
  | PayoutChangeRule;

export type TxResult = {
  txbin: Uint8Array;
  txhash: Uint8Array;
  txfee: bigint;
  payouts: UTXO[];
  libauth_transaction: libauthTransaction;
  libauth_source_outputs: libauthOutput[];
};

export type ChainedTxResult = {
  chain: TxResult[];
  txfee: bigint;
  payouts: UTXO[];
};
