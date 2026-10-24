# Game Design — Depths

Satuan uang di dokumen ini: **mMON** (milli-MON). 1 mMON = 0.001 MON = `1e15` wei.
Semua angka di sini adalah **sumber kebenaran** untuk `DepthsLogic.sol` dan `packages/game-logic`. Kalau angka berubah, update dokumen ini, contract, mirror TS, dan test vectors **bersamaan**.

## 1. Core loop

```
Bayar entry (1000 mMON = 1 MON) → Lantai 1
  ┌─► Encounter muncul (monster / treasure / trap / merchant)
  │   Pilih aksi → hasil (menang / kalah / loot / damage)
  │   Mati? ──► RUN OVER. Bag hilang ke pool.
  │   Selamat → [CASH OUT] → MON ke wallet. Selesai.
  └── [GO DEEPER] → lantai +1
```

## 2. Parameter global

| Parameter | Nilai | Konstanta |
|---|---|---|
| Entry fee | 1000 mMON (1 MON) | `entryFee` (owner-settable, 200–20000 mMON) |
| Rake | 5% dari entry | `RAKE_BPS = 500` |
| Cap award per loot | 5% dari pool bebas | `MAX_AWARD_BPS = 500` |
| Lantai maksimum | 20 (setelah clear → auto cash out) | `MAX_FLOOR = 20` |
| HP awal / Max HP awal | 130 / 130 | `BASE_HP` |
| ATK awal | 12 | `BASE_ATK` |
| Potion awal | 0 | |
| Window expiry RNG | 256 block | `BLOCKHASH_WINDOW` |
| Max combat round | 64 (lewat dari itu → player kalah) | `MAX_ROUNDS` |

## 3. Encounter

Roll `r = rand(seedEncounter, 0) % 100`:

| Range `r` | Encounter | Peluang |
|---|---|---|
| 0–39 | 🐉 Monster | 40% |
| 40–64 | 💰 Treasure | 25% |
| 65–79 | 🪤 Trap | 15% |
| 80–99 | 🏪 Merchant | 20% |

**Syarat merchant:** merchant hanya muncul kalau bag ≥ harga item termurah (potion, 200 mMON). Kalau bag kurang, roll 80–99 menjadi 💰 Treasure. Lantai 1 (bag selalu 0) jadi tidak pernah merchant. Di contract: `rollEncounter(seed, floor, bag)` memakai `r.bag` saat reveal.

## 4. Monster

### 4.1 Tabel stat (HP, ATK, loot)

| Floor | HP | ATK | Loot (mMON) | | Floor | HP | ATK | Loot (mMON) |
|---|---|---|---|---|---|---|---|---|
| 1 | 30 | 5 | 120 | | 11 | 230 | 45 | 4600 |
| 2 | 40 | 7 | 200 | | 12 | 265 | 50 | 5300 |
| 3 | 52 | 9 | 300 | | 13 | 304 | 56 | 6080 |
| 4 | 60 | 10 | 450 | | 14 | 350 | 63 | 7000 |
| 5 | 72 | 12 | 700 | | 15 | 402 | 70 | 8040 |
| 6 | 88 | 15 | 1100 | | 16 | 463 | 79 | 9260 |
| 7 | 105 | 19 | 1500 | | 17 | 532 | 88 | 10640 |
| 8 | 125 | 23 | 2000 | | 18 | 612 | 99 | 12240 |
| 9 | 148 | 27 | 2700 | | 19 | 704 | 111 | 14080 |
| 10 | 175 | 32 | 3500 | | 20 | 809 | 124 | 16180 |

Floor 11–20 mengikuti HP & loot ×1.15/floor dan ATK ×1.12/floor, dibulatkan, lalu di-hardcode di tabel (tanpa kalkulasi eksponen on-chain).

_Rebalance 2026-10-24 ("lebih mudah"): floor 4–10 HP −8…−13% dan ATK −17…−21%, loot floor 1–10 −12…−40%, BASE_HP 100 → 130, treasure 200–1000 → 150–600 mMON, plus syarat merchant (§3). Floor 11–20 tidak berubah. Tujuan: kematian di floor ≤ 5 turun ±60% tanpa membuat RTP strategi terbaik keluar target 85–95% (§9)._

