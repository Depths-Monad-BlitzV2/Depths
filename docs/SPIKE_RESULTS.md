# Spike Results — Monad Testnet

Status: **selesai (2026-10-22).** `RngProbe` di Monad testnet: [`0x8c8d64641e33c126c84b2D628F7b02A62f5D226c`](https://testnet.monadexplorer.com/address/0x8c8d64641e33c126c84b2D628F7b02A62f5D226c), deploy tx [`0x2592…e07b`](https://testnet.monadexplorer.com/tx/0x2592849ebfe6bb9de561b343804dc6161a61c864e187110ed9944f15d100e07b) (blok 73115419).

## Cara menjalankan

```bash
# 1. Siapkan contracts/.env dari .env.example (PRIVATE_KEY deployer, bersaldo MON dari https://faucet.monad.xyz)
cd contracts
source .env
forge script script/RngProbe.s.sol --rpc-url monad_testnet --broadcast
#    → catat alamat "RngProbe: 0x..."

# 2. Jalankan pengukuran (20 iterasi commit → reveal, ±40–60 tx, biaya kecil)
cd ..
SPIKE_PRIVATE_KEY=$PRIVATE_KEY PROBE_ADDRESS=0x... ITER=20 pnpm spike:rng > spike.md
```

Tempel isi `spike.md` ke bagian **Hasil** di bawah, lalu isi **Keputusan**.

## Yang diukur runner (`scripts/spike-rng.mjs`)

| Pertanyaan (ARCHITECTURE §4.4) | Cara |
|---|---|
| `blockhash(target)` pernah 0 di dalam window? | `RngProbe.reveal()` emit `targetHash` |
| Tx berurutan dari sender yang sama bisa masuk blok yang sama? | `commit` dan `reveal` dikirim back-to-back tanpa menunggu receipt |
| Latency submit → receipt (p50/p95) | `performance.now()` per tx, polling 200ms |
| Window blockhash > 256 / EIP-2935 tersedia? | `blockhash(n-256)`, `blockhash(n-300)`, `peek()` sampai -8191, `getCode` history contract 0x0000F908…2935 |
| `prevrandao` | Dicatat di event (hanya observasi, **jangan dipakai** untuk RNG) |
| Monad menagih gas limit? | Saldo terpakai dibandingkan Σ gasUsed × price (gas limit commit 60k, reveal 80k) |

## Baseline anvil (2026-10-22, untuk pembanding)

- Commit & reveal back-to-back masuk blok yang sama, reveal revert `TooEarly`. Guard bekerja, dan frontend wajib menunggu `block.number > targetBlock`.
- `blockhash(target)` tidak pernah 0. EIP-2935 tersedia (anvil hardfork Prague).
- Biaya = gasUsed × price (perilaku EVM standar).

## Hasil

### Ringkasan

| Pertanyaan | Temuan | Dampak |
|---|---|---|
| `blockhash(target)` pernah 0? | **Tidak**, 0/20 | blockhash cukup, Pyth tidak diperlukan |
| Window blockhash | Di dalam tx: `blockhash(n-256)` ok, `n-300` = 0. Via `eth_call`: -255 ok, -256 = 0 | Window standar 256 blok, `BLOCKHASH_WINDOW = 256` tetap |
| EIP-2935 | History contract **ada** (`0x0000F908…2935`), tapi opcode `BLOCKHASH` tetap 256 blok | Opsi P2: perpanjang expiry dengan membaca history contract |
| Tx berurutan dari sender yang sama | 18/20 commit + reveal back-to-back masuk **blok yang sama** dan reveal revert `TooEarly` | Guard bekerja. Frontend **wajib** menunggu `block.number > targetBlock` sebelum reveal/settle |
| Latency submit → receipt | p50 **932 ms**, p95 **1403 ms** | Desain awal 4 tx per lantai ±4–5 detik; desain 2 tx (§Keputusan) ±2 detik. Animasi transisi lantai menutupi tunggu blok (UI_UX §2.3) |
| Jeda commit → reveal sukses | 4–5 blok | |
| `prevrandao` | Unik di 20/20 | Tetap tidak dipakai (aturan keras #1) |
| Gas | `gasUsed` di receipt **= gas limit** untuk semua 59 tx (juga deploy). Saldo terpakai = Σ limit × price | Monad menagih **gas limit**, termasuk tx yang revert |
| Gas price | base fee 100 gwei + priority 2 gwei = **102 gwei** | Lihat estimasi biaya di bawah |

### Estimasi biaya gas per run (testnet, 102 gwei)

Pakai target CONTRACT_SPEC §8 + 20%: descend 42k, reveal 60k, act 54k, settle 180k → **±336k gas per lantai ≈ 0.034 MON**.

| Lantai | Gas | Biaya |
|---|---|---|
| 1 | ~336k + enter/cashOut ~250k | ~0.06 MON |
| 5 | ~1.9M | ~0.19 MON |
| 10 | ~3.6M | ~0.37 MON |

Biaya gas run 10 lantai (~0.37 MON) **jauh di atas entry fee 0.05 MON saat spike**. Entry fee kemudian dinaikkan ke 1 MON (ekonomi ×20, GAME_DESIGN §4.1), jadi gas run kini ±25% entry dengan desain 2 tx. Catatan yang tetap berlaku:
- Top-up default 0.1 MON (UI_UX §5) cuma cukup untuk ±2–3 lantai. `MAX_GAS_TOPUP` 0.5 MON cukup untuk ±14 lantai.
- Tx revert tetap dibayar penuh, jadi tx `TooEarly` itu mahal. Jangan kirim reveal/settle sebelum blok target lewat.
- `settle` sebaiknya memakai gas limit per aksi (treasure/trap/merchant jauh lebih murah dari combat 64 round) di `lib/gas.ts`.

### Temuan Phase 2 (2026-10-23)

- **Transient storage (EIP-1153) didukung.** Dicek tanpa tx lewat `eth_call` initcode `TSTORE 0x2a` → `TLOAD` → return: `cast call --rpc-url https://testnet-rpc.monad.xyz --create 0x602a60005d60005c60005260206000f3` mengembalikan `0x…2a`. Karena itu `Depths` memakai `ReentrancyGuardTransient`.
- **Jadwal gas Monad berbeda dari Ethereum** ([docs.monad.xyz/developer-essentials/opcode-pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing)): storage dihitung per page 128 slot (cold page 8.1k, page write pertama 2.8k, state growth 17k per slot baru), cold account 10.1k. Foundry 1.8 punya `--network monad` untuk mensimulasikannya. Gas per jalur di CONTRACT_SPEC §8 diukur dengan mode ini. Kalibrasi akhir tetap dengan `cast estimate` di testnet (Phase 3).
- **Estimasi biaya baru (desain 2 tx, jadwal Monad, +20% margin, 102 gwei):** act ±64k + descend ±88k ≈ **152k gas per lantai ≈ 0.0155 MON**. Run 10 lantai ≈ 0.155 MON + cashOut ±0.013 MON dari burner. Top-up default 0.25 MON cukup untuk ±14 lantai. `enterDungeon` (107k–203k) dibayar main wallet.

### Belum diukur

- Aturan *reserve balance* Monad untuk EOA bersaldo kecil (burner tidak pernah mendekati 0 di spike ini).

### Output runner (2026-10-22T01:45:58.702Z)

- RPC: https://testnet-rpc.monad.xyz (chainId 10143), 20 iterasi, 59 tx (19 revert)
- Latency submit→receipt: p50 932 ms, p95 1403 ms
- Reveal back-to-back (tanpa tunggu) sukses: 1/20
- Commit & reveal back-to-back di blok yang sama: 18/20
- blockhash(target) = 0: 0/20
- blockhash(n-256) = 0: 0/20, blockhash(n-300) = 0: 20/20
- prevrandao unik: 20/20
- EIP-2935 history contract: ADA
- Window blockhash via eth_call (head 73115636): -1:ok, -128:ok, -255:ok, -256:0, -257:0, -300:0, -1000:0, -8191:0
- Gas: Σ gasUsed receipt 4320000, Σ gas limit 4320000
- Biaya: saldo terpakai 0.44064 MON vs Σ gasUsed×price 0.44064 MON (kalau saldo ≈ limit×price, Monad menagih gas limit)

| # | commit blk | reveal cepat | reveal blk | retry | hash(target) | hash(-256) | hash(-300) |
|---|---|---|---|---|---|---|---|
| 0 | 73115485 | revert #73115485 | 73115489 | ya | ok | ok | **0** |
| 1 | 73115492 | revert #73115493 | 73115497 | ya | ok | ok | **0** |
| 2 | 73115501 | revert #73115501 | 73115505 | ya | ok | ok | **0** |
| 3 | 73115509 | revert #73115509 | 73115513 | ya | ok | ok | **0** |
| 4 | 73115517 | revert #73115517 | 73115521 | ya | ok | ok | **0** |
| 5 | 73115523 | ok #73115525 | 73115525 | - | ok | ok | **0** |
| 6 | 73115528 | revert #73115528 | 73115533 | ya | ok | ok | **0** |
| 7 | 73115537 | revert #73115537 | 73115542 | ya | ok | ok | **0** |
| 8 | 73115545 | revert #73115545 | 73115549 | ya | ok | ok | **0** |
| 9 | 73115552 | revert #73115552 | 73115556 | ya | ok | ok | **0** |
| 10 | 73115559 | revert #73115559 | 73115564 | ya | ok | ok | **0** |
| 11 | 73115566 | revert #73115566 | 73115571 | ya | ok | ok | **0** |
| 12 | 73115575 | revert #73115575 | 73115579 | ya | ok | ok | **0** |
| 13 | 73115583 | revert #73115583 | 73115587 | ya | ok | ok | **0** |
| 14 | 73115591 | revert #73115591 | 73115596 | ya | ok | ok | **0** |
| 15 | 73115599 | revert #73115599 | 73115603 | ya | ok | ok | **0** |
| 16 | 73115607 | revert #73115607 | 73115612 | ya | ok | ok | **0** |
| 17 | 73115616 | revert #73115616 | 73115620 | ya | ok | ok | **0** |
| 18 | 73115622 | revert #73115622 | 73115627 | ya | ok | ok | **0** |
| 19 | 73115631 | revert #73115631 | 73115635 | ya | ok | ok | **0** |

## Keputusan

- [x] **blockhash OK**, tidak perlu Pyth Entropy (abstraksi `_seed` tetap dipertahankan)
- [x] Window expiry **tetap 256 blok**. Perpanjangan via EIP-2935 dicatat sebagai P2
- [x] **Desain tx diubah ke 2 tx per lantai** (lazy reveal/settle + fallback relay, ARCHITECTURE §4.2.1), perkiraan ±0.02–0.025 MON per lantai
- [x] Top-up default **0.25 MON** (±10 lantai). Reserve balance belum diukur (Phase 4)
- [x] Update ARCHITECTURE §4.4
