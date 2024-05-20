# Features

- construct cauldron exchange trades, generate cauldron trade transactions.



# Cauldron example

```
import { 
  ExchangeLab as CauldronExchangeLab, 
  PoolV0Parameters as CauldronPoolV0Parameters,
  PoolV0 as CauldronPoolV0,
  TradeResult as CauldronTradeResult,
  TradeTxResult as CauldronTradeTxResult,
} from '@cashcrop/cashlab/cauldron';
const exlab = new CauldronExchangeLab();

const supply_token_id: TokenId = 'BCH';
const demand_token_id: TokenId = <the_token_id_hex as string>;
const pool0_params: CauldronPoolV0Parameters = {
  withdraw_pubkey_hash: <the_withdraw_pubkey_hash_of_the_pool>,
};
const pool0_locking_bytecode = exlab.generatePoolV0LockingBytecode(pool0_params)
const input_pools: CauldronPoolV0[] = [
  {
    version: '0',
    parameters: pool0_params,
    outpoint: {
      index: <utxo_index as number>,
      txhash: <utxo_txhash as Uint8Array>,
    },
    output: {
      locking_bytecode: pool0_locking_bytecode,
      token: {
        amount: <token_amount as bigint>,
        token_id: <the_token_id_hex as string>,
      },
      amount: <satoshis_amount as bigint>,
    },
  },
  ....
];
const demand: bigint = <an amount greater than zero>;

const result: CauldronTradeResult = exlab.constractTradeBestRateForTargetAmount(supply_token_id, demand_token_id, demand, input_pools);

const txfee_per_byte: bigint = 1n;

const result: CauldronTradeTxResult = exlab.writeTradeTx(input_pool_trade_list, input_coins, payout_rules, null, txfee_per_byte);
 
exlab.verifyTradeTx(result);

console.log(Object.fromEntries([ 'txfee', 'payout_outputs' ].map((a) => [ a, result[a] ])))

broadcastTransaction(result.txbin)
```

