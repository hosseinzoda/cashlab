# Changelog

All notable changes of this module is documented in this file, Documenting changelog has start from version `0.0.9`.


## common [1.0.3] & moria [1.1.0] - 2025-06-10

### ADDED

- Improved transaction generation with the help of libauth & input unlockers
- `SpendableCoinType.ON_DEMAND_UNLOCKER`, Ability to build custom unlocking bytecode for inputs. The unlock method allows `SpendableCoin` to contain utxos with custom scripts.
- Integrating MoriaV1 to `@cashlab/moria` package. Containing tools to generate moria transactions, read/write moria outputs, withdraw p2nfth utxos +more.


### CHANGED

- Bumped `@bitauth/libauth` dependency version to 3.1.0-next.6


## common [1.0.2] - 2025-04-25

### ADDED

- `createPayoutTx` function implemented
- `PayoutChangeRule.generateChangeLockingBytecodeForOutput`, Can be used to generate different change addresses for each output.
- `PayoutChangeRule.allow_mixing_native_and_token_when_bch_change_is_dust`, mixes (extra) native bch with a token when the bch change is dust.
- `PayoutChangeRule.add_change_to_txfee_when_bch_change_is_dust`, adds the dust to the txfee when the bch change is less than min allowed in an output.

### CHANGED

- remove Buffer implementation of `uint8ArrayEqual`

## [1.0.0] - 2025-03-22

### CHANGED

- Make the code compatible with node up to v23.10.0
- Migrate to a monorepo project. @cashlab/*
- Migrate to pnpm package manager

## [0.1.0] - 2024-12-20

### ADDED

- MoriaV0, tools for interacting with the moria protocol.

### CHANGED

- Move payout-builder.ts from cauldron's building transaction code to common.
- Rename write-trade-tx & write-chained-trade-tx to create-trade-tx & create-chained-trade-tx.

## [0.0.17] - 2024-11-21

### ADDED

- Ability to set preferred bch amount in token outputs.

### FIXED

- The generate tx process of write-chained-txs to account for the estimated txfee

## [0.0.12] - 2024-08-25

### FIXED

- Improvements & fixes in best rate for target supply & demand methods
- Improvements in eliminate net negative pools method

## [0.0.10] & [0.0.11] - 2024-08-05

### FIXED

- A fix in: `src/cauldron/util.ts@calcTradeWithTargetSupplyFromAPair`
- Throw insufficient funds error when target supply cannot acquire any token.

## [0.0.9] - 2024-08-03

### ADDED

- A method for writing chained exchange transactions, BCH mainnet has a limit of 100k bytes per transaction. Chained transactions allows building exchanges that use high pool count (>500).
- Construct trades with a target supply.

### CHANGES

- Improved best rate algorithm
- Improved eliminate net negative pools algorithm.
- Improved write tx performance with the help of `src/cauldron/binuitl.ts`.
- Split & refactor the `exchange-lab.ts` code, Some methods moved to other files, And commonly used functions is moved to `src/cauldron/util.ts`. 
- Modified behaviour of construct best trade for a target demand. With this change the result trade will demand at least the requested amount excluding the trade fee.
