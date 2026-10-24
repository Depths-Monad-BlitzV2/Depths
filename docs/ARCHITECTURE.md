# Architecture — Depths

## 1. Gambaran sistem

```
┌──────────────────────── Browser (Next.js) ────────────────────────┐
│                                                                    │
│  Main wallet (MetaMask/Rabby)        Session wallet (burner)       │
│  - enterDungeon() + top-up gas       - act / descend / cashOut     │
│  - cashOut() (opsional)              - reveal / settle (fallback)  │
│        │                                   │                       │
│        └───────────── viem / wagmi ────────┘                       │
│                        │                                           │
│  Game store (zustand) ◄── event watcher + getRun() polling         │
│  game-logic (TS mirror) → replay combat, estimasi win chance       │
└────────────────────────┬───────────────────────────────────────────┘
                         │ JSON-RPC (HTTP + WS)
                ┌────────▼────────┐          ┌──────────────────┐
                │  Monad (EVM)    │◄─────────│  Keeper bot      │
                │  Depths.sol     │ reveal/  │  (Node, viem)    │
                │  DepthsLogic.sol│ settle   │  fallback relay  │
                └─────────────────┘          └──────────────────┘
```

**Prinsip utama:**
1. **Contract adalah sumber kebenaran.** Semua state run, uang, dan hasil ditentukan on-chain. Frontend cuma menampilkan dan menganimasikan.
2. **Satu popup per run.** Main wallet hanya menandatangani `enterDungeon` (beserta top-up gas untuk session wallet). Semua aksi lain ditandatangani session wallet.
3. **Payout tidak pernah ke session wallet.** `cashOut` boleh dipanggil operator, tapi MON selalu dikirim ke `owner`.
4. **Logic murni dipisah.** `DepthsLogic.sol` berisi fungsi `pure` (encounter, stats, combat). Fungsi yang sama di-mirror di TypeScript (`packages/game-logic`) dan diverifikasi dengan test vectors.

## 2. Tech stack

| Layer | Pilihan | Alasan |
|---|---|---|
| Contract | Solidity `0.8.28`, Foundry (forge, anvil, cast) | Cepat, fuzz/invariant test bawaan |
| Lib contract | OpenZeppelin `ReentrancyGuard`, `Ownable2Step`, `Pausable` | Standar, sudah diaudit |
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript strict | SSR untuk landing, mudah deploy ke Vercel |
| Web3 | wagmi v2 + viem v2 + RainbowKit | `monadTestnet` sudah ada di `viem/chains` |
| State | zustand (game store) + TanStack Query (bawaan wagmi) | Sederhana dan reaktif |
| Styling | Tailwind CSS v4 + Framer Motion | Animasi combat dan transisi lantai |
| Audio | howler.js | Heartbeat, hit, death sting |
| Shared logic | `packages/game-logic` (TS murni, tanpa dependency) | Replay dan estimasi, di-share web dan keeper |
| Keeper | Node 22 + viem (`apps/keeper`) | Fallback relay reveal/settle |
| Test | forge test (unit, fuzz, invariant), vitest (TS), Playwright (e2e, opsional) | |
| Monorepo | pnpm workspaces | |

## 3. Struktur repo

```
/
├── CLAUDE.md
├── README.md
├── docs/                      # PRD, desain, spec (dokumen ini)
├── contracts/                 # Foundry project
│   ├── foundry.toml
│   ├── src/
│   │   ├── Depths.sol         # state machine, uang, akses
│   │   ├── DepthsLogic.sol    # library pure: tabel, encounter, combat
│   │   ├── DepthsTypes.sol    # struct, enum, event, error
│   │   └── interfaces/IDepths.sol
│   ├── test/
│   │   ├── Depths.t.sol       # unit test per state transition
│   │   ├── DepthsLogic.t.sol  # unit test pure logic
│   │   ├── invariant/         # Handler + invariant solvency
│   │   └── vectors/GenVectors.t.sol  # generate test-vectors.json
│   └── script/
│       ├── Deploy.s.sol
│       └── SeedPool.s.sol
├── packages/
│   └── game-logic/            # TS mirror DepthsLogic + simulator
│       ├── src/{tables,encounter,combat,rng,simulate}.ts
│       └── test/parity.test.ts   # membaca contracts/test/vectors/*.json
├── apps/
│   ├── web/                   # Next.js
│   │   ├── app/(landing)/page.tsx, app/play/page.tsx, app/leaderboard/page.tsx, app/verify/[runId]/page.tsx
│   │   ├── components/game/*, components/ui/*
│   │   ├── lib/{chains,wagmi,contracts,session,txQueue,runMachine}.ts
│   │   └── abi/Depths.json    # di-generate dari forge (jangan edit manual)
│   └── keeper/                # bot fallback
└── pnpm-workspace.yaml
```

