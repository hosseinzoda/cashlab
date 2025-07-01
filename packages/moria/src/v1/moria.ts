import type {
  MoriaCompilerContext, MoriaMutationContext, MoriaTxResult,
  libauthBCHCompilerWithPredefinedWalletData, Pay2NFTHWithdrawEntry,
} from './types.js';
import type {
  TxResult, UTXO, UTXOWithNFT, UTXOWithFT, Output, OutputWithNFT, SpendableCoin, PayoutRule, Fraction,
} from '@cashlab/common/types.js';
import { ValueError, InvalidProgramState } from '@cashlab/common/exceptions.js';
import {
  generateBytecodeWithLibauthCompiler,
} from '@cashlab/common/util-libauth-dependent.js';
import { outputToLibauthOutput } from '@cashlab/common/util.js';
import { BurnNFTException }  from '@cashlab/common/exceptions.js';
import {
  mintLoanWithBatonMinter, mintLoanWithExistingLoanAgent,
  refiLoan, repayLoan, liquidateLoan, redeemLoan,
  updateMoriaSequence, loanAddCollateral, updateDelphiCommitmentWithGPUpdater,
  withdrawPay2NFTHCoins,
} from './compiler.js';
import * as libauth from '@cashlab/common/libauth.js';
const { hexToBin } = libauth;

import moria_template from './templates/moria.json' with { type: "json" };
import delphi_template from './templates/delphi.json' with { type: "json" };
import delphigpupdater_template from './templates/delphigpupdater.json' with { type: "json" };
import p2nfth_template from './templates/p2nfth.json' with { type: "json" };
import bporacle_template from './templates/bporacle.json' with { type: "json" };
import batonminter_template from './templates/batonminter.json' with { type: "json" };

export const makePredefinedWalletDataOperation = (wallet_data: { [name: string]: Uint8Array }) => {
  return libauth.compilerOperationRequires({
    canBeSkipped: false,
    configurationProperties: [],
    dataProperties: [],
    operation: (identifier, data) => {
      let bytecode = wallet_data[identifier];
      if (bytecode == null) {
        if (!data.bytecode) {
          return {
            error: `Cannot resolve "${identifier}" - the "bytecode" property was not provided in the compilation data.`,
            status: 'error',
          };
        }
        bytecode = data.bytecode[identifier];
      }
      if (bytecode !== undefined) {
        return { bytecode, status: 'success' };
      }
      return {
        error: `Identifier "${identifier}" refers to a WalletData, but "${identifier}" was not provided in the CompilationData "bytecode".`,
        recoverable: true,
        status: 'error',
      };
    },
  });
};

const createCompilerFromTemplateAndPredefinedWalletData = (template_name: string, template_data: any, wallet_data: { [name: string]: Uint8Array }): libauthBCHCompilerWithPredefinedWalletData => {
  const template = libauth.importWalletTemplate(template_data);
  if (typeof template  == 'string') {
    /* c8 ignore next */
    throw new InvalidProgramState(`Failed import template (${template_name}), error: ${template}`);
  };
  const compiler: libauthBCHCompilerWithPredefinedWalletData = libauth.createCompilerBCH({
    ...libauth.walletTemplateToCompilerConfiguration(template),
    operations: {
      ...libauth.compilerOperationsBCH,
      walletData: makePredefinedWalletDataOperation(wallet_data),
    },
  } as libauth.CompilerConfiguration<libauth.CompilationContextBCH>) as libauthBCHCompilerWithPredefinedWalletData;
  compiler.wallet_data = wallet_data;
  return compiler;
};

