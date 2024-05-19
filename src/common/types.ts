export type NativeBCHTokenId = 'BCH';

export type TokenId = NativeBCHTokenId | string;

export type Fraction = {
  numerator: bigint;
  denominator: bigint;
};

export enum PayoutAmountRuleType {
  FIXED = 'FIXED',
  CHANGE  = 'CHANGE',
};

export type PayoutRuleCommon = {
  locking_bytecode: Uint8Array;
};

export type FIXED_PAYOUT_RULE_APPLY_MIN_AMOUNT = -1n;

export type PayoutFixedAmountRule = PayoutRuleCommon & {
  type: PayoutAmountRuleType.FIXED;
  token?: {
    amount: bigint;
    token_id: string;
  };
  amount: bigint | FIXED_PAYOUT_RULE_APPLY_MIN_AMOUNT;
};
export type PayoutChangeRule = PayoutRuleCommon & {
  type: PayoutAmountRuleType.CHANGE;
  allow_mixing_native_and_token?: boolean;
};
export type PayoutRule =
  | PayoutFixedAmountRule
  | PayoutChangeRule;

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

export enum SpendableCoinType {
  P2PKH = 'P2PKH',
};

export type SpendableCoinP2PKH<OutputType> = {
  type: SpendableCoinType.P2PKH;
  output: OutputType;
  outpoint: {
    index: number;
    txhash: Uint8Array;
  };
  key: Uint8Array;
};

export type SpendableCoin<OutputType = Output> =
  | SpendableCoinP2PKH<OutputType>;
