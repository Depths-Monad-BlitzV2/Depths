# Depths: On-Chain Roguelike Dungeon on Monad

**Depths** is a push-your-luck roguelike where every floor is generated and resolved on-chain. You pay a 1 MON entry fee and descend floor by floor through monsters, treasure, traps, and merchants. After every floor you choose: **CASH OUT** and send your bag to your wallet, or **GO DEEPER** for bigger loot. If you die, your bag goes to the prize pool that funds the next players' loot.

| | |
|---|---|
| **Live app** | **https://depths-monad.vercel.app** |
| **Contract (Monad Testnet)** | [`0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc`](https://testnet.monadexplorer.com/address/0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc) |
| **Verified source** | [MonadVision (Sourcify `match`)](https://testnet.monadvision.com/address/0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc) |
| **Chain** | Monad Testnet, chain ID `10143` |

## How to play

1. Open the [live app](https://depths-monad.vercel.app), connect MetaMask or Rabby on **Monad Testnet**, and get test MON from [faucet.monad.xyz](https://faucet.monad.xyz) if needed.
2. Click **MASUK DUNGEON** ("enter the dungeon"; the in-game UI is in Indonesian). This is the only wallet popup per run: it pays the 1 MON entry and tops up a session wallet with gas.
3. Each floor rolls an encounter:
   - **Monster (40%)**: fight, flee, or use a potion.
   - **Treasure (25%)**: collect loot.
   - **Trap (15%)**: take damage or attempt disarm.
   - **Merchant (20%)**: spend bag MON on potions (+50 HP), swords (+10 ATK), or shields (+20 max HP).
4. Survive, then choose **CASH OUT** (transfer bag to your wallet) or **GO DEEPER** (advance floor, encounter harder monsters, earn larger loot). Clearing floor 20 automatically cashes out.
5. If your character dies, the run ends and your bag remains in the pool. Check the **Leaderboard** for top runs.

## Why Monad

Each floor requires roughly two transactions (`act` -> `descend`/`cashOut`), totaling ~22 transactions for a 10-floor run. Monad's ~400 ms block times and sub-second finality make this gameplay loop viable:

- **Session keys**: After the initial entry transaction, a browser-generated burner wallet signs all in-run actions without extra approval popups. Payouts always transfer directly to your primary wallet.
- **Unbiasable randomness, no oracle**: Every action commits to `targetBlock = block.number + 1`. The outcome derives from that future blockhash and resolves inside your subsequent transaction, eliminating extra round-trips. Unresolved commits after 256 blocks expire as fatal.
- **Gas limit calibrated**: Monad charges based on the gas limit rather than gas used. The frontend specifies calibrated limits per path (`apps/web/lib/gas.ts`) and submits them via a serialized nonce queue.

## Architecture

```
contracts/            Foundry: Depths.sol (state, access, accounting) + DepthsLogic.sol (pure logic)
packages/game-logic/  TypeScript mirror of DepthsLogic + Monte Carlo simulator (parity-tested)
apps/web/             Next.js 15 + wagmi v2 + viem + RainbowKit + Tailwind + zustand
apps/keeper/          Node bot: relays stalled reveal/settle transactions and reaps expired runs
docs/                 Design, spec, and architecture documentation (Indonesian)
```

- **Solvency invariant**: The contract enforces `balance >= pool + reserved + treasury`. Per-award loot is capped at 5% of the active pool, preventing pool drains. No admin role can withdraw pool funds or player bags. All asset transfers implement Checks-Effects-Interactions and `nonReentrant`.
- **Client-side replay**: The frontend replays combat instantly using the on-chain seed and TypeScript mirror before the transaction confirms on-chain.

## Run it locally

### Prerequisites

- **Node.js >= 22** and **pnpm 11** (`corepack enable`)
- **Foundry** (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- A Web3 browser wallet (MetaMask or Rabby)

### 1. Clone and install

```bash
git clone --recurse-submodules https://github.com/Depths-Monad-BlitzV2/Depths.git
cd Depths
pnpm install
```

If cloned without submodules, run `git submodule update --init --recursive` to pull `forge-std` and OpenZeppelin contracts.

### 2a. Run with deployed testnet contract

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm -F web dev
```

Open `http://localhost:3000/play`. Ensure your wallet is connected to Monad Testnet (Chain ID `10143`, RPC `https://testnet-rpc.monad.xyz`).

### 2b. Run with local chain (Anvil)

```bash
pnpm dev:local
```

This starts `anvil --block-time 1`, deploys the contract with an 80 MON seed pool, syncs the ABI, and launches both web app and keeper. Import Anvil default account #0 (`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`) into your wallet and connect to `localhost:8545` (Chain ID `31337`).

Note: Anvil must run with `--block-time` set; automine will not produce the future block required for RNG reveals.

### Environment variables (`apps/web/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_CHAIN` | yes | `monadTestnet` or `anvil` |
| `NEXT_PUBLIC_DEPTHS_ADDRESS` | yes | Depths contract address |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | yes | Deployment block for event scans and leaderboard |
| `NEXT_PUBLIC_RPC_HTTP` | no | Primary RPC endpoint |
| `NEXT_PUBLIC_RPC_HTTP_FALLBACK` | no | Comma-separated fallback RPC endpoints |
| `NEXT_PUBLIC_WC_PROJECT_ID` | no | WalletConnect project ID |

## Testing

```bash
pnpm check                              # Run all test suites, linting, and typechecks

cd contracts
forge test                              # Unit, fuzz, and invariant tests
forge test --match-contract Invariant   # Solvency invariants (256 runs x depth 100)
cd ..
pnpm -F game-logic test                 # 550 parity vectors (TS mirror vs Solidity)
pnpm -F game-logic simulate             # Monte Carlo simulation (100k runs)
pnpm -F web test                        # Frontend unit tests
pnpm -F web lint && pnpm -F web typecheck
```

Headless end-to-end test against a live chain:

```bash
OWNER_PRIVATE_KEY=0x... FLOORS=3 pnpm -F web e2e
```

## Contract deployment

```bash
cd contracts
cp .env.example .env    # set PRIVATE_KEY and MONAD_TESTNET_RPC
source .env
SEED_POOL=80000000000000000000 forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
forge verify-contract <address> src/Depths.sol:Depths --chain 10143 --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --constructor-args $(cast abi-encode "constructor(address)" <owner>)
cd .. && pnpm abi:sync
```

Optional keeper bot (relays stuck transactions and cleans expired runs):

```bash
cp apps/keeper/.env.example apps/keeper/.env
pnpm -F keeper start
```

## Deployment details

| Network | Contract | Deploy Block | Explorer |
|---|---|---|---|
| Monad Testnet (10143) | `0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc` | 73753772 (tx [`0x87a4...c76b`](https://testnet.monadexplorer.com/tx/0x87a41a34d531dfc57bd154ab4db66a72716aa9fad6a52842d5b98be238dec76b)) | [MonadExplorer](https://testnet.monadexplorer.com/address/0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc) / [MonadVision](https://testnet.monadvision.com/address/0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc) |

- **Owner**: `0x5219fFbF9A44F96A8931A50A31021E4724518735`. Restricted to emergency pause, adjusting entry fee between 0.2 and 20 MON, and withdrawing the 5% treasury rake.
- **Initial seed pool**: 80 MON.
- **Previous deployment**: `0x0970...65AC` (block 73431066) is deprecated.

## Documentation

Full design and architecture specifications (written in Indonesian):

| Document | Contents |
|---|---|
| [PRD](docs/PRD.md) | Product requirements and scope |
| [Game Design](docs/GAME_DESIGN.md) | Math, tables, and economic simulation |
| [Architecture](docs/ARCHITECTURE.md) | State machine, RNG flow, and session keys |
| [Contract Spec](docs/CONTRACT_SPEC.md) | Solidity interfaces, events, and invariants |
| [Security](docs/SECURITY.md) | Threat model and security checklist |
| [UI/UX](docs/UI_UX.md) | Flow, wireframes, and interface copy |
| [Build Plan](docs/BUILD_PLAN.md) | Implementation phases and DoD |

**Notice:** Testnet only. Depths involves wagering mechanics; mainnet deployment requires a formal security audit and legal review.