export const createMoriaMUSDV1CompilerContext = ({
  txfee_per_byte,
  getOutputMinAmount,
  getPreferredTokenOutputBCHAmount,
}: {
  txfee_per_byte: Fraction | null,
  getOutputMinAmount?: (output: Output) => bigint,
  getPreferredTokenOutputBCHAmount?: (output: Output) => bigint | null,
}): MoriaCompilerContext => {
  const defaultGetOutputMinAmount = (output: Output): bigint => {
    return libauth.getDustThreshold(outputToLibauthOutput(output));
  };
  if (getOutputMinAmount == null) {
    getOutputMinAmount = defaultGetOutputMinAmount;
  }
  if (getPreferredTokenOutputBCHAmount == null) {
    getPreferredTokenOutputBCHAmount = defaultGetOutputMinAmount;
  }
  const p2nfth_compiler = createCompilerFromTemplateAndPredefinedWalletData('v1/p2nfth', p2nfth_template, {});
  const interest_nfthash = hexToBin("d81237da2d3816e3497c9521ae583dbeab893970d7c39882019649e64bcd8719");
  const p2nft_bytecode = generateBytecodeWithLibauthCompiler(p2nfth_compiler, { scriptId: '__main_script__' });
  const interest_locking_bytecode = generateBytecodeWithLibauthCompiler(p2nfth_compiler, { scriptId: '__main__', data: { bytecode: { nfthash: interest_nfthash } } });
  const moria_token_id = "b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366";
  const delphi_token_id = "d0d46f5cbd82188acede0d3e49c75700c19cb8331a30101f0bb6a260066ac972";
  const bporacle_token_id = "01711e39e7bf3b8ca0d9a6fc6ea32e340caa1d64dc7d1dc51fae20fd66755558";
  const batonminter_token_id = "9c8362ec067e2d516064b6184b6ef0c9a6e5daa7dfb4693e9764de48460b3d9b";
  return {
    moria_compiler: createCompilerFromTemplateAndPredefinedWalletData('v1/moria', moria_template, {
      delphi_token_category: hexToBin(delphi_token_id).reverse(),
      peek_token_category: hexToBin("15bac1da28946f31b9b2fa90e478f5ed1a16b7b0b8a4e45055ec9df704b9da07").reverse(),
      bporacle_token_category: hexToBin(bporacle_token_id).reverse(),
      p2nft_bytecode,
      interest_locking_bytecode,
    }),
    delphi_compiler: createCompilerFromTemplateAndPredefinedWalletData('v1/delphi', delphi_template, {
      update_token_category: hexToBin("5e437326449aba7855da3f5922fd65cfee6eab17c6869e0636016300b0f1c3c1").reverse(),
      withdraw_token_category: hexToBin("d9ba37f1142c5dcbd96db068493e5cf4412533eff0ce1a1fcb6482e48bb57d17").reverse(),
    }),
    delphi_gp_updater_compiler: createCompilerFromTemplateAndPredefinedWalletData('v1/delphigpupdater', delphigpupdater_template, {
      oracle_public_key: hexToBin('02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818'),
      migrate_token_category: hexToBin('39ec641e5387b2279e24efa04aa018278b0e3870ec24f2061bde7cdca4d41f56').reverse(),
    }),
    p2nfth_compiler,
    bporacle_compiler: createCompilerFromTemplateAndPredefinedWalletData('v1/bporacle', bporacle_template, {
      update_token_category: hexToBin("09361dc301b403a209682bc200b612a5f50787c4e737c944296fd97aa03cfff6").reverse(),
      withdraw_token_category: hexToBin("6634ad4545ad106bc37e47bc283e1f8a637a1dbd316221d40ee89f25bf791c2a").reverse(),
    }),
    batonminter_compiler: createCompilerFromTemplateAndPredefinedWalletData('v1/batonminter', batonminter_template, {
      withdraw_token_category: hexToBin("0d20157f9310fa8c834c5fb8be4c94440ff06495f8d8165e753da1037aa204c0").reverse(),
    }),
    moria_token_id, delphi_token_id, bporacle_token_id, batonminter_token_id,
    interest_nfthash, interest_locking_bytecode,

    mint_min_amount: 1000n, // 10.00 MUSD
    mint_max_amount: 3270000n, // 32700.00 MUSD
    mint_min_bp_rate: 0n, // 0%
    mint_max_bp_rate: 32700n, // 327%

    txfee_per_byte,
    getOutputMinAmount,
    getPreferredTokenOutputBCHAmount,
  };
};