Skala ekonomi ×20 (2026-10-22): entry fee naik dari 50 ke 1000 mMON, dan semua loot, harga, treasure, serta salvage ikut ×20 supaya RTP tidak berubah. Di contract, tabel loot disimpan dalam cMON (0.01 MON) karena 16180 tidak muat di slot 12-bit.
Loot aktual = `min(tabelLoot, pool × 5%)`.

Nama monster (cuma kosmetik, `monsterId = tier × 4 + rand(seedEncounter, 1) % 4`, tier 0–3): floor 1–3 Tiny Zombie / Slime / Imp / Goblin · 4–6 Skeleton / Orc / Wraith / Orc Shaman · 7–10 Troll / Orc Warlord / Lich / Chort · 11–20 Abomination / Demon / Abyss Lord / Void Horror.

_2026-10-23 (Phase 5): enam nama diganti mengikuti sprite pack 0x72 DungeonTileset II (Rat → Tiny Zombie, Bat → Imp, Spider → Orc Shaman, Minotaur → Orc Warlord, Wyvern → Chort, Dragon → Abomination). Kosmetik saja: contract hanya menyimpan `monsterId`, angka tidak berubah. Mapping sprite di UI_UX §2.6._

### 4.2 Aksi saat bertemu monster

| Aksi | Efek |
|---|---|
| `FIGHT` | Combat normal, player menyerang duluan |
| `FLEE` | Peluang sukses `max(20%, 60% − 4% × floor)`. Sukses: lantai clear, tanpa loot, tanpa damage. Gagal: monster dapat 1 serangan gratis, lalu combat normal |
| `usePotion` (flag, bisa digabung dengan FIGHT/FLEE) | Minum 1 potion (+50 HP, maks Max HP) **sebelum** resolusi |

### 4.3 Algoritma combat (deterministik dari seed)

```
i = 1                                  // index draw RNG (0 dipakai untuk flee/mimic roll)
if monsterFirst: playerHp -= dmg(monsterAtk, rand(i++))
for round in 0..MAX_ROUNDS-1:
    monsterHp -= dmg(playerAtk, rand(i++));  if monsterHp <= 0: WIN
    playerHp  -= dmg(monsterAtk, rand(i++)); if playerHp  <= 0: DEAD
DEAD (round limit)

dmg(atk, r) = max(1, atk * (80 + r % 41) / 100)    // variasi 80%–120%
rand(seed, i) = uint256(keccak256(abi.encode(seed, i)))
```

HP disimpan sebagai `uint16` dan aritmetika memakai signed int lokal supaya tidak underflow.

**Index draw RNG per seed** (harus identik di Solidity dan TS):

| Seed | Index 0 | Index 1 | Index ≥ 1 |
|---|---|---|---|
| `seedEncounter` | tipe encounter | `monsterId` | – |
| `resolveSeed` | roll flee / mimic / trap / disarm | loot treasure (kalau bukan mimic) | serangan combat (FIGHT, flee gagal, mimic) |

Index 1 dipakai bersama oleh loot treasure dan combat mimic, tapi keduanya tidak pernah terjadi di resolusi yang sama.

**Estimasi win chance** (UI): frontend menjalankan algoritma yang sama dengan 500 seed acak (Monte Carlo) di `packages/game-logic`. Labelnya *estimasi*.

## 5. Treasure

| Aksi | Efek |
|---|---|
| `OPEN` | Roll `rand(0) % 100`: **0–4 → MIMIC** (5%), sisanya loot `(10 + rand(1) % 31) × 15` mMON (150–600 mMON, kelipatan 15, dicap 5% pool) |
| `LEAVE` | Tanpa efek, lantai clear (instan, tanpa RNG) |

**Mimic:** combat wajib (tidak bisa flee) dengan stat monster `floor + 2` (maks floor 20), player menyerang duluan. Kalau menang, loot = 2 × loot tabel **floor saat ini** (bukan floor + 2), lalu dicap 5% pool. Flag `usePotion` tetap berlaku.

## 6. Trap

| Aksi | Efek |
|---|---|
| `PROCEED` | 60%: kehilangan HP `10 + 3 × floor` (**tidak fatal**, HP minimal 1). 40%: kehilangan 20% bag ke pool. Kalau bag = 0, yang terjadi selalu kehilangan HP |
| `DISARM` | 50% sukses: tanpa kerugian + salvage `100 × floor` mMON. 50% gagal: kehilangan HP `2 × (10 + 3 × floor)`, **bisa fatal** |

