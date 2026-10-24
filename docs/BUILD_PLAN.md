# Build Plan — Depths

Rencana 10 hari kerja (bisa dipadatkan ke ~5 hari kalau tim 2–3 orang paralel: contract / frontend / art+demo).
Setiap phase punya **Definition of Done (DoD)**. Jangan pindah phase sebelum DoD-nya hijau.

Legenda: 🔴 P0 (wajib demo) · 🟡 P1 · ⚪ P2/stretch

---

## Phase 0 — Setup & spike Monad (Hari 1)

Tujuan: menghilangkan ketidakpastian soal chain **sebelum** logic dibangun.

- [x] 🔴 Init monorepo pnpm: `contracts/` (forge init), `apps/web` (create-next-app, TS, Tailwind, App Router), `packages/game-logic`, `apps/keeper`
- [x] 🔴 `foundry.toml`: solc 0.8.28, optimizer 200 runs, `fs_permissions` untuk `test/vectors`, rpc_endpoints `monad_testnet`
- [x] 🔴 Install OpenZeppelin contracts (`forge install OpenZeppelin/openzeppelin-contracts`)
- [x] 🔴 Dapatkan MON testnet dari faucet untuk deployer dan 2 akun test _(deployer saja; 2 akun test menyusul)_
- [x] 🔴 **Spike contract** `RngProbe.sol` (deploy `0x8c8d…226c`, hasil di SPIKE_RESULTS.md): `commit()` menyimpan `block.number+1`, `reveal()` mengembalikan `blockhash(target)`. Deploy ke testnet, jalankan 20×:
  - catat apakah `blockhash` pernah 0 di dalam window
  - catat jeda blok antar tx berurutan dari sender yang sama
  - catat latency submit→receipt (p50/p95)
  - cek `blockhash(block.number - 300)` (apakah EIP-2935 / window lebih panjang tersedia)
- [x] 🔴 Cek aturan gas Monad (charge by gas limit) dan reserve balance untuk EOA bersaldo kecil _(gas limit terkonfirmasi; reserve balance belum diukur)_
- [x] Tulis temuan di `docs/SPIKE_RESULTS.md`, lalu update ARCHITECTURE §4.4

**DoD:** spike terdeploy, hasil tercatat, keputusan "blockhash OK / perlu Pyth" sudah diambil.

---

## Phase 1 — Pure logic + test vectors (Hari 2)

- [x] 🔴 `DepthsTypes.sol`: enum, struct, event, error (sesuai CONTRACT_SPEC §2, §5, §6)
- [x] 🔴 `DepthsLogic.sol`: tabel monster 1–20, `rand`, `dmg`, `rollEncounter`, `fleeChance`, `resolveCombat`, `resolveTreasure`, `resolveTrap`
- [x] 🔴 `DepthsLogic.t.sol`: unit test setiap fungsi, termasuk batas (dmg min 1, MAX_ROUNDS, floor 20)
- [x] 🔴 `GenVectors.t.sol` → `test/vectors/{encounter,combat,trap,treasure}.json` (≥ 200 kasus total)
- [x] 🔴 `packages/game-logic`: port TS 1:1 (pakai `viem` `keccak256` + `encodeAbiParameters` supaya identik dengan Solidity)
- [x] 🔴 `parity.test.ts` (vitest): semua vector harus cocok
- [x] 🔴 `replayCombat` → `CombatEvent[]` (UI_UX §2.2), memakai RNG draw yang sama dengan `resolveCombat`. Test: hasil akhir dan HP akhir cocok dengan semua combat vector
- [x] 🟡 `simulate.ts`: port simulasi Monte Carlo, lalu jalankan 4 strategi. Pastikan RTP sesuai target GAME_DESIGN §9

**DoD:** `forge test` dan `pnpm -F game-logic test` hijau. Tabel RTP ter-update di GAME_DESIGN §9.

---

## Phase 2 — Contract Depths (Hari 3–4)

