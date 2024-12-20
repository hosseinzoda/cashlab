import type { UTXO, UTXOWithNFT, TokenId, Output } from '../../common/types.js';
import type {
  Transaction as libauthTransaction, Output as libauthOutput,
  CompilerBCH as libauthCompilerBCH,
} from '@bitauth/libauth';

export type TxResult = {
  txbin: Uint8Array;
  txhash: Uint8Array;
  txfee: bigint;
  payouts: UTXO[];
  libauth_transaction: libauthTransaction;
  libauth_source_outputs: libauthOutput[];
};

export type MoriaTxResult = TxResult & {
  moria_utxo: UTXOWithNFT;
  oracle_utxo: UTXOWithNFT;
  oracle_use_fee: bigint;
};

export type RedeemTxResult = TxResult & {
  moria_utxo: UTXOWithNFT;
  oracle_utxo: UTXOWithNFT;
  oracle_use_fee: bigint;
  redeemer_payouts: UTXO[];
  borrower_payouts: UTXO[];
};

export type MintTxResult = MoriaTxResult & {
  loan_utxo: UTXOWithNFT,
};

export type AddCollateralTxResult = TxResult & {
  loan_utxo: UTXOWithNFT,
};

export type RefinanceLoanResult = {
  tx_result_chain: TxResult[];
  txfee: bigint;
  payouts: UTXO[];
  loan_utxo: UTXOWithNFT,
  oracle_use_fee: bigint;
};

export type CompilerContext = {
  moria_compiler: libauthCompilerBCH;
  oracle_compiler: libauthCompilerBCH;
  musd_token_id: TokenId;
  oracle_token_id: TokenId;
  txfee_per_byte: bigint;
  oracle_use_fee: bigint;
  moria_required_output_amount: bigint;
  mint_musd_payout_required_output_amount: bigint;
  min_mint_musd_amount: bigint;
  getOutputMinAmount (output: Output): bigint;
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null;
};

export type LoanNFTParameters = {
  borrower_pkh: Uint8Array;
  amount: bigint;
};
export type OracleNFTParameters = {
  oracle_pkh: Uint8Array;
  price: bigint;
  metadata: {
    timestamp: number;
    message_sequence: number;
    data_sequence: number;
  },
};
