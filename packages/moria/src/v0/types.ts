import type { UTXO, UTXOWithNFT, TokenId, Output, TxResult } from '@cashlab/common/types.js';
import type {
  CompilerBCH as libauthCompilerBCH,
} from '@cashlab/common/libauth.js';

export type MoriaTxResult = TxResult & {
  moria_utxo: UTXOWithNFT;
  oracle_utxo: UTXOWithNFT;
  oracle_use_fee: bigint;
};

export type RedeemTxResult = MoriaTxResult & {
  redeemer_payouts: UTXO[];
  borrower_payouts: UTXO[];
};

export type MintTxResult = MoriaTxResult & {
  loan_utxo: UTXOWithNFT;
};

export type AddCollateralTxResult = TxResult & {
  loan_utxo: UTXOWithNFT;
};

export type RefinanceLoanResult = {
  tx_result_chain: TxResult[];
  txfee: bigint;
  payouts: UTXO[];
  moria_utxo: UTXOWithNFT;
  oracle_utxo: UTXOWithNFT;
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

export type MoriaV0Constants = {
  musd_token_id: TokenId;
  oracle_token_id: TokenId;
  sunset_pubkey: Uint8Array;
  sunset_message: Uint8Array;
};
