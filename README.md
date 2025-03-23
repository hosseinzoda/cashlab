<div align="center">
  <h1>cashlab</h1>
</div>

## Getting Started

cashlab is a set of high level packages to do defi in the BCH network. Written in typescript compatible with node.js & web runtime environments.

1. Choose the packages you want to use in your project.

Look up The list of features of every package is in its documentation.

2. Install the packages in your project.

```bash
# using npm
npm install --save @cashlab/PACKAGE_A @cashlab/PACKAGE_B
# using pnpm
pnpm add @cashlab/PACKAGE_A @cashlab/PACKAGE_B
# using yarn
yarn add @cashlab/PACKAGE_A @cashlab/PACKAGE_B
```

3. Import the modules and start coding.

Coding with typescript

```ts
import {
  SpendableCoin, SpendableCoinType, PayoutRule, PayoutAmountRuleType,
  CreatePayoutTxContext, createPayoutChainedTx, hexToBin
} from '@cashlab/common';
// a send payout example
const create_payout_tx_context: CreatePayoutTxContext = {
  // @ts-ignore
  getOutputMinAmount (output: Output): bigint {
    return 800n;
  },
  // @ts-ignore
  getPreferredTokenOutputBCHAmount (output: Output): bigint | null {
    return null;
  },
  txfee_per_byte: 1n,
};
const input_coins: SpendableCoin[] = MY_COINS.map((eutxo) => ({
  type: SpendableCoinType.P2PKH,
  key: MY_WALLET_PRIVATE_KEY,
  outpoint: { txhash: hexToBin(eutxo.tx_hash), index: eutxo.tx_pos },
  output: {
    locking_bytecode: typeof eutxo.locking_bytecode == 'string' ? binToHex(eutxo.locking_bytecode) : eutxo.locking_bytecode,
    amount: BigInt(eutxo.value),
    token: eutxo.token_data ? {
      amount: BigInt(eutxo.token_data.amount),
      token_id: eutxo.token_data.category,
      nft: eutxo.token_data.nft ? {
        capability: eutxo.token_data.nft.capability,
        commitment: hexToBin(eutxo.token_data.nft.commitment),
      } : undefined,
    } : undefined,
  },
}));
const payout_rules: PayoutRule[] = [
  {
    locking_bytecode: RECIPIENT_P2PKH_LOCKING_BYTECODE,
    type: PayoutAmountRuleType.FIXED,
    token: {
      amount: 100n, // SOME_TOKEN_ID having two decimals, Will represent 1.00 SOME_TOKEN
      token_id: SOME_TOKEN_ID,
    },
    amount: 1000n, // (sats)
  },
  {
    locking_bytecode: MY_WALLET_P2PKH_LOCKING_BYTECODE,
    type: PayoutAmountRuleType.CHANGE,
    spending_parameters: {
      type: SpendableCoinType.P2PKH,
      key: MY_WALLET_PRIVATE_KEY,
    },
  },
];
const result = createPayoutChainedTx(create_payout_tx_context, input_coins, payout_rules);
result.chain.forEach((tx_result, index) => {
  console.log(`TX#${index+1}: ${binToHex(tx_result.txbin)}`);
});
```

Coding with javascript

```js
import { SpendableCoinType, PayoutAmountRuleType, createPayoutChainedTx, hexToBin } from '@cashlab/common';
// a send payout example
const create_payout_tx_context = {
  getOutputMinAmount (output) {
    return 800n;
  },
  getPreferredTokenOutputBCHAmount (output) {
    return null;
  },
  txfee_per_byte: 1n,
};
const input_coins = MY_COINS.map((eutxo) => ({
  type: SpendableCoinType.P2PKH,
  key: MY_WALLET_PRIVATE_KEY,
  outpoint: { txhash: hexToBin(eutxo.tx_hash), index: eutxo.tx_pos },
  output: {
    locking_bytecode: typeof eutxo.locking_bytecode == 'string' ? binToHex(eutxo.locking_bytecode) : eutxo.locking_bytecode,
    amount: BigInt(eutxo.value),
    token: eutxo.token_data ? {
      amount: BigInt(eutxo.token_data.amount),
      token_id: eutxo.token_data.category,
      nft: eutxo.token_data.nft ? {
        capability: eutxo.token_data.nft.capability,
        commitment: hexToBin(eutxo.token_data.nft.commitment),
      } : undefined,
    } : undefined,
  },
}));
const payout_rules = [
  {
    locking_bytecode: RECIPIENT_P2PKH_LOCKING_BYTECODE,
    type: PayoutAmountRuleType.FIXED,
    token: {
      amount: 100n, // SOME_TOKEN_ID having two decimals, Will represent 1.00 SOME_TOKEN
      token_id: SOME_TOKEN_ID,
    },
    amount: 1000n, // (sats)
  },
  {
    locking_bytecode: MY_WALLET_P2PKH_LOCKING_BYTECODE,
    type: PayoutAmountRuleType.CHANGE,
    spending_parameters: {
      type: SpendableCoinType.P2PKH,
      key: MY_WALLET_PRIVATE_KEY,
    },
  },
];
createPayoutChainedTx(create_payout_tx_context, input_coins, payout_rules)
  .chain.forEach((tx_result, index) => {
    console.log(`TX#${index+1}: ${binToHex(tx_result.txbin)}`);
  });
```

## Documentation

- [@cashlab/common](https://hosseinzoda.github.io/cashlab/common/)
- [@cashlab/cauldron](https://hosseinzoda.github.io/cashlab/cauldron/)
- [@cashlab/moria](https://hosseinzoda.github.io/cashlab/moria/)

