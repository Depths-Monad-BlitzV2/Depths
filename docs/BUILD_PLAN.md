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

- [ ] 🔴 Storage, konstanta, constructor (`Ownable2Step`, seed pool opsional lewat `msg.value`)
- [ ] 🔴 `enterDungeon` (split fee, top-up operator, init run)
- [ ] 🔴 `_reveal` / `_settle` internal + `reveal`, `settle` fallback permissionless
- [ ] 🔴 `act` di AWAIT_REVEAL (`_reveal` dulu) dan AWAIT_ACTION (validasi aksi per encounter, BUY/LEAVE instan)
- [ ] 🔴 `descend` / `cashOut` di AWAIT_SETTLE (`_settle` dulu, mati = tidak revert) dan FLOOR_CLEARED
- [ ] 🔴 Resolusi `_settle` (potion, combat/flee/treasure/mimic/trap/disarm, award dengan cap, auto cash out di floor 20)
- [ ] 🔴 View `previewEncounter` / `previewResolve`
- [ ] 🔴 Test parity jalur normal vs fallback (CONTRACT_SPEC §9)
- [ ] 🔴 `cashOut`, `_die`, `reapExpired`
- [ ] 🔴 Admin: `seedPool`, `setEntryFee`, `withdrawTreasury`, `pause`
- [ ] 🟡 Stats dan board top-10 (insertion sort)
- [ ] 🔴 Unit test per transisi dan per error (CONTRACT_SPEC §9)
- [ ] 🔴 Invariant test solvency dengan handler
- [ ] 🔴 `forge test --gas-report` → isi CONTRACT_SPEC §8
- [ ] 🟡 Slither

**DoD:** semua test hijau, coverage `src/` ≥ 90%, invariant 256×100 lolos, gas sesuai target.

---

## Phase 3 — Deploy testnet + keeper (Hari 5 pagi)

- [ ] 🔴 `script/Deploy.s.sol`: deploy, seed pool (mis. 5–10 MON testnet), log address dan block
- [ ] 🔴 Deploy ke Monad testnet, verifikasi source di explorer (Sourcify / explorer verifier, lihat docs.monad.xyz)
- [ ] 🔴 Script `pnpm abi:sync`: salin `contracts/out/Depths.sol/Depths.json` (ABI saja) ke `apps/web/abi/` dan `apps/keeper/abi/`
- [ ] 🔴 Smoke test manual dengan `cast`: enter → act → descend → act → cashOut, plus jalur fallback reveal/settle
- [ ] 🟡 `apps/keeper`: polling event `FloorEntered` / `ActionCommitted`. Kalau belum ada `EncounterRevealed` / `FloorResolved` setelah 200 blok, kirim `reveal` / `settle` (gas worst case). Juga `reapExpired`

**DoD:** satu run penuh sukses di testnet lewat CLI. Address ada di `apps/web/.env.local` dan README.

---

## Phase 4 — Frontend fondasi (Hari 5–6)

- [ ] 🔴 `lib/chains.ts` (monadTestnet dari `viem/chains`, plus anvil), `lib/wagmi.ts` (RainbowKit, fallback transport HTTP→cadangan)
- [ ] 🔴 `lib/contracts.ts` (address + ABI typed via `as const`)
- [ ] 🔴 `lib/session.ts`: generate/simpan burner, saldo, withdraw
- [ ] 🔴 `lib/txQueue.ts`: antrian serial, nonce lokal, gas limit eksplisit, ukur latency, retry
- [ ] 🔴 `lib/runMachine.ts`: map `Run` on-chain → UI state, tunggu `> targetBlock` (`watchBlockNumber`), lalu `previewEncounter` / `previewResolve`. Fallback relay `reveal`/`settle` kalau player diam ≥ 150 blok
- [ ] 🔴 `lib/gas.ts`: gas limit per jalur dari gas report (`base + rounds × GAS_PER_ROUND`), retry worst case sekali kalau out-of-gas
- [ ] 🔴 `store/game.ts` (zustand): run, log, tx history, pool
- [ ] 🔴 Recovery saat refresh (ARCHITECTURE §6.3)
- [ ] 🔴 Halaman `/play` versi kasar (tanpa art): bisa main dari enter sampai cash out/mati

**DoD:** satu run penuh dimainkan via UI di testnet dengan **hanya 1 popup** dan 2 tx per lantai di jalur normal. Latency per tx tampil di console/ticker.

---

## Phase 5 — Game feel (Hari 7–8)

- [ ] 🔴 Audit aset: pilih pack, isi tabel UI_UX §2.6 (20 musuh + hero + prop), tulis `apps/web/public/CREDITS.md`. **Mulai Hari 1, paralel dengan Phase 0** (orang C)
- [ ] 🔴 `lib/sprites.ts`: manifest sprite sheet (frame, ukuran, fps per animasi) + mapping `monsterId` → sprite
- [ ] 🔴 `SpriteActor` + `useBattleTimeline` (tempo, skip, reduced motion)
- [ ] 🔴 `DungeonScene` battle side-view: layer, background per tier, staging 4 encounter, stance saat menunggu blok target setelah `act` (UI_UX §2.1–2.4)
- [ ] 🔴 `StatsHud`, `EncounterCard`, `MerchantPanel`, `CombatLog` (di-drive oleh timeline, bukan timer sendiri)
- [ ] 🟡 Overlay equipment hero (pedang 3 varian, perisai 2 varian)
- [ ] 🟡 Transisi lantai (jalan keluar → tangga → ruangan baru) yang menutupi latency `descend` + tunggu blok target
- [ ] 🔴 `DecisionModal` dengan hold-to-confirm dan preview lantai berikutnya
- [ ] 🔴 `DeathScreen`, layar cash out
- [ ] 🔴 `TxTicker`
- [ ] 🟡 Estimasi win chance (Monte Carlo 500× di Web Worker)
- [ ] 🟡 Landing: pool live, live feed, CTA
- [ ] 🟡 Leaderboard
- [ ] ⚪ Audio, screen shake, vignette per depth
- [ ] ⚪ `/verify/[runId]`

**DoD:** orang yang belum pernah lihat game ini bisa main tanpa dijelaskan, dan bereaksi di decision modal 😄

---

## Phase 6 — Hardening (Hari 9)

- [ ] 🔴 Checklist SECURITY §7
- [ ] 🔴 Uji edge case di testnet: refresh di tiap state, tutup tab > 2 menit (expiry), saldo burner habis, salah chain, RPC error
- [ ] 🔴 Playtest 20+ run dengan beberapa orang. Catat RTP aktual dan feedback, lalu tuning `BASE_ATK` dkk. kalau perlu (redeploy)
- [ ] 🟡 Lighthouse ≥ 90 performance di landing
- [ ] 🟡 Mobile layout

**DoD:** 0 bug P0 terbuka. 20 run playtest tanpa run "nyangkut".

---

## Phase 7 — Demo & submission (Hari 10)

- [ ] 🔴 Deploy web ke Vercel (env testnet)
- [ ] 🔴 Seed pool cukup besar supaya loot terasa (cap 5% → pool ≥ 5 MON agar loot floor 10 tidak terpotong)
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