- [x] 🔴 Storage, konstanta, constructor (`Ownable2Step`, seed pool opsional lewat `msg.value`)
- [x] 🔴 `enterDungeon` (split fee, top-up operator, init run)
- [x] 🔴 `_reveal` / `_settle` internal + `reveal`, `settle` fallback permissionless
- [x] 🔴 `act` di AWAIT_REVEAL (`_reveal` dulu) dan AWAIT_ACTION (validasi aksi per encounter, BUY/LEAVE instan)
- [x] 🔴 `descend` / `cashOut` di AWAIT_SETTLE (`_settle` dulu, mati = tidak revert) dan FLOOR_CLEARED
- [x] 🔴 Resolusi `_settle` (potion, combat/flee/treasure/mimic/trap/disarm, award dengan cap, auto cash out di floor 20)
- [x] 🔴 View `previewEncounter` / `previewResolve`
- [x] 🔴 Test parity jalur normal vs fallback (CONTRACT_SPEC §9) _(`test_parity_*`: event, saldo, state run, stats, board identik)_
- [x] 🔴 `cashOut`, `_die`, `reapExpired`
- [x] 🔴 Admin: `seedPool`, `setEntryFee`, `withdrawTreasury`, `pause`
- [x] 🟡 Stats dan board top-10 (insertion sort)
- [x] 🔴 Unit test per transisi dan per error (CONTRACT_SPEC §9) _(`test/Depths.t.sol`, 96 test termasuk 2 fuzz)_
- [x] 🔴 Invariant test solvency dengan handler _(5 invariant, 256 × 100; `test_handlerReachesDeepFloors` menjaga handler tidak no-op)_
- [x] 🔴 `forge test --gas-report` → isi CONTRACT_SPEC §8 _(per jalur via `test/DepthsGas.t.sol --isolate --network monad`)_
- [x] 🟡 Slither _(0 temuan setelah auto cash out floor 20 dipindah keluar `_settle`)_

**DoD:** semua test hijau, coverage `src/` ≥ 90%, invariant 256×100 lolos, gas sesuai target.

_Status 2026-10-23:_ 130 test forge + 550 parity TS hijau. Coverage `Depths.sol` 99.7% line / 100% branch, `DepthsLogic.sol` 100%, total `src/` 96.1% (termasuk spike `RngProbe`). Gas jalur normal di bawah target (jadwal Monad). Tiga deviasi tercatat di CONTRACT_SPEC §8: `enterDungeon` pertama kali per player 203k (akun burner baru + slot baru), `descend` di FLOOR_CLEARED 45k (target 35k, jalur fallback saja), dan `cashOut` yang masuk board (175k–320k, frontend memakai `eth_estimateGas`). Angka final dikalibrasi dengan `cast estimate` di Phase 3.

---

## Phase 3 — Deploy testnet + keeper (Hari 5 pagi)

- [x] 🔴 `script/Deploy.s.sol`: deploy, seed pool (target ≥ 80 MON testnet, lihat Phase 7), log address dan block _(hanya chain 10143/31337; hasil ke `contracts/deployments/<chainId>.json`)_
- [x] 🔴 Deploy ke Monad testnet, verifikasi source di explorer (Sourcify / explorer verifier, lihat docs.monad.xyz) _(`0x0970…65AC`, blok 73431066, seed 80 MON; Sourcify MonadVision: creation + runtime `match`)_
- [x] 🔴 Script `pnpm abi:sync`: salin `contracts/out/Depths.sol/Depths.json` (ABI saja) ke `apps/web/abi/` dan `apps/keeper/abi/` _(sudah ada sejak Phase 0)_
- [x] 🔴 Smoke test manual dengan `cast`: enter → act → descend → act → cashOut, plus jalur fallback reveal/settle _(`scripts/smoke.sh`, lolos di anvil dan testnet)_
- [x] 🟡 `apps/keeper`: polling event `FloorEntered` / `ActionCommitted`. Kalau belum ada `EncounterRevealed` / `FloorResolved` setelah 200 blok, kirim `reveal` / `settle` (gas worst case). Juga `reapExpired` _(gas = estimate + 30%, dibatasi worst case; reveal + settle teruji di testnet, reap di anvil)_

**DoD:** satu run penuh sukses di testnet lewat CLI. Address ada di `apps/web/.env.local` dan README.

_Status 2026-10-23:_ DoD terpenuhi. Smoke test testnet: run 1 (jalur normal, floor 1 merchant → floor 2 FIGHT WIN → cashOut 0.3 MON ke owner), run 2 (reveal → act → settle fallback → cashOut 0.2 MON), plus run yang ditinggal dan di-relay keeper (reveal 207 blok setelah target, lalu settle). Solvency on-chain setelahnya: saldo 83.3 MON = pool 83.1 + reserved 0 + treasury 0.2. Gas estimate testnet selisih ≤ 1.5% dari simulasi (CONTRACT_SPEC §8). Address di `apps/web/.env.local`, `apps/web/.env.example`, dan README.