## 4. Randomness

### 4.1 Masalah
Spec awal: "generate dari blockhash". Kalau encounter dihitung dari `blockhash(block.number - 1)` di tx yang sama dengan aksi player, player (atau contract penyerang) bisa **mensimulasikan hasil dulu**, lalu hanya mengirim tx kalau hasilnya bagus (atau revert kalau jelek). Jadi randomness harus berasal dari block yang **belum ada** waktu player meng-commit keputusannya.

### 4.2 Solusi: commit → future blockhash → reveal
Setiap langkah yang butuh randomness dipecah jadi dua:

1. **Commit**: player mengirim keputusan (mis. `descend()` atau `act(FIGHT)`). Contract menyimpan `targetBlock = block.number + 1`, yaitu block yang **belum ada** saat keputusan dibuat.
2. **Reveal/Settle**: dijalankan di tx berikutnya, yang hanya valid kalau `block.number > targetBlock` (supaya `blockhash(targetBlock)` sudah tersedia). Contract lalu menghitung seed:

```
seed = keccak256(abi.encode(blockhash(targetBlock), owner, runId, floor, PURPOSE))
PURPOSE ∈ { ENCOUNTER = 1, RESOLVE = 2 }
```

**Aturan expiry (anti-stall):** `blockhash` hanya tersedia untuk 256 block terakhir (~100 detik di Monad). Kalau reveal/settle tidak dipanggil sebelum `targetBlock + 256`, run **otomatis dianggap mati** saat disentuh berikutnya (oleh siapa saja). Tidak ada re-roll, karena re-roll memberi player cara menolak hasil buruk yang sudah dia lihat off-chain.

### 4.2.1 Lazy reveal/settle + fallback relay (keputusan pasca-spike, 2026-10-22)

Spike menunjukkan Monad menagih **gas limit penuh** di ±102 gwei (SPIKE_RESULTS.md), jadi tx relay terpisah itu mahal. Reveal dan settle **tidak lagi punya tx sendiri di jalur normal**. Keduanya dijalankan secara internal oleh tx keputusan berikutnya:

| Tx keputusan | Menjalankan dulu | Lalu |
|---|---|---|
| `act(...)` di `AWAIT_REVEAL` | `_reveal` (encounter lantai ini) | commit aksi (atau BUY/LEAVE instan) |
| `descend()` di `AWAIT_SETTLE` | `_settle` (hasil aksi lantai ini) | commit lantai berikutnya |
| `cashOut()` di `AWAIT_SETTLE` | `_settle` | transfer bag ke owner |

Di antara dua tx itu, encounter dan hasil **sudah pasti** karena `blockhash(targetBlock)` sudah publik. Frontend menampilkannya lewat view `previewEncounter` / `previewResolve` (eth_call) sebelum player memutuskan lagi.

