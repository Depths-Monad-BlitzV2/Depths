# Depths — On-Chain Roguelike Dungeon on Monad

> Pay to enter. The deeper you go, the richer you get. Die, and you lose it all. How deep will you dare?

**Depths** is a push-your-luck roguelike where every floor is generated and resolved on-chain. You pay a 1 MON entry fee and descend floor by floor through monsters, treasure, traps and merchants. After every floor you choose: **CASH OUT** and send your bag to your wallet, or **GO DEEPER** for bigger loot. If you die, your bag goes to the prize pool that funds the next players' loot.

| | |
|---|---|
| 🎮 **Live app** | **https://depths-3n6s.vercel.app** |
| 📜 **Contract (Monad Testnet)** | [`0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc`](https://testnet.monadexplorer.com/address/0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc) |
| ✅ **Verified source** | [MonadVision (Sourcify `match`)](https://testnet.monadvision.com/address/0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc) |
| 🔗 **Chain** | Monad Testnet, chain ID `10143` |

## How to play
1. Open the [live app](https://depths-3n6s.vercel.app), connect MetaMask or Rabby on **Monad Testnet**, and grab test MON from [faucet.monad.xyz](https://faucet.monad.xyz) if needed.
2. Press **MASUK DUNGEON** ("enter the dungeon"; the in-game UI copy is Indonesian). This is the **only wallet popup per run**: it pays the 1 MON entry and tops up a session wallet with a small amount of gas.
3. Each floor rolls an encounter:
   - 🐉 **Monster (40%)**: fight, flee, and/or drink a potion.
   - 💰 **Treasure (25%)**: free loot.
   - 🪤 **Trap (15%)**: you take damage.
   - 🏪 **Merchant (20%)**: spend bag MON on a potion (+50 HP), sword (+10 ATK) or shield (+20 max HP).
4. Survive, then choose **CASH OUT** (bag → your wallet) or **GO DEEPER** (floor +1, harder monsters, bigger loot). Clearing floor 20 auto-cashes out.
5. Die and the run is over: your bag stays in the pool. Check the **Leaderboard** for the deepest and richest runs.

## Why Monad
Each floor is about 2 transactions (`act` → `descend`/`cashOut`), so a 10-floor run is ~22 transactions. That only feels like a game with Monad's ~400 ms blocks and sub-second finality:
- **Session keys**: after the single entry popup, a browser-generated burner wallet signs every in-run transaction instantly. Payouts always go to your main wallet, never to the burner.
- **Unbiasable randomness, no oracle**: every decision commits to `targetBlock = block.number + 1`. The outcome comes from that *future* blockhash and is revealed inside your *next* transaction, so there is no extra round-trip. A result not revealed within 256 blocks counts as death, with no re-roll.
- **Gas-limit aware**: Monad charges the gas *limit*, so the frontend sends every tx with an explicit, calibrated limit (`apps/web/lib/gas.ts`) through a serial nonce-managed queue.

## Architecture
```
contracts/            Foundry: Depths.sol (state, access, money) + DepthsLogic.sol (pure gameplay)
packages/game-logic/  TypeScript mirror of DepthsLogic + Monte Carlo simulator (parity-tested)
apps/web/             Next.js 15 + wagmi v2 + viem + RainbowKit + Tailwind + zustand
apps/keeper/          Node bot: relays stuck reveal/settle txs and reaps expired runs
docs/                 Product and technical docs (Indonesian)
```
- **Money safety**: invariant `balance >= pool + reserved + treasury` (fuzzed by invariant tests). Loot is capped at 5% of the free pool per award, so the pool cannot be drained. No admin function can withdraw `pool` or player bags. CEI + `nonReentrant` on every function that sends MON.
- **Client-side replay**: the frontend replays combat from the on-chain seed with the TS mirror, so outcomes appear before the tx lands. The contract emits no per-round logs.

## Run it yourself

### Prerequisites
- **Node.js ≥ 22** and **pnpm 11** (`corepack enable`)
- **Foundry** (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- A browser wallet (MetaMask or Rabby)

### 1. Clone and install
```bash
git clone --recurse-submodules https://github.com/Depths-Monad-BlitzV2/Depths.git
cd Depths
pnpm install
```
Forgot `--recurse-submodules`? Run `git submodule update --init --recursive` (pulls forge-std and OpenZeppelin).

### 2a. Play against the deployed testnet contract (fastest)
```bash
cp apps/web/.env.example apps/web/.env.local   # already filled with the testnet contract above
pnpm -F web dev                                # http://localhost:3000/play
```
Add your wallet's Monad Testnet network (chain `10143`, RPC `https://testnet-rpc.monad.xyz`) and fund it from the faucet.

### 2b. Fully local chain (no testnet MON needed)
```bash
pnpm dev:local
```
This one command starts `anvil --block-time 1`, deploys the contract with an 80 MON seed pool, syncs the ABI, and runs the web app and keeper. It never touches your `.env` files. Import anvil account #0 (`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`, a **public test key**) into your wallet and switch to `localhost:8545` (chain `31337`).

> Anvil **must** run with `--block-time`: automine produces no new block for the reveal, so runs would never resolve.

### Environment variables (`apps/web/.env.local`)
| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_CHAIN` | yes | `monadTestnet` or `anvil` |
| `NEXT_PUBLIC_DEPTHS_ADDRESS` | yes | Depths contract address |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | yes | Deploy block, where event scans (leaderboard) start |
| `NEXT_PUBLIC_RPC_HTTP` | no | Primary RPC; public Monad RPCs are used as fallbacks |
| `NEXT_PUBLIC_RPC_HTTP_FALLBACK` | no | Extra RPCs, comma-separated |
| `NEXT_PUBLIC_WC_PROJECT_ID` | no | [Reown](https://cloud.reown.com) project ID; without it only browser-extension wallets are offered |

## Tests
```bash
pnpm check                              # all test suites + lint/typecheck in one command (not the simulator)

cd contracts
forge test                              # 131 tests: unit, fuzz, and invariant (solvency, reserved == bags)
forge test --match-contract Invariant   # solvency invariants only (256 runs × depth 100)
cd ..
pnpm -F game-logic test                 # 550 parity vectors: TS mirror == Solidity
pnpm -F game-logic simulate             # Monte Carlo RTP (100k runs)
pnpm -F web test                        # frontend libs: gas, run phases, relay, session, narrator
pnpm -F web lint && pnpm -F web typecheck
```
End-to-end against a live chain (headless, uses the same `lib/*` as `/play`):
```bash
OWNER_PRIVATE_KEY=0x... FLOORS=3 pnpm -F web e2e
```

## Deploy your own (testnet only)
```bash
cd contracts
cp .env.example .env    # set PRIVATE_KEY (0x-prefixed) and MONAD_TESTNET_RPC
source .env
SEED_POOL=80000000000000000000 forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
forge verify-contract <address> src/Depths.sol:Depths --chain 10143 --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --constructor-args $(cast abi-encode "constructor(address)" <owner>)
cd .. && pnpm abi:sync  # copy the ABI to apps/web and apps/keeper
```
The script refuses any chain except `10143` and `31337` and writes `contracts/deployments/<chainId>.json`. Then set the new address and deploy block in `apps/web/.env.local` (and in your hosting provider's env, e.g. Vercel with root directory `apps/web`).

**Keeper** (optional, relays stuck runs after 200 blocks and reaps expired ones):
```bash
cp apps/keeper/.env.example apps/keeper/.env   # KEEPER_PRIVATE_KEY, DEPTHS_ADDRESS, RPC_HTTP
pnpm -F keeper start
```

## Deployment
| Network | Contract | Deploy | Explorer |
|---|---|---|---|
| Monad Testnet (10143) | `0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc` | block 73753772, tx [`0x87a4…c76b`](https://testnet.monadexplorer.com/tx/0x87a41a34d531dfc57bd154ab4db66a72716aa9fad6a52842d5b98be238dec76b) | [MonadExplorer](https://testnet.monadexplorer.com/address/0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc) · [MonadVision (verified source)](https://testnet.monadvision.com/address/0xe32D93B3fF01F25bC1455f1dB28f7d9A405B24Dc) |

- **Owner**: `0x5219fFbF9A44F96A8931A50A31021E4724518735`. The owner can only pause, adjust the entry fee within 0.2–20 MON, and withdraw the 5% treasury rake.
- **Initial seed pool**: 80 MON. Details: [contracts/deployments/10143.json](contracts/deployments/10143.json).
- **Previous deployment**: `0x0970…65AC` (block 73431066) is superseded by the encounter-roll change; its pool stays locked there by design.

## Documentation
Design docs are written in Indonesian.

| Doc | Contents |
|---|---|
| [PRD](docs/PRD.md) | Product, goals, scope |
| [Game Design](docs/GAME_DESIGN.md) | All gameplay numbers and the economy simulation |
| [Architecture](docs/ARCHITECTURE.md) | Randomness, state machine, session keys, accounting |
| [Contract Spec](docs/CONTRACT_SPEC.md) | Solidity interface, events, required tests |
| [Security](docs/SECURITY.md) | Threat model and deploy checklist |
| [UI/UX](docs/UI_UX.md) | Layout, components, copy |
| [Build Plan](docs/BUILD_PLAN.md) | Phases, tasks, definition of done |
| [Demo Script](docs/DEMO_SCRIPT.md) | 3-minute pitch |

⚠️ **Testnet only.** Depths involves wagering assets. A mainnet deployment would require an audit and legal review.
