# CLAUDE.md — Depths

On-chain roguelike dungeon di Monad. Player bayar entry fee, turun lantai, dan setiap lantai memilih CASH OUT atau GO DEEPER. Mati = bag hilang ke prize pool.

## Baca dulu
Sebelum mengerjakan task, baca dokumen yang relevan di `docs/`:
- [docs/PRD.md](docs/PRD.md): scope, goals, prioritas (P0/P1/P2)
- [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md): **semua angka gameplay** (sumber kebenaran)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): randomness, state machine, session key, tx queue, akuntansi pool
- [docs/CONTRACT_SPEC.md](docs/CONTRACT_SPEC.md): fungsi, storage, event, error, test wajib
- [docs/SECURITY.md](docs/SECURITY.md): threat model dan checklist deploy
- [docs/UI_UX.md](docs/UI_UX.md): layout, komponen, microcopy
- [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md): phase, task, Definition of Done. Centang task yang selesai di file ini

## Struktur
```
contracts/            Foundry (src/Depths.sol, src/DepthsLogic.sol, src/DepthsTypes.sol)
packages/game-logic/  TS mirror DepthsLogic + simulator (tanpa dependency selain viem)
apps/web/             Next.js 15 App Router + wagmi v2 + viem + RainbowKit + Tailwind + zustand
apps/keeper/          Node bot: relay reveal/settle yang macet + reapExpired
docs/                 Dokumen produk dan teknis
```

## Perintah
```bash
pnpm install
# contracts
cd contracts && forge build
forge test -vvv                         # semua test
forge test --match-contract Invariant   # invariant solvency
forge test --gas-report
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
# lokal: WAJIB pakai block-time, karena automine tidak menghasilkan block untuk reveal
anvil --block-time 1
# TS
pnpm -F game-logic test                 # parity test vs contracts/test/vectors/*.json
pnpm -F game-logic simulate             # Monte Carlo RTP
pnpm abi:sync                           # salin ABI forge ke apps/web/abi dan apps/keeper/abi
pnpm -F web dev
pnpm -F web lint && pnpm -F web typecheck
pnpm -F keeper start
```

## Aturan keras (jangan dilanggar)
1. **Randomness:** jangan pernah menghitung hasil dari `blockhash(block.number - 1)`, `block.timestamp`, atau `prevrandao` di tx yang sama dengan keputusan player. Selalu commit `targetBlock = block.number + 1`, lalu reveal/settle di tx terpisah. Expired (> 256 blok) = **mati**, tidak ada re-roll.
2. **Uang:** pertahankan invariant `balance >= pool + reserved + treasury`. Setiap perubahan `bag` juga harus mengubah `reserved` dan `pool`. Award loot selalu `min(table, pool * MAX_AWARD_BPS / 1e4)`.
3. **Payout `cashOut` selalu ke `owner`**, tidak pernah ke `msg.sender`/operator.
4. **Tidak ada fungsi admin** yang bisa menarik `pool` atau `reserved`.
5. **CEI + `nonReentrant`** di setiap fungsi yang mengirim MON.
6. **Angka gameplay** hanya berubah lewat GAME_DESIGN.md. Ubah `DepthsLogic.sol`, `packages/game-logic`, dan regenerate vectors dalam satu perubahan, lalu jalankan parity test dan simulasi.
7. **ABI di `apps/web/abi/` di-generate.** Jangan edit manual. Jalankan `pnpm abi:sync`.
8. Jangan commit private key atau `.env`. Hanya `.env.example`.
9. Target **testnet** saja. Jangan menulis script deploy mainnet tanpa diminta eksplisit.

## Konvensi
- Solidity 0.8.28, custom errors (bukan `require` string), NatSpec di fungsi eksternal, `uint128` untuk uang dengan `SafeCast`.
- Logic gameplay di `DepthsLogic` (pure). `Depths.sol` hanya mengurus state, akses, dan uang.
- Event membawa `owner` dan `runId` (indexed). Frontend me-replay combat dari `resolveSeed`, jadi jangan emit log per round.
- TS: strict, tanpa `any`, ABI `as const` untuk typing viem. Komponen game di `apps/web/components/game/`.
- Semua tx in-run lewat `lib/txQueue.ts` (serial, nonce lokal, **gas limit eksplisit dari `lib/gas.ts`**). Monad menagih gas limit, bukan gas used.
- Jumlah MON di UI: format dengan `formatEther`, 3 desimal. Hitungan selalu dalam `bigint` wei.
- UI copy berbahasa Indonesia santai (lihat UI_UX §8). Identifier kode berbahasa Inggris.

## Monad
- Testnet chainId `10143`, RPC `https://testnet-rpc.monad.xyz`, explorer `https://testnet.monadexplorer.com`. Pakai `monadTestnet` dari `viem/chains`.
- Block ~400ms, finality ~800ms. Set `pollingInterval` viem ke 200ms untuk receipt.
- Ragu soal perilaku EVM Monad (blockhash, gas, reserve balance)? Cek `docs/SPIKE_RESULTS.md` dan https://docs.monad.xyz. Jangan berasumsi sama dengan Ethereum.

## Definition of Done per task
- Test relevan ditambahkan dan hijau (`forge test` dan/atau vitest).
- Perubahan contract: invariant test tetap hijau, gas report dicek, `pnpm abi:sync` dijalankan.
- Task di `docs/BUILD_PLAN.md` dicentang.