## 7. Merchant

| Item | Harga | Efek | Batas |
|---|---|---|---|
| 🗡️ Sword | 400 mMON | +10 ATK permanen (untuk run ini) | maks 5 |
| 🛡️ Shield | 400 mMON | +20 Max HP **dan** +20 HP | maks 5 |
| 🧪 Potion | 200 mMON | disimpan, +50 HP saat dipakai | bawa maks 3 |

- Aksi `BUY(swordQty, shieldQty, potionQty)` dibayar dari bag. Revert kalau bag kurang atau melebihi batas. Instan, tanpa RNG → lantai clear.
- Aksi `LEAVE` → lantai clear.
- MON yang dipakai belanja masuk ke pool.

## 8. Setelah lantai clear

- **CASH OUT**: kirim bag ke owner, update stats/leaderboard, run selesai.
- **GO DEEPER**: `floor += 1`, commit RNG untuk encounter berikutnya.
- Setelah floor 20 clear: cash out otomatis saat hasil lantai 20 di-settle (lewat `cashOut` atau fallback `settle`).
- Tidak ada regen HP antar lantai. Satu-satunya cara memulihkan HP adalah potion (dan shield).

## 9. Hasil simulasi ekonomi (baseline)

Monte Carlo 100k run per strategi, pool dianggap tak terbatas (tanpa cap 5%). Script: `pnpm -F game-logic simulate --runs 100000 --seed 1` (`packages/game-logic/src/simulate.ts`). Simulasi memakai fungsi resolusi yang sama dengan contract (dmg integer, MAX_ROUNDS, mimic floor + 2, potion sebelum resolusi). Trap selalu PROCEED, treasure selalu OPEN tanpa potion.

| Strategi | Aturan singkat | RTP | Payout nol | Rata-rata floor | Payout ≥ 2× entry |
|---|---|---|---|---|---|
| Cautious | cash out di ≥1200 mMON atau floor 5 | 89.5% | 6.1% | 4.7 | 0.1% |
| Balanced | cash out di ≥2400 mMON atau floor 8 | 83.7% | 38.3% | 6.6 | 15.6% |
| Greedy | cash out di ≥6000 mMON atau floor 12 | 42.7% | 73.2% | 7.9 | 8.0% |
| YOLO | tidak pernah cash out | 0.1% | 99.9% | 8.0 | 0% |

_Update 2026-10-24 (rebalance §4.1): sebelumnya 90.5 / 74.9 / 38.4 / 0.1% RTP dengan payout nol 14.5 / 46.4 / 74.6 / 100%. Kematian di floor ≤ 5 (simulasi 20k run): cautious 14.2 → 5.9%, balanced 22.0 → 8.9%, YOLO 39.1 → 15.3%._

_Update 2026-10-22: hasil TS mirror setelah skala ekonomi ×20 (sebelum skala: 90.5 / 74.8 / 38.3 / 0.1%; baseline prototipe 89.6 / 74.1 / 38.1 / ~0%)._

Interpretasi:
- Semua strategi RTP < 100% → pool **tumbuh** (ditambah rake 5%). Ekonomi sustain.
- Strategi terbaik pun rugi tipis. Ini sengaja: hadiah besar (≥ 2× entry) cukup sering muncul (≈ 1 dari 8 run untuk strategi balanced), dan itulah yang bikin nagih.
- **Wajib re-run** simulasi setelah TS mirror selesai (Phase 2) dan setiap kali angka berubah. Target: strategi terbaik RTP 85–95%.

Knob tuning kalau RTP keluar target: `BASE_ATK` (paling sensitif, +2 ATK ≈ +7pp RTP), rumus flee, range treasure, dan harga sword.

## 10. Tone & flavor

- Gelap, pixel-art, sedikit humor ("Kamu menginjak tombol yang jelas-jelas mencurigakan.").
- Teks kematian personal: "Kamu mati di Lantai 7. 6.2 MON kini milik dungeon."
- Makin dalam: palet makin merah, heartbeat makin cepat, vignette makin tebal.
