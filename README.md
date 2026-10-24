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

## Quickstart (setelah Phase 0)
```bash
pnpm install
anvil --block-time 1                      # terminal 1
cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
pnpm abi:sync && pnpm -F web dev          # http://localhost:3000
```

## Deployment
| Network | Address | Explorer |
|---|---|---|
| Monad Testnet | _TBD_ | _TBD_ |

⚠️ Testnet only. Game ini melibatkan taruhan aset. Deploy ke mainnet membutuhkan audit dan kajian legal.
