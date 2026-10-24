# Depths — On-Chain Roguelike Dungeon on Monad

> Bayar masuk. Makin dalam, makin kaya. Tapi kalau mati, hilang semua. Berani sampai lantai berapa?

Player bayar 1 MON, turun lantai demi lantai melawan encounter yang di-generate on-chain, lalu di setiap lantai memilih **CASH OUT** atau **GO DEEPER**. Yang mati menyumbang bag-nya ke prize pool untuk player berikutnya.

## Kenapa Monad
Satu lantai = 2 transaksi (act → descend/cashOut). Reveal dan settle berjalan di dalam tx keputusan berikutnya, dan hasil acaknya tetap dari future blockhash. 10 lantai ≈ 22 tx. Dengan latency sub-detik dan session key, semuanya terasa real-time, dan hanya ada 1 popup wallet per run.

## Dokumentasi
| Dokumen | Isi |
|---|---|
| [PRD](docs/PRD.md) | Produk, goals, scope |
| [Game Design](docs/GAME_DESIGN.md) | Mekanik dan semua angka, plus simulasi ekonomi |
| [Architecture](docs/ARCHITECTURE.md) | Randomness, state machine, session key, akuntansi |
| [Contract Spec](docs/CONTRACT_SPEC.md) | Interface Solidity, event, test |
| [Security](docs/SECURITY.md) | Threat model dan checklist |
| [UI/UX](docs/UI_UX.md) | Layout, komponen, copy |
| [Build Plan](docs/BUILD_PLAN.md) | Phase, task, DoD |
| [Demo Script](docs/DEMO_SCRIPT.md) | Pitch 3 menit |

## Quickstart lokal
```bash
pnpm install
anvil --block-time 1                      # terminal 1 (wajib block-time, lihat ARCHITECTURE §9)
cd contracts
# key default anvil #0, seed pool 80 MON; hasil di contracts/deployments/31337.json
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 SEED_POOL=80000000000000000000 \
  forge script script/Deploy.s.sol --rpc-url anvil --broadcast
cd .. && pnpm abi:sync && pnpm -F web dev # http://localhost:3000
```

## Deployment
| Network | Contract | Deploy | Explorer |
|---|---|---|---|
| Monad Testnet (10143) | `0x0970e0Ffd32a883E5E42Aa3933AE1594580a65AC` | blok 73431066, tx [`0x1cdb…7116`](https://testnet.monadexplorer.com/tx/0x1cdb9928ae6d2885830cf909013e333a946a76a4753998cab4acf84d44797116) | [MonadExplorer](https://testnet.monadexplorer.com/address/0x0970e0Ffd32a883E5E42Aa3933AE1594580a65AC) · [MonadVision (source terverifikasi)](https://testnet.monadvision.com/address/0x0970e0Ffd32a883E5E42Aa3933AE1594580a65AC) |

Owner: `0x5219fFbF9A44F96A8931A50A31021E4724518735`. Seed pool awal 80 MON. Detail: [contracts/deployments/10143.json](contracts/deployments/10143.json).

```bash
# deploy ulang (testnet saja): isi contracts/.env (PRIVATE_KEY dengan prefix 0x), lalu
cd contracts && source .env && SEED_POOL=80000000000000000000 forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
forge verify-contract <address> src/Depths.sol:Depths --chain 10143 --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/ --constructor-args $(cast abi-encode "constructor(address)" <owner>)

# smoke test CLI: run jalur normal + jalur fallback (reveal/settle), burner baru sebagai session key
RPC_URL=https://testnet-rpc.monad.xyz DEPTHS=<address> PRIVATE_KEY=0x... bash scripts/smoke.sh

# keeper: relay reveal/settle setelah 200 blok + reapExpired (isi apps/keeper/.env dari .env.example)
pnpm -F keeper start
```

⚠️ Testnet only. Game ini melibatkan taruhan aset. Deploy ke mainnet membutuhkan audit dan kajian legal.
