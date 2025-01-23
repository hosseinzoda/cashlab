import type {
  TxResult, MoriaTxResult, MintTxResult, RedeemTxResult, AddCollateralTxResult,
  RefinanceLoanResult, CompilerContext,
  LoanNFTParameters, OracleNFTParameters,
} from './types.js';
import type {
  TokenId, UTXOWithNFT, Output, SpendableCoin, PayoutRule, Fraction,
} from '../../common/types.js';
import { ValueError, InvalidProgramState } from '../../common/exceptions.js';
import { convertTokenIdToUint8Array } from '../../common/util.js';
import {
  mintLoan, repayLoan, liquidateLoan,
  redeemWithSunsetSignature, addCollateral, reduceLoan,
} from './compiler.js';
import * as libauth from '@bitauth/libauth';
const { hexToBin, binToBigIntUintLE, binToNumberUint32LE } = libauth;
import moriav0_template_data from './moria-v0-template.json' assert { type: "json" };
import d3lphi_oracle_template_data from './d3lphi-oracle-template.json' assert { type: "json" };

export type MoriaV0Constants = {
  musd_token_id: TokenId;
  oracle_token_id: TokenId;
  sunset_pubkey: Uint8Array;
  sunset_message: Uint8Array;
};

const makeWalletDataOperation = (getPredefinedData: () => any) => {
  return libauth.compilerOperationRequires({
    canBeSkipped: false,
    configurationProperties: [],
    dataProperties: [],
    operation: (identifier, data) => {
      const predefined_data = getPredefinedData();
      let bytecode = (predefined_data ? predefined_data[identifier] : null);
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


export default class MoriaV0 {
  _default_preferred_token_output_bch_amount: bigint | null;
  _context: CompilerContext;
  _template_predefined_data: { [template_name: string]: any };
  static getConstants (): MoriaV0Constants {
    return {
      musd_token_id: '4046913cba6b70b2214a048a3df92252849f481ffa1455ed7faf17243c36bf67',
      oracle_token_id: 'b0b6fc3d5cda81f4bb3fe464767dcc33e80b6356e4838f4dda40a1871a625950',
      sunset_pubkey: hexToBin('0245723536e975f7f36fe157beca72acb939738698e5374d2c2f42e222273537bf'), // encoded sunset public key
      sunset_message: hexToBin('73756e736574ab166bdd990ee54e4cecd3a346a9891e26c650b2'), // sunset message
    };
  }
  static moriaLibauthCompiler (getPredefinedData: () => { sunset_pubkey: Uint8Array, sunset_message: Uint8Array, oracle_token: Uint8Array }): libauth.CompilerBCH {
    const moriav0_template = libauth.importWalletTemplate(moriav0_template_data);
    if (typeof moriav0_template  == 'string') {
      /* c8 ignore next */
      throw new InvalidProgramState(`Failed import libauth template (moriav0), error: ${moriav0_template}`);
    };
    return libauth.createCompilerBCH({
      ...libauth.walletTemplateToCompilerConfiguration(moriav0_template),
      operations: {
        ...libauth.compilerOperationsBCH,
        walletData: makeWalletDataOperation(getPredefinedData),
      },
    } as libauth.CompilerConfiguration<libauth.CompilationContextBCH>);
  }
  static oracleLibauthCompiler (getPredefinedData: () => { owner_pubkey: Uint8Array }): libauth.CompilerBCH {
    const d3lphi_oracle_template = libauth.importWalletTemplate(d3lphi_oracle_template_data);
    if (typeof d3lphi_oracle_template  == 'string') {
      /* c8 ignore next */
      throw new InvalidProgramState(`Failed import libauth template (d3lphi_oracle), error: ${d3lphi_oracle_template}`);
    }
    return libauth.createCompilerBCH({
      ...libauth.walletTemplateToCompilerConfiguration(d3lphi_oracle_template),
      operations: {
        ...libauth.compilerOperationsBCH,
        walletData: makeWalletDataOperation(getPredefinedData),
      },
    } as libauth.CompilerConfiguration<libauth.CompilationContextBCH>);
  }
  constructor ({ oracle_owner_pubkey, txfee_per_byte }: { oracle_owner_pubkey: Uint8Array, txfee_per_byte: bigint }) {
    const ctr = this.constructor as typeof MoriaV0;
    const { musd_token_id, oracle_token_id, sunset_pubkey, sunset_message } = ctr.getConstants();
    this._template_predefined_data = {
      moria: {
        sunset_pubkey, sunset_message,
        oracle_token: hexToBin(oracle_token_id),
      },
      oracle: {
        owner_pubkey: oracle_owner_pubkey,
      },
    };
    const moria_compiler = ctr.moriaLibauthCompiler(() => this._template_predefined_data['moria']);
    const oracle_compiler = ctr.oracleLibauthCompiler(() => this._template_predefined_data['oracle']);
    this._context = {
      getOutputMinAmount: this.getOutputMinAmount.bind(this),
      getPreferredTokenOutputBCHAmount: this.getPreferredTokenOutputBCHAmount.bind(this),
      moria_compiler, oracle_compiler,
      musd_token_id, oracle_token_id,
      txfee_per_byte,
      oracle_use_fee: 1000n,
      moria_required_output_amount: 1000n,
      mint_musd_payout_required_output_amount: 1000n,
      min_mint_musd_amount: 100n,
    };
    this._default_preferred_token_output_bch_amount = null;
  }

  getCompilerContext (): CompilerContext {
    return this._context;
  }

  getOutputMinAmount (output: Output): bigint {
    const lauth_output: libauth.Output = {
      lockingBytecode: output.locking_bytecode,
      valueSatoshis: output.amount,
      token: output.token != null ? {
        amount: output.token.amount as bigint,
        category: convertTokenIdToUint8Array(output.token.token_id),
        nft: output.token.nft != null ? {
          capability: output.token.nft.capability,
          commitment: output.token.nft.commitment,
        } : undefined,
      } : undefined,
    };
    return libauth.getDustThreshold(lauth_output);
  }
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null {
    if (output == null) {
      throw new ValueError('output should not be null');
    }
    return this._default_preferred_token_output_bch_amount;
  }
  setDefaultPreferredTokenOutputBCHAmount (value: bigint | null) {
    this._default_preferred_token_output_bch_amount = value;
  }
  getTxFeePerByte (): bigint {
    return this._context.txfee_per_byte;
  }
  setTxFeePerByte (value: bigint): void {
    this._context.txfee_per_byte = value;
  }


  /**
   * Mint a new loan. The collateral amount is taken from input_coins and the remaining - fees is in the payouts.
   *
   * @param moria_utxo - The moria's utxo.
   * @param oracle_utxo - The oracle's utxo.
   * @param input_coins - A set of spendable coins to fund the loan's collateral + fees
   * @param loan_amount - The amount of MUSD to mint.
   * @param collateral_amount - The collateral amount (sats)
   * @param borrower_pkh - borrower's public key's hash160, the pkh's format is equivalent to pkh used in p2pkh
   * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
   * @returns The mint tx result.
   *
   */
  mintLoan (moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, input_coins: SpendableCoin[], loan_amount: bigint, collateral_amount: bigint, borrower_pkh: Uint8Array, token_payout_locking_bytecode: Uint8Array, payout_rules: PayoutRule[]): MintTxResult {
    return mintLoan(this._context, moria_utxo, oracle_utxo, input_coins, loan_amount, collateral_amount, borrower_pkh, token_payout_locking_bytecode, payout_rules);
  }

  /**
   * Repay a loan with MUSD tokens equivalent to the loan amount.
   * The payout is the loan's collateral + the remainder of MUSD tokens if more MUSD is provided in inputs.
   * 
   *
   * @param moria_utxo - The moria's utxo.
   * @param oracle_utxo - The oracle's utxo.
   * @param loan_utxo - The current loan's utxo.
   * @param loan_private_key - The private key of the current loan.
   * @param input_coins - A set of spendable coins to fund the refinance procedure.
   * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
   * @returns A tx that pays out the collateral in exchange for MUSD
   *
   */
  repayLoan (moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, loan_utxo: UTXOWithNFT, loan_private_key: Uint8Array, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): MoriaTxResult {
    return repayLoan(this._context, moria_utxo, oracle_utxo, loan_utxo, loan_private_key, input_coins, payout_rules);
  }

  /**
   * Liquidate an under-water (collateral < 110%) loan. With MUSD tokens equivalent to the loan amount.
   * The payout is the loan's collateral + the remainder of MUSD tokens if more MUSD is provided in inputs.
   * 
   *
   * @param moria_utxo - The moria's utxo.
   * @param oracle_utxo - The oracle's utxo.
   * @param loan_utxo - The current loan's utxo.
   * @param input_coins - A set of spendable coins to fund the refinance procedure.
   * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
   * @returns A tx that pays out the collateral in exchange for MUSD
   *
   */
  liquidateLoan (moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, loan_utxo: UTXOWithNFT, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): MoriaTxResult {
    return liquidateLoan(this._context, moria_utxo, oracle_utxo, loan_utxo, input_coins, payout_rules);
  }

  /**
   * Redeem MUSD tokens equivalent to the loan amount with a BCH payout,
   * The payout includes the remainder of MUSD tokens if more MUSD is provided in inputs.
   * 
   *
   * @param moria_utxo - The moria's utxo.
   * @param oracle_utxo - The oracle's utxo.
   * @param loan_utxo - The current loan's utxo.
   * @param sunset_datasig - A unique sig which will be revealed on the blockchain once the sunset event occurs.
   * @param input_coins - A set of spendable coins to fund the refinance procedure.
   * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
   * @returns A tx that redeems MUSD with BCH payouts
   *
   */
  redeemWithSunsetSignature (moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, loan_utxo: UTXOWithNFT, sunset_datasig: Uint8Array, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): RedeemTxResult {
    return redeemWithSunsetSignature(this._context, moria_utxo, oracle_utxo, loan_utxo, sunset_datasig, input_coins, payout_rules);
  }

  /**
   * Add collateral to an existing loan.
   * 
   *
   * @param loan_utxo - The current loan's utxo.
   * @param amount - The amount to increase the collateral.
   * @param loan_private_key - The private key of the current loan.
   * @param input_coins - A set of spendable coins to fund the refinance procedure.
   * @param payout_rules - A list of payout rules.
   * @returns add collateral tx result
   *
   */
  addCollateral (loan_utxo: UTXOWithNFT, amount: bigint, loan_private_key: Uint8Array, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): AddCollateralTxResult {
    return addCollateral(this._context, loan_utxo, amount, loan_private_key, input_coins, payout_rules);
  }

  /**
   * Mint a new loan to pay back another loan to reduce the size and/or the collateral of the loan.
   * Contrary to the name reduce this method allows the collateral level to increase.
   * 
   *
   * @param moria_utxo - The moria's utxo.
   * @param oracle_utxo - The oracle's utxo.
   * @param current_loan_utxo - The current loan's utxo.
   * @param current_loan_private_key - The private key of the current loan.
   * @param next_collateral_ratio - A fraction that represents the ratio of the collateral at the current oracle price, Or pass 'MIN' to provide the minimum collateral.
   * @param next_loan_pkh - borrower's public key's hash160, the pkh's format is equivalent to pkh used in p2pkh.
   * @param input_coins - A set of spendable coins to fund the refinance procedure.
   * @param payout_rules - A list of payout rules. The payout rules is expected to not have more than two outputs.
   * @returns refinance tx chain with details
   *
   */
  reduceLoan (moria_utxo: UTXOWithNFT, oracle_utxo: UTXOWithNFT, current_loan_utxo: UTXOWithNFT, current_loan_private_key: Uint8Array, next_collateral_rate: Fraction | 'MIN', next_loan_pkh: Uint8Array, input_coins: SpendableCoin[], payout_rules: PayoutRule[]): RefinanceLoanResult {
    return reduceLoan(this._context, moria_utxo, oracle_utxo, current_loan_utxo, current_loan_private_key, next_collateral_rate, next_loan_pkh, input_coins, payout_rules);
  }


  /*
    Verify the validity of createTradeTx result, Expecting it should always get verified.
   */
  verifyTxResult (tx_result: TxResult): void {
    const vm = libauth.createVirtualMachineBCH();
    const result = vm.verify({
      sourceOutputs: tx_result.libauth_source_outputs,
      transaction: tx_result.libauth_transaction,
    });
    if (typeof result == 'string') {
      /* c8 ignore next */
      throw new InvalidProgramState(result);
    }
  }

  getInfo (): { musd_token_id: TokenId, oracle_token_id: TokenId } {
    return {
      musd_token_id: this._context.musd_token_id,
      oracle_token_id: this._context.oracle_token_id,
    };
  }

  static parseParametersFromLoanNFTCommitment (commitment: Uint8Array): LoanNFTParameters {
    if (!(commitment instanceof Uint8Array && commitment.length > 20)) {
      throw new ValueError('commitment size does not meet the requirement');
    }
    return {
      borrower_pkh: commitment.slice(0, 20),
      amount: binToBigIntUintLE(commitment.slice(20)),
    }
  }
  static parseOracleMessageFromNFTCommitment (commitment: Uint8Array): OracleNFTParameters {
    if (!(commitment instanceof Uint8Array && commitment.length == 36)) {
      throw new ValueError(`Expecting oracle_utxo nft to have a 36 bytes commitment.`);
    }
    return {
      oracle_pkh: commitment.slice(0, 20),
      price: binToBigIntUintLE(commitment.slice(32, 36)),
      metadata: {
        timestamp: binToNumberUint32LE(commitment.slice(20, 24)),
        message_sequence: binToNumberUint32LE(commitment.slice(24, 28)),
        data_sequence: binToNumberUint32LE(commitment.slice(28, 32)),
      },
    };
  }
}
