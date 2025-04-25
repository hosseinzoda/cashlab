import type { Transaction as libauthTransaction, Output as libauthOutput } from './libauth.js';

export type NativeBCHTokenId = 'BCH';

/**
 * The token category represented as 32 bytes hex string or literal string 'BCH'
 */
export type TokenId = NativeBCHTokenId | string;

/**
 * A fraction represented by two bigints.
 */
export type Fraction = {
  numerator: bigint;
  denominator: bigint;
};

export enum NonFungibleTokenCapability {
  none = 'none',
  mutable = 'mutable',
  minting = 'minting',
};

/**
 * BCH transaction output.
 */
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

/**
 * BCH transaction output with a fungible token.
 */
export type OutputWithFT = Output & {
  token: {
    amount: bigint;
    token_id: string;
  };
};

/**
 * BCH transaction output with a non-fungible token.
 */
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


/**
 * The reference to an output of a transaction.
 */
export type Outpoint = { txhash: Uint8Array, index: number };

/**
 * Data type representing an unspent output of a transaction with the reference to its source transaction.
 */
export type UTXO<OutputType = Output> = {
  output: OutputType;
  outpoint: Outpoint;
  /**
   * The height of the block that contains the source transaction.
   */
  block_height?: number;
};

/**
 * A variant of the UTXO with an output containing a non-fungible token
 */
export type UTXOWithNFT = UTXO<OutputWithNFT>;
/**
 * A variant of the UTXO with an output containing a fungible token
 */
export type UTXOWithFT = UTXO<OutputWithFT>;

/**
 * A data type with the information needed to spend a pay-to-public-key-hash outputs.
 */
export type SpendableCoinP2PKH<OutputType> = UTXO<OutputType> & {
  type: SpendableCoinType.P2PKH;
  key: Uint8Array;
};

/**
 * A data type containing information needed to spend an output.
 */
export type SpendableCoin<OutputType = Output> =
  | SpendableCoinP2PKH<OutputType>;

/**
 * Types of payout amount rule
 */
export enum PayoutAmountRuleType {
  FIXED = 'FIXED',
  CHANGE  = 'CHANGE',
};

export type PayoutRuleCommon = {
  /**
   * The value defines the locking_bytecode of the generated outputs.
   */
  locking_bytecode: Uint8Array;
  /**
   * When defined the program can use the parameters to spend the generated payouts.
   */
  spending_parameters?: {
    type: SpendableCoinType;
    key: Uint8Array;
  };
};

export type FixedPayoutRuleApplyMinAmountType = -1n;

export type PayoutFixedAmountRule = PayoutRuleCommon & {
  type: PayoutAmountRuleType.FIXED;
  token?: {
    /**
     * A fixed token amount
     */
    amount: bigint;
    /**
     * The subject token id (category)
     */
    token_id: string;
  };
  /**
   * A fixed bch amount or a min amount
   */
  amount: bigint | FixedPayoutRuleApplyMinAmountType;
};

export type PayoutChangeRule = PayoutRuleCommon & {
  type: PayoutAmountRuleType.CHANGE;
  /**
   * The value defines the locking_bytecode of the generated outputs. (optional)
   */
  locking_bytecode?: Uint8Array;
  /**
   * Generate a locking_bytecode for a change output.
   */
  generateChangeLockingBytecodeForOutput?: (output: Output) => Uint8Array;
  /**
   * When true the change output may contain the remaining bch & tokens in a single output.
   * Warning: Not all wallets know how to get access to mixed outputs, Set this to true only if you know what you're doing.
   */
  allow_mixing_native_and_token?: boolean;
  /**
   * When true the bch change output will be mixed by a token output if bch change is considered as dust output.
   */
  allow_mixing_native_and_token_when_bch_change_is_dust?: boolean;
  /**
   * When true if the bch change is considered as dust it will be added to the transaction fee.
   */
  add_change_to_txfee_when_bch_change_is_dust?: boolean;
  /**
   * The command method to burn the change for a token when it throws {@link BurnTokenException}
   * @param token_id The id of the change token.
   * @param amount The amount of the change token.
   * @throws {@link BurnTokenException} if the rule is to burn the change for the given token_id (excluding native BCH).
   */
  shouldBurn?: (token_id: TokenId, amount: bigint) => void;
};

export type PayoutRule =
  | PayoutFixedAmountRule
  | PayoutChangeRule;

/**
 * Result of a generated transaction.
 */
export type TxResult = {
  /**
   * Encoded transaction.
   */
  txbin: Uint8Array;
  /**
   * The hash of the encoded transaction, In ui order, AKA txid as a binary data.
   */
  txhash: Uint8Array;
  /**
   * The amount of fee paid to the miner in sats.
   */
  txfee: bigint;
  /**
   * A list of payouts.
   */
  payouts: UTXO[];
  libauth_transaction: libauthTransaction;
  libauth_source_outputs: libauthOutput[];
};

/**
 * A data type representing a chain of transactions.
 */
export type ChainedTxResult = {
  /**
   * A list of transaction results, These transactions may spend the utxo of their previous transactions in the list.
   */
  chain: TxResult[];
  /**
   * The amount paid to the miner in sats.
   */
  txfee: bigint;
  /**
   * A list of payouts from all of the generated transactions.
   */
  payouts: UTXO[];
};