**Kenapa tetap aman:**
- Setiap keputusan tetap di-commit **sebelum** blockhash penentunya ada (aturan keras #1 tidak berubah).
- Melihat hasil lebih awal tidak memberi keuntungan. Pilihan sudah ter-commit, dan tidak mengirim tx berikutnya tidak menghindarkan hasil. Relay cadangan akan menguncinya, atau run expired = **mati**.
- Kalau `_settle` di dalam `descend`/`cashOut` menghasilkan kematian, tx **tidak revert**. Kematian dicatat (`RunDied`) dan langkah lanjutannya dilewati.

**Fallback relay (supaya player tetap boleh berpikir lama):** `reveal(owner)` dan `settle(owner)` tetap ada sebagai fungsi permissionless. Kalau tx keputusan belum masuk:
- **≥ 150 blok** setelah `targetBlock`: frontend mengirim `reveal`/`settle` dari session wallet.
- **≥ 200 blok**: keeper mengirimnya (untuk tab yang ditutup).

Setelah ter-relay, hasil tersimpan dan state berpindah ke `AWAIT_ACTION` / `FLOOR_CLEARED`, yang tidak punya expiry. Jadi player bisa diam di modal CASH OUT / GO DEEPER selama apa pun.

**Konsekuensi:** pool, leaderboard, dan stats baru ter-update saat resolusi benar-benar dijalankan (tx berikutnya atau relay). Run yang mati tapi belum di-settle tetap tercatat di `reserved` sampai di-settle/di-reap, jadi invariant solvency tetap berlaku.

Opsi P2: memperpanjang window via history contract EIP-2935 (ada di Monad testnet, tapi belum diuji untuk dibaca dari contract).

### 4.3 Abstraksi provider
Hitung seed lewat satu fungsi internal `_seed(targetBlock, purpose)` supaya nanti bisa diganti ke **Pyth Entropy** (callback-based) tanpa merombak state machine. Untuk Pyth, `AWAIT_REVEAL`/`AWAIT_SETTLE` diselesaikan oleh callback `entropyCallback`, bukan oleh tx relay.

### 4.4 Yang harus diverifikasi di Phase 0 (spike)
- [x] `blockhash(n)` mengembalikan nilai non-zero untuk `n` di rentang `[block.number-256, block.number-1]` di Monad testnet. **Ya**, 0/20 bernilai 0.
- [x] Perilaku `block.number` dengan execution asinkron Monad: tx berurutan dari sender yang sama **bisa masuk block yang sama** (18/20), jadi guard `TooEarly` wajib dan frontend harus menunggu blok target.
- [x] EIP-2935 tersedia (history contract ada), tapi opcode `BLOCKHASH` tetap 256 blok. Expiry tetap 256. Perpanjangan via history contract = P2.
- [x] `block.prevrandao` unik per blok, tapi **tetap tidak dipakai**.

Detail dan angka: [SPIKE_RESULTS.md](SPIKE_RESULTS.md). Keputusan: **blockhash cukup, tidak perlu Pyth.** Catatan penting: Monad menagih gas limit penuh (termasuk tx revert) di 102 gwei. Dengan desain awal 4 tx per lantai, biayanya ±0.034 MON per lantai, dan itu alasan pindah ke lazy reveal/settle (§4.2.1).

## 5. State machine run

```
Jalur normal (2 tx per lantai)
  NONE ─enterDungeon─► AWAIT_REVEAL ─act [_reveal dulu]─► AWAIT_SETTLE ─descend [_settle dulu]─► AWAIT_REVEAL (floor+1)
                                                                       └─cashOut [_settle dulu]─► NONE

Jalur fallback (tx keputusan belum masuk ≥ 150 blok)
  AWAIT_REVEAL ─reveal─► AWAIT_ACTION ─act─► AWAIT_SETTLE
  AWAIT_SETTLE ─settle─► FLOOR_CLEARED ─descend─► AWAIT_REVEAL (floor+1)
                                       └─cashOut─► NONE

Instan: act(BUY / LEAVE) ─► FLOOR_CLEARED
Mati atau expired di state mana pun ─► NONE
```

| State | Siapa yang memanggil | Transisi |
|---|---|---|
| `NONE` | owner | `enterDungeon(operator)` → `AWAIT_REVEAL` (floor 1) |
| `AWAIT_REVEAL` | owner/operator | **`act(...)`**: `_reveal` lalu commit aksi → `AWAIT_SETTLE` (atau `FLOOR_CLEARED` untuk BUY/LEAVE). Expired → DEAD |
| `AWAIT_REVEAL` | siapa saja (fallback) | `reveal(owner)` → `AWAIT_ACTION` (encounter disimpan). Expired → DEAD |
| `AWAIT_ACTION` | owner/operator | `act(...)` → `AWAIT_SETTLE`, atau `FLOOR_CLEARED` untuk BUY/LEAVE |
| `AWAIT_SETTLE` | owner/operator | **`descend()`**: `_settle` lalu floor+1 → `AWAIT_REVEAL`. **`cashOut()`**: `_settle` lalu transfer → NONE. Kalau `_settle` = mati → NONE (tx tidak revert). Expired → DEAD |
| `AWAIT_SETTLE` | siapa saja (fallback) | `settle(owner)` → `FLOOR_CLEARED` atau DEAD |
| `FLOOR_CLEARED` | owner/operator | `descend()` → `AWAIT_REVEAL` (floor+1) · `cashOut()` → NONE |

`AWAIT_ACTION` dan `FLOOR_CLEARED` **tidak** punya expiry karena hasilnya sudah tersimpan. `AWAIT_REVEAL` dan `AWAIT_SETTLE` punya expiry 256 blok, dan fallback relay (§4.2.1) memindahkan run keluar dari state itu sebelum expiry.

Di lantai 20 (`MAX_FLOOR`), `descend` tidak valid. Kalau hidup, `_settle` lewat jalur mana pun langsung melakukan cash out otomatis.

## 6. Alur transaksi per lantai

| # | Tx | Signer | Popup? | Pemicu |
|---|---|---|---|---|
| 1 | `act(action, buy, usePotion)` | session | ❌ | klik aksi (encounter sudah tampil dari `previewEncounter`) |
| 2 | `descend()` atau `cashOut()` | session | ❌ | klik GO DEEPER / CASH OUT (hasil sudah tampil dari `previewResolve`) |
| – | `reveal(owner)` / `settle(owner)` | session, lalu keeper | ❌ | **fallback saja**: tx keputusan belum masuk setelah 150 blok (frontend) / 200 blok (keeper) |

10 lantai ≈ 20 tx + `enterDungeon` + `cashOut`, semuanya terlihat di TX ticker.

Alur satu lantai di frontend:
1. Receipt `descend` masuk → tunggu `block.number > targetBlock` → `previewEncounter(owner)` → render encounter.
2. Player klik aksi → kirim `act` → receipt → tunggu blok target → `previewResolve(owner)` → putar timeline combat (`replayCombat`) dan tampilkan decision modal.
3. Player klik GO DEEPER / CASH OUT → kirim `descend` / `cashOut`, yang sekaligus menjalankan settle on-chain.

### 6.1 Tx queue di frontend (`lib/txQueue.ts`)
- Satu antrian serial per session wallet. Nonce dikelola lokal, lalu `getTransactionCount('pending')` dipakai saat init dan saat recovery.
- Kirim dengan `gas` eksplisit dari `lib/gas.ts`. **Monad menagih gas limit, bukan gas used, termasuk tx yang revert.** Karena hasil sudah pasti sebelum tx dikirim, limit dihitung **per jalur**: `base[jalur] + rounds × GAS_PER_ROUND` (rounds dari `replayCombat`) + margin, dengan angka dari `forge test --gas-report`. Jangan pakai satu limit worst case (64 round) untuk semua tx.
- Tunggu receipt dengan `pollingInterval: 200`. Pakai WebSocket transport kalau tersedia.
- `act` di `AWAIT_REVEAL` dan `descend`/`cashOut` di `AWAIT_SETTLE` hanya valid kalau `block.number > targetBlock`. Frontend wajib menunggu (`watchBlockNumber`), karena spike menunjukkan tx back-to-back masuk blok yang sama dan revert `TooEarly`, dan tx revert tetap dibayar penuh.
- Retry 3× dengan backoff 300ms untuk error jaringan. Untuk revert, jangan retry. Re-sync dari `getRun()`.

### 6.2 Session key
1. Saat pertama kali bermain, frontend membuat private key random (`generatePrivateKey`) dan menyimpannya di `localStorage` (`depths.session.<owner>`).
2. `enterDungeon(operator)` dipanggil dengan `msg.value = entryFee + gasTopUp`. Contract meneruskan `gasTopUp` ke operator (dibatasi `MAX_GAS_TOPUP`).
3. Operator hanya bisa memanggil fungsi run milik owner yang mendaftarkannya. Run lain tidak bisa.
4. Tombol "Withdraw session balance" mengirim sisa saldo burner ke owner.
5. Top-up default **0.25 MON** (±14 lantai: gas report Phase 2 memberi ±152k gas ≈ 0.0155 MON per lantai di 102 gwei dengan margin 20%, lihat CONTRACT_SPEC §8 dan SPIKE_RESULTS). Kalau saldo burner di bawah biaya 2 lantai (±0.05 MON), tampilkan prompt top-up (popup main wallet).

> Aturan *reserve balance* Monad untuk EOA bersaldo kecil belum diukur di spike Phase 0. Ukur di Phase 4 saat burner mendekati 0, lalu sesuaikan ambang.

### 6.3 Recovery
Saat load `/play`: `getRun(owner)` → map state ke UI:
- `AWAIT_REVEAL` → render encounter dari `previewEncounter`. `AWAIT_SETTLE` → render hasil dari `previewResolve` dan modal keputusan. Kalau sudah ≥ 150 blok sejak `targetBlock`, langsung kirim `reveal`/`settle` (fallback). Kalau lewat window, tampilkan "expired, run lost".
- `AWAIT_ACTION` → render encounter dari data on-chain.
- `FLOOR_CLEARED` → tampilkan modal keputusan.

## 7. Prize pool & akuntansi

Tiga bucket di contract:

| Bucket | Isi |
|---|---|
| `pool` | Dana bebas untuk loot |
| `reserved` | Jumlah semua `bag` run yang sedang aktif (dana milik player yang masih hidup) |
| `treasury` | Rake yang bisa ditarik owner |

**Invariant:** `address(this).balance >= pool + reserved + treasury` (sama persis kalau tidak ada transfer paksa).

| Event | Perubahan |
|---|---|
| Entry | `treasury += fee*rakeBps`, `pool += sisanya` |
| Loot award | `amt = min(tabel, pool * MAX_AWARD_BPS / 1e4)`, `pool -= amt`, `bag += amt`, `reserved += amt` |
| Beli item / trap mengambil loot | `bag -= x`, `reserved -= x`, `pool += x` |
| Mati | `pool += bag`, `reserved -= bag` |
| Cash out | `reserved -= bag`, transfer `bag` ke owner |
| `seedPool()` | `pool += msg.value` (siapa saja boleh menyumbang) |

Cap `MAX_AWARD_BPS = 500` (5% dari pool per award) membuat pool **secara matematis tidak pernah habis**, dan loot otomatis mengecil kalau pool tipis, sehingga ekonomi menyeimbangkan dirinya sendiri.

## 8. Leaderboard & data

Supaya tidak bergantung pada indexer waktu hackathon:
- Contract menyimpan `stats[player]` (bestFloor, totalCashedOut, totalLost, runs) dan array `topCashouts[10]` serta `topDepths[10]` yang di-update dengan insertion sort (maksimal 10 elemen, murah).
- Live feed: `watchContractEvent` dari block terbaru saja (tanpa backfill besar). RPC publik membatasi range `eth_getLogs`.
- Stretch: indexer (Envio HyperIndex mendukung Monad) untuk histori penuh.

## 9. Lingkungan

| Env | Chain | Catatan |
|---|---|---|
| local | anvil `--block-time 1` | **Wajib pakai block-time.** Dengan automine, block baru hanya muncul saat ada tx, sehingga `act`/`descend` setelah commit akan revert `TooEarly` |
| testnet | Monad Testnet, chainId `10143` | RPC `https://testnet-rpc.monad.xyz`, explorer `https://testnet.monadexplorer.com`, faucet `https://faucet.monad.xyz` |
| mainnet | Monad, chainId `143` | Jangan deploy sebelum ada kajian legal (lihat PRD §11) |

> Cek ulang semua URL/chainId di https://docs.monad.xyz sebelum deploy, karena endpoint bisa berubah.

## 10. Konfigurasi (env vars)

```
# contracts/.env
PRIVATE_KEY=0x...            # deployer (JANGAN commit)
MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz

# apps/web/.env.local
NEXT_PUBLIC_CHAIN=monadTestnet           # atau "anvil"
NEXT_PUBLIC_DEPTHS_ADDRESS=0x...
NEXT_PUBLIC_DEPLOY_BLOCK=123456
NEXT_PUBLIC_RPC_HTTP=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_RPC_WS=                      # opsional
NEXT_PUBLIC_WC_PROJECT_ID=...            # WalletConnect (RainbowKit)

# apps/keeper/.env
KEEPER_PRIVATE_KEY=0x...
DEPTHS_ADDRESS=0x...
RPC_HTTP=...
```