---

## Phase 4 — Frontend fondasi (Hari 5–6)

- [x] 🔴 `lib/chains.ts` (monadTestnet dari `viem/chains`, plus anvil), `lib/wagmi.ts` (RainbowKit, fallback transport HTTP→cadangan) _(fallback: env → testnet-rpc.monad.xyz → ankr → drpc; tanpa `NEXT_PUBLIC_WC_PROJECT_ID` hanya wallet injected)_
- [x] 🔴 `lib/contracts.ts` (address + ABI typed via `as const`)
- [x] 🔴 `lib/session.ts`: generate/simpan burner, saldo, withdraw
- [x] 🔴 `lib/txQueue.ts`: antrian serial, nonce lokal, gas limit eksplisit, ukur latency, retry _(tx ditandatangani sekali, retry jaringan mengirim raw tx yang sama)_
- [x] 🔴 `lib/runMachine.ts`: map `Run` on-chain → UI state, tunggu `> targetBlock` (`watchBlockNumber`), lalu `previewEncounter` / `previewResolve`. Fallback relay `reveal`/`settle` kalau player diam ≥ 150 blok _(plus auto-`settle` saat preview = mati, supaya run tertutup)_
- [x] 🔴 `lib/gas.ts`: gas limit per jalur dari gas report (`base + rounds × GAS_PER_ROUND`), retry worst case sekali kalau out-of-gas _(cashOut dan kematian pakai `eth_estimateGas` karena biaya board)_
- [x] 🔴 `store/game.ts` (zustand): run, log, tx history, pool
- [x] 🔴 Recovery saat refresh (ARCHITECTURE §6.3) _(state selalu dibaca ulang dari chain saat load; relay langsung terkirim kalau sudah ≥ 150 blok)_
- [x] 🔴 Halaman `/play` versi kasar (tanpa art): bisa main dari enter sampai cash out/mati

**DoD:** satu run penuh dimainkan via UI di testnet dengan **hanya 1 popup** dan 2 tx per lantai di jalur normal. Latency per tx tampil di console/ticker.

_Status 2026-10-23:_ `pnpm -F web test` (19), typecheck, lint, dan `next build` hijau. E2E headless (`pnpm -F web e2e`, memakai `lib/*` yang sama dengan `/play`): anvil 4 lantai dan **testnet 3 lantai → cash out 0.9 MON, owner 1 tx, session 2 tx per lantai, latency p50 1124ms / p95 1357ms**. Playtest manual `/play` di browser (MetaMask, testnet): run penuh sampai mati / cash out dengan 1 popup (`enterDungeon`), latency per tx tampil di console (`[depths tx]`) dan ticker, relay `reveal` otomatis terverifikasi on-chain (154 blok setelah target). **DoD terpenuhi.**

---

## Phase 5 — Game feel (Hari 7–8)

- [x] 🔴 Audit aset: pilih pack, isi tabel UI_UX §2.6 (20 musuh + hero + prop), tulis `apps/web/public/CREDITS.md`. **Mulai Hari 1, paralel dengan Phase 0** (orang C) _(0x72 DungeonTileset II v1.7, CC0; 6 nama monster diganti lewat GAME_DESIGN §4.1)_
- [x] 🔴 `lib/sprites.ts`: manifest sprite sheet (frame, ukuran, fps per animasi) + mapping `monsterId` → sprite
- [x] 🔴 `SpriteActor` + `useBattleTimeline` (tempo, skip, reduced motion) _(timeline dari `lib/scene.ts`)_
- [x] 🔴 `DungeonScene` battle side-view: layer, background per tier, staging 4 encounter, stance saat menunggu blok target setelah `act` (UI_UX §2.1–2.4)
- [x] 🔴 `StatsHud`, `EncounterCard`, `MerchantPanel`, `CombatLog` (di-drive oleh timeline, bukan timer sendiri)
- [x] 🟡 Overlay equipment hero (pedang 3 varian, perisai 2 varian) _(pedang 3 varian; perisai tidak ada di pack → badge di HUD, fallback §2.5)_
- [x] 🟡 Transisi lantai (jalan keluar → tangga → ruangan baru) yang menutupi latency `descend` + tunggu blok target
- [x] 🔴 `DecisionModal` dengan hold-to-confirm dan preview lantai berikutnya
- [x] 🔴 `DeathScreen`, layar cash out
- [x] 🔴 `TxTicker`
- [x] 🟡 Estimasi win chance (Monte Carlo 500× di Web Worker)
- [x] 🟡 Landing: pool live, live feed, CTA
- [x] 🟡 Leaderboard _(Hall of the Fallen dari event RunDied ±2000 blok terakhir; tidak ada board on-chain untuk itu)_
- [ ] ⚪ Audio, screen shake, vignette per depth _(shake + vignette + tint merah per kedalaman sudah; audio ditunda, cut line)_
- [ ] ⚪ `/verify/[runId]`

