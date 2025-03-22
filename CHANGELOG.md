# Changelog

All notable changes of this module is documented in this file, Documenting changelog has start from version `0.0.9`.

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
