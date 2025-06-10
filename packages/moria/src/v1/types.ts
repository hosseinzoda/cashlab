import type { UTXO, UTXOWithNFT, UTXOWithFT, TokenId, Output, TxResult, Fraction } from '@cashlab/common/types.js';
import type {
  CompilerBCH as libauthCompilerBCH,
} from '@cashlab/common/libauth.js';

export type libauthBCHCompilerWithPredefinedWalletData = libauthCompilerBCH & {
  wallet_data: { [name: string]: Uint8Array };
};

export type MoriaCompilerContext = {
  moria_compiler: libauthBCHCompilerWithPredefinedWalletData;
  delphi_compiler: libauthBCHCompilerWithPredefinedWalletData;
  delphi_gp_updater_compiler: libauthBCHCompilerWithPredefinedWalletData;
  p2nfth_compiler: libauthBCHCompilerWithPredefinedWalletData;
  bporacle_compiler: libauthBCHCompilerWithPredefinedWalletData;
  batonminter_compiler: libauthBCHCompilerWithPredefinedWalletData;

  moria_token_id: TokenId;
  delphi_token_id: TokenId;
  batonminter_token_id: TokenId;
  interest_nfthash: Uint8Array;
  interest_locking_bytecode: Uint8Array;

  txfee_per_byte: Fraction;

  mint_min_amount: bigint;
  mint_max_amount: bigint;
  mint_min_bp_rate: bigint;
  mint_max_bp_rate: bigint;

  getOutputMinAmount (output: Output): bigint;
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null;
};

export type MoriaMutationContext = {
  compiler_context: MoriaCompilerContext;
  moria_utxo: UTXOWithNFT;
  delphi_utxo: UTXOWithNFT;
  bporacle_utxo: UTXOWithNFT;
  batonminter_utxo: UTXOWithNFT;
  delphi_gp_updater_utxo?: UTXOWithNFT;
  list: TxResult[];
};

export type MoriaTxResult = TxResult & {
  fees: {
    batonminter_mint_fee?: bigint;
    bporacle_use_fee?: bigint;
    delphi_use_fee?: bigint;
    total: bigint;
  };
  moria_utxo: UTXOWithNFT;
  delphi_utxo: UTXOWithNFT;
  loan_utxo: UTXOWithNFT | null;
  interest_utxo: UTXOWithFT | null;
  loan_agent_utxo: UTXOWithNFT | null;
  bporacle_utxo: UTXOWithNFT | null;
  batonminter_utxo: UTXOWithNFT | null;
  borrower_p2nfth_utxo: UTXO | null;
};

export type Pay2NFTHWithdrawEntry = {
  utxo: UTXO;
  subentries?: Pay2NFTHWithdrawEntry[];
};