export const createMoriaMutationContext = (compiler_context: MoriaCompilerContext, utxos: {
  moria: UTXOWithNFT,
  delphi: UTXOWithNFT,
  bporacle: UTXOWithNFT,
  batonminter: UTXOWithNFT,
  delphi_gp_updater?: UTXOWithNFT,
}): MoriaMutationContext => {
  return {
    compiler_context,
    moria_utxo: utxos.moria,
    delphi_utxo: utxos.delphi,
    bporacle_utxo: utxos.bporacle,
    batonminter_utxo: utxos.batonminter,
    delphi_gp_updater_utxo: utxos.delphi_gp_updater,
    list: [],
  };
};

export class MoriaMutator {
  _context: MoriaMutationContext;
  constructor (context: MoriaMutationContext) {
    this._context = context;
  }

  getMutationContext (): MoriaMutationContext {
    return this._context;
  }

  _onMoriaTx (tx_result: MoriaTxResult): void {
    this._context.moria_utxo = tx_result.moria_utxo;
    this._context.delphi_utxo = tx_result.delphi_utxo;
    if (tx_result.bporacle_utxo != null) {
      this._context.bporacle_utxo = tx_result.bporacle_utxo;
    }
    if (tx_result.batonminter_utxo != null) {
      this._context.batonminter_utxo = tx_result.batonminter_utxo;
    }
    this._context.list.push(tx_result);
  }

  mintLoanWithBatonMinter (params: { loan_amount: bigint, collateral_amount: bigint, annual_interest_bp: bigint }, funding_coins: SpendableCoin[], loan_agent_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): MoriaTxResult & { loan_utxo: UTXOWithNFT, batonminter_utxo: UTXOWithNFT, loan_agent_utxo: UTXOWithNFT } {
    const result = mintLoanWithBatonMinter(this._context.compiler_context, { moria: this._context.moria_utxo, delphi: this._context.delphi_utxo, batonminter: this._context.batonminter_utxo }, params, funding_coins, loan_agent_locking_bytecode, payout_rules);
    this._onMoriaTx(result);
    return result;
  }

  mintLoanWithExistingLoanAgent (params: { loan_amount: bigint, collateral_amount: bigint, annual_interest_bp: bigint }, funding_coins: SpendableCoin[], loan_agent_coin: SpendableCoin<OutputWithNFT>, output_loan_agent_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): MoriaTxResult & { loan_utxo: UTXOWithNFT } {
    const result = mintLoanWithExistingLoanAgent(this._context.compiler_context, { moria: this._context.moria_utxo, delphi: this._context.delphi_utxo }, params, funding_coins, loan_agent_coin, output_loan_agent_locking_bytecode, payout_rules);
    this._onMoriaTx(result);
    return result;
  }

  refiLoan (loan_utxo: UTXOWithNFT, refi_params: { loan_amount: bigint, collateral_amount: bigint, annual_interest_bp: bigint }, loan_agent_coin: SpendableCoin<OutputWithNFT>, funding_coins: SpendableCoin[], output_loan_agent_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): MoriaTxResult & { loan_utxo: UTXOWithNFT, interest_utxo: UTXOWithFT, loan_agent_utxo: UTXOWithNFT } {
    const result = refiLoan(this._context.compiler_context, { moria: this._context.moria_utxo, delphi: this._context.delphi_utxo, loan: loan_utxo }, refi_params, loan_agent_coin, funding_coins, output_loan_agent_locking_bytecode, payout_rules);
    this._onMoriaTx(result);
    return result;
  }

  repayLoan (loan_utxo: UTXOWithNFT, loan_agent_coin: SpendableCoin<OutputWithNFT>, funding_coins: SpendableCoin[], output_loan_agent_locking_bytecode: Uint8Array | BurnNFTException, payout_rules: PayoutRule[]): MoriaTxResult & { interest_utxo: UTXOWithFT } {
    const result = repayLoan(this._context.compiler_context, { moria: this._context.moria_utxo, delphi: this._context.delphi_utxo, loan: loan_utxo }, loan_agent_coin, funding_coins, output_loan_agent_locking_bytecode, payout_rules);
    this._onMoriaTx(result);
    return result;
  }