**DoD:** orang yang belum pernah lihat game ini bisa main tanpa dijelaskan, dan bereaksi di decision modal 😄

_Status 2026-10-23:_ semua item 🔴 dan 🟡 selesai. `pnpm -F web test` (31), typecheck, lint, `next build` hijau. QA visual lewat `/dev/scene` (development saja) + screenshot headless: 4 tier, boss, merchant, decision modal, landing dan leaderboard dengan data testnet. Playtest oleh orang yang belum pernah melihat game: bisa main tanpa dijelaskan, tanpa bug ditemukan. **DoD terpenuhi.**

---

## Phase 6 — Hardening (Hari 9)

- [x] 🔴 Checklist SECURITY §7 _(diverifikasi ulang pada kode ter-deploy; owner tetap deployer, tidak relevan untuk testnet)_
- [x] 🔴 Uji edge case di testnet: refresh di tiap state, tutup tab > 2 menit (expiry), saldo burner habis, salah chain, RPC error _(`pnpm -F web edge`: refresh/expiry/burner/rpc OK; salah chain di checklist manual docs/PLAYTEST.md §4; 1 bug P0 + 3 P1 ditemukan dan diperbaiki)_
- [ ] 🔴 Playtest 20+ run dengan beberapa orang. Catat RTP aktual dan feedback, lalu tuning `BASE_ATK` dkk. kalau perlu (redeploy) _(bot: 23 run, 0 nyangkut, RTP 90.3%; tanpa tuning sesuai keputusan PO. Menunggu playtest manusia, docs/PLAYTEST.md)_
- [x] 🟡 Lighthouse ≥ 90 performance di landing _(92–97; accessibility dan best practices 100)_
- [x] 🟡 Mobile layout _(overlay modal layar penuh di ponsel, tanpa overflow horizontal di 390 px)_

**DoD:** 0 bug P0 terbuka. 20 run playtest tanpa run "nyangkut".

---

## Phase 7 — Demo & submission (Hari 10)

- [ ] 🔴 Deploy web ke Vercel (env testnet)
- [ ] 🔴 Seed pool cukup besar supaya loot terasa (cap 5% → pool ≥ 80 MON agar loot floor 10 = 4 MON tidak terpotong; pool ≥ 20 MON cukup untuk floor 1–5). Kumpulkan MON faucet dari beberapa wallet kalau perlu
- [ ] 🔴 Siapkan 2 wallet demo bersaldo + burner yang sudah ter-top-up
- [ ] 🔴 Latihan [DEMO_SCRIPT.md](DEMO_SCRIPT.md) minimal 3×, plus rekam video backup
- [ ] 🔴 README: deskripsi, arsitektur, address contract, link explorer, cara run lokal
- [ ] ⚪ Shareable death card (OG image)

**DoD:** link live + video + repo publik siap dikirim.

---

## Cut line (kalau waktu mepet)

Urutan yang dipotong lebih dulu: audio → `/verify` → leaderboard → keeper bot (andalkan fallback relay frontend) → estimasi win chance → board on-chain.
**Jangan dipotong:** session key, lazy reveal/settle + fallback relay frontend, decision modal, TxTicker, invariant test.

## Pembagian kerja (tim 3)

| Orang | Fokus |
|---|---|
| A — Contract | Phase 0, 1 (Solidity), 2, 3 |
| B — Frontend | Phase 1 (TS mirror), 4, 5 (logic UI) |
| C — Art/UX/Demo | Audit aset (mulai Hari 1), `lib/sprites.ts`, `DungeonScene`, `SpriteActor`, audio, landing, demo script, video |