  liquidateLoan (loan_utxo: UTXOWithNFT, funding_coins: SpendableCoin[], payout_rules: PayoutRule[]): MoriaTxResult & { interest_utxo: UTXOWithFT } {
    const result = liquidateLoan(this._context.compiler_context, { moria: this._context.moria_utxo, delphi: this._context.delphi_utxo, loan: loan_utxo }, funding_coins, payout_rules);
    this._onMoriaTx(result);
    return result;
  }

  redeemLoan (loan_utxo: UTXOWithNFT, funding_coins: SpendableCoin[], payout_rules: PayoutRule[]): MoriaTxResult & { interest_utxo: UTXOWithFT, bporacle_utxo: UTXOWithNFT, borrower_p2nfth_utxo: UTXO } {
    const result = redeemLoan(this._context.compiler_context, { moria: this._context.moria_utxo, delphi: this._context.delphi_utxo, bporacle: this._context.bporacle_utxo, loan: loan_utxo }, funding_coins, payout_rules);
    this._onMoriaTx(result);
    return result;
  }

  updateMoriaSequence (funding_coin: SpendableCoin, change_locking_bytecode: Uint8Array): MoriaTxResult {
    const result = updateMoriaSequence(this._context.compiler_context, { moria: this._context.moria_utxo, delphi: this._context.delphi_utxo }, funding_coin, change_locking_bytecode);
    this._onMoriaTx(result);
    return result;
  }

  updateDelphiCommitmentWithGPUpdater (message: Uint8Array, sig: Uint8Array, funding_coins: SpendableCoin[], payout_rules: PayoutRule[]): TxResult & { delphi_utxo: UTXOWithNFT, delphi_gp_updater_utxo: UTXOWithNFT } {
    if (this._context.delphi_gp_updater_utxo == null) {
      throw new ValueError(`delphi_gp_updater_utxo is not defined!`);
    }
    const result = updateDelphiCommitmentWithGPUpdater(this._context.compiler_context, { delphi: this._context.delphi_utxo, delphi_gp_updater: this._context.delphi_gp_updater_utxo }, message, sig, funding_coins, payout_rules);
    this._context.delphi_utxo = result.delphi_utxo;
    this._context.delphi_gp_updater_utxo = result.delphi_gp_updater_utxo;
    this._context.list.push(result);
    return result;
  }

  loanAddCollateral (loan_utxo: UTXOWithNFT, loan_agent_coin: SpendableCoin<OutputWithNFT>, funding_coins: SpendableCoin[], additional_collateral_amount: bigint, output_loan_agent_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): TxResult & { loan_utxo: UTXOWithNFT, loan_agent_utxo: UTXOWithNFT } {
    const result = loanAddCollateral(this._context.compiler_context, loan_utxo, loan_agent_coin, funding_coins, additional_collateral_amount, output_loan_agent_locking_bytecode, payout_rules);
    this._context.list.push(result);
    return result;
  }

  withdrawPay2NFTHCoins (nft_coin: SpendableCoin<OutputWithNFT>, entries: Pay2NFTHWithdrawEntry[], funding_coins: SpendableCoin[], payout_rules: PayoutRule[], { createNFTOutput }: { createNFTOutput: (utxo: UTXOWithNFT) => OutputWithNFT }): TxResult & { nft_utxos: UTXOWithNFT[] } {
    const result = withdrawPay2NFTHCoins(this._context.compiler_context, nft_coin, entries, funding_coins, payout_rules, { createNFTOutput });
    this._context.list.push(result);
    return result;
  }
}

export const verifyTxResult = (tx_result: TxResult) => {
  const vm = libauth.createVirtualMachineBch2025();
  const result = vm.verify({
    sourceOutputs: tx_result.libauth_source_outputs,
    transaction: tx_result.libauth_transaction,
  });
  if (typeof result == 'string') {
    /* c8 ignore next */
    throw new ValueError(result);
  }
  return result;
};
