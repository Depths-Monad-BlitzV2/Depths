# Smart Contract Spec — Depths

Target: Solidity `0.8.28`, Foundry, EVM Monad. Angka gameplay: lihat [GAME_DESIGN.md](GAME_DESIGN.md). Alasan desain: lihat [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. File

| File | Isi |
|---|---|
| `src/DepthsTypes.sol` | enum, struct, event, custom error (dipakai bersama) |
| `src/DepthsLogic.sol` | `library DepthsLogic`, semua `internal pure`: tabel, `rollEncounter`, `resolveCombat`, `resolveTrap`, `resolveTreasure`, `fleeChance`, `dmg`, `rand` |
| `src/Depths.sol` | `contract Depths is IDepths, Ownable2Step, Pausable, ReentrancyGuardTransient`: storage, state machine, uang. Guard transient (EIP-1153, terverifikasi di Monad testnet) karena guard storage OZ 5.x memakai slot ERC-7201 di page sendiri (+8.1k cold page di Monad) |
| `src/interfaces/IDepths.sol` | interface publik untuk frontend dan keeper |
| `src/spike/RngProbe.sol` | Spike Phase 0 saja (blockhash/latency), bukan bagian game |

## 2. Types

```solidity
enum RunState { NONE, AWAIT_REVEAL, AWAIT_ACTION, AWAIT_SETTLE, FLOOR_CLEARED }
enum Encounter { NONE, MONSTER, TREASURE, TRAP, MERCHANT }
enum Action { NONE, FIGHT, FLEE, OPEN, LEAVE, PROCEED, DISARM, BUY }
enum Outcome { NONE, WIN, FLED, FLEE_FAIL_WIN, TREASURE, MIMIC_WIN, TRAP_HP, TRAP_LOOT, DISARM_OK, DISARM_FAIL, LEAVE, BUY, KILLED, FLEE_FAIL_KILLED, MIMIC_KILLED }
enum DeathCause { NONE, KILLED, EXPIRED, TRAP }

struct Run {                 // dikemas ke 3 slot
    // slot 0
    address operator;        // 20 bytes, session key
    uint32  runId;           // global incrementing
    uint8   state;           // RunState
    uint8   floor;           // 1..20
    uint8   encounter;       // Encounter
    uint8   pendingAction;   // Action
    uint8   swords;
    uint8   shields;
    uint8   potions;
    // slot 1
    bool    usePotion;       // flag pending
    uint16  hp;
    uint16  maxHp;
    uint16  atk;
    uint8   monsterId;       // kosmetik
    uint64  targetBlock;     // blok RNG yang ditunggu
    uint128 bag;             // wei
    // slot 2
    bytes32 encounterSeed;   // disimpan saat reveal (untuk replay/verify)
}

struct PlayerStats { uint32 runs; uint8 bestFloor; uint128 totalCashedOut; uint128 totalLost; }
struct BoardEntry { address player; uint128 value; uint8 floor; uint32 runId; }

// Hasil pure DepthsLogic.resolve*; Depths.sol yang menerapkan cap pool ke lootTable
struct Resolution { Outcome outcome; bool survived; uint16 hpAfter; uint128 lootTable; uint128 bagLoss; }
```

## 3. Storage

```solidity
mapping(address owner => Run) internal _runs;                   // baca lewat getRun()
mapping(address operator => address owner) internal _operatorOf; // bisa basi, baca lewat operatorOf()
mapping(address => PlayerStats) public stats;
BoardEntry[10] internal _topCashouts;   // desc berdasarkan value; baca lewat getBoards()
BoardEntry[10] internal _topDepths;     // desc berdasarkan floor, tie → value (cash out dan mati)
uint128 public pool;
uint128 public reserved;
uint128 public treasury;
uint128 public entryFee = 1 ether;
uint32  public nextRunId = 1;
uint8   internal _cashLen;              // jumlah entry terisi per board, satu slot dengan nextRunId
uint8   internal _depthLen;
```

Konstanta: `RAKE_BPS=500`, `MAX_AWARD_BPS=500`, `MAX_FLOOR=20`, `BASE_HP=100`, `BASE_ATK=12`, `BLOCKHASH_WINDOW=256`, `MAX_GAS_TOPUP=0.5 ether`, `MAX_ROUNDS=64`, `PURPOSE_ENCOUNTER=1`, `PURPOSE_RESOLVE=2`, `MIN_ENTRY_FEE=0.2 ether`, `MAX_ENTRY_FEE=20 ether`. Harga dan batas merchant (`SWORD_PRICE` dst.) ada di `DepthsLogic` karena termasuk angka gameplay.

**Run tidak di-`delete` (Phase 2, alasan gas).** Saat run selesai (mati/cash out), contract hanya menulis `state = NONE` dan `bag = 0`. Slot lain dibiarkan, sehingga run berikutnya menulis non-zero → non-zero, bukan 0 → non-zero (state growth 17k per slot di Monad). Refund dari `delete` tidak membantu karena Monad menagih gas limit. Konsekuensinya:
- `getRun(owner)` mengembalikan struct kosong untuk state NONE.
- `encounterSeed` hanya valid di state ≥ `AWAIT_ACTION` (baru ditulis saat reveal).
- `_operatorOf[op]` tidak dihapus. `operatorOf(op)` hanya mengembalikan owner kalau run owner itu aktif **dan** `run.operator == op`. Session key yang sama bisa dipakai ulang untuk run berikutnya (menulis nilai yang sama = murah).

## 4. Fungsi eksternal

### Player / operator

| Fungsi | Guard | Efek |
|---|---|---|
| `enterDungeon(address operator) payable` | `whenNotPaused`, `nonReentrant`, state == NONE, `msg.value >= entryFee`, `msg.value - entryFee <= MAX_GAS_TOPUP`, operator bukan owner run lain | Split fee ke pool/treasury, init run (floor 1, HP/ATK base), `targetBlock = block.number+1`, state AWAIT_REVEAL, forward top-up ke operator, `stats.runs++` |
| `descend()` | caller = owner atau operator, state ∈ {FLOOR_CLEARED, AWAIT_SETTLE}, floor < MAX_FLOOR | Kalau AWAIT_SETTLE: `_settle` dulu (butuh `block.number > targetBlock`, expired → `_die(EXPIRED)`). Kalau hasil `_settle` mati → selesai di situ, **tidak revert**. Kalau hidup: `floor++`, `targetBlock = block.number+1`, state AWAIT_REVEAL |
| `act(Action a, uint8 swordQty, uint8 shieldQty, uint8 potionQty, bool usePotion)` | caller = owner/operator, state ∈ {AWAIT_REVEAL, AWAIT_ACTION}, aksi valid untuk encounter (lihat tabel di bawah) | Kalau AWAIT_REVEAL: `_reveal` dulu (butuh `block.number > targetBlock`, expired → `_die(EXPIRED)` tanpa revert). Lalu BUY/LEAVE: diproses instan → FLOOR_CLEARED. Lainnya: simpan `pendingAction`, `usePotion`, `targetBlock = block.number+1`, state AWAIT_SETTLE. Aksi tidak valid untuk encounter hasil `_reveal` → revert `InvalidAction` (frontend sudah tahu encounter dari `previewEncounter`) |
| `cashOut()` | `nonReentrant`, caller = owner/operator, state ∈ {FLOOR_CLEARED, AWAIT_SETTLE} | Kalau AWAIT_SETTLE: `_settle` dulu (mati → selesai, tidak revert). Lalu `reserved -= bag`, update stats/board, hapus run, **transfer ke owner** (CEI: state dulu, baru transfer) |
| `withdrawOperator()` | caller = operator | Lepas tautan operator (opsional, untuk ganti session key) |

Detail perilaku (diputuskan di Phase 2):
- `enterDungeon`: `operator = address(0)` boleh (main wallet saja), tapi top-up harus 0 (`TopUpTooLarge`). Operator tidak boleh sedang menjadi operator run aktif lain atau punya run aktif sendiri, dan pemanggil tidak boleh sedang menjadi operator aktif (`OperatorInUse`). `operator == msg.sender` boleh.
- `act`: `swordQty/shieldQty/potionQty` harus 0 untuk aksi selain BUY, dan `usePotion` harus false untuk BUY/LEAVE (`InvalidAction`). `usePotion` boleh untuk FIGHT, FLEE, OPEN, PROCEED, DISARM. `BUY(0,0,0)` sama dengan LEAVE. Potion dikurangi saat `_settle`, bukan saat commit.
- **Floor 20**: BUY/LEAVE di floor 20 → `FLOOR_CLEARED` (tidak auto cash out karena `act` tidak pernah mengirim MON); player memanggil `cashOut`. Hasil resolusi floor 20 yang di-settle lewat `settle(owner)` → auto cash out. Lewat `cashOut()` → di-settle lalu dibayar sekali. `descend` di floor 20 → `MaxFloorReached` (dicek sebelum `_settle`).
- `_settle` tidak pernah transfer. Auto cash out floor 20 dijalankan oleh pemanggil (`settle` / `cashOut`), jadi setiap fungsi punya satu titik transfer di akhir.
- Mati karena `DISARM` gagal → `RunDied(cause=TRAP)`. Mati di combat/mimic → `KILLED`.
- Award loot (`LootAwarded`) di-emit setiap kali `lootTable > 0`, termasuk salvage `DISARM_OK`.
- Board: `topDepths` diisi oleh run yang cash out **dan** run yang mati (value = bag saat itu); `topCashouts` hanya cash out dengan bag > 0. Tie → entry lama tetap di atas.
- `stats.bestFloor` = floor tertinggi yang dicapai (cash out maupun mati). `totalLost` = bag yang hilang (tidak termasuk entry fee).

Aksi valid per encounter:

| Encounter | Aksi |
|---|---|
| MONSTER | FIGHT, FLEE (+usePotion) |
| TREASURE | OPEN (+usePotion, untuk jaga-jaga mimic), LEAVE |
| TRAP | PROCEED, DISARM (+usePotion) |
| MERCHANT | BUY, LEAVE |

`usePotion` boleh `true` hanya kalau `potions > 0`.

Jalur normal 2 tx per lantai (`act` → `descend`/`cashOut`): reveal dan settle dijalankan secara internal, lihat ARCHITECTURE §4.2.1. `_reveal` dan `_settle` adalah fungsi internal yang sama dengan yang dipakai `reveal`/`settle` di bawah, jadi hasilnya identik di kedua jalur.

### Relay fallback (permissionless, siapa saja boleh memanggil)

Dipanggil hanya kalau tx keputusan belum masuk: frontend setelah 150 blok, keeper setelah 200 blok.

| Fungsi | Guard | Efek |
|---|---|---|
| `reveal(address owner)` | state == AWAIT_REVEAL, `block.number > targetBlock` | Kalau `block.number > targetBlock + 256` → `_die(EXPIRED)`. Kalau tidak: `encounterSeed = _seed(PURPOSE_ENCOUNTER)`, `encounter = rollEncounter`, set `monsterId`, state AWAIT_ACTION |
| `settle(address owner)` | state == AWAIT_SETTLE, `block.number > targetBlock` | Expired → `_die`. Kalau tidak: `seed = _seed(PURPOSE_RESOLVE)`, terapkan potion, resolve sesuai aksi, award loot (dengan cap), state FLOOR_CLEARED atau `_die(KILLED)`. Kalau floor == MAX_FLOOR dan hidup → auto `_cashOut` |
| `reapExpired(address owner)` | state ∈ {AWAIT_REVEAL, AWAIT_SETTLE} (`WrongState`) dan sudah expired (`TooEarly(targetBlock + 256, block.number)`) | `_die(EXPIRED)` (dipakai keeper untuk bersih-bersih) |

### Admin (owner)

| Fungsi | Catatan |
|---|---|
| `seedPool() payable` | Siapa saja boleh (bukan hanya owner) |
| `setEntryFee(uint128)` | Batas 0.2–20 MON (`InvalidFee`). Tidak mempengaruhi run aktif. Emit `EntryFeeSet` |
| `withdrawTreasury(address to, uint128 amt)` | Hanya dari bucket `treasury` (`InsufficientTreasury`). **Tidak ada** fungsi menarik `pool` atau `reserved`. Emit `TreasuryWithdrawn` |
| `pause()` / `unpause()` | Hanya memblokir `enterDungeon`. Run aktif tetap bisa jalan sampai selesai/cash out |

### View

| Fungsi | Return |
|---|---|
| `getRun(address owner) → Run` | |
| `previewResolve(address owner) → (Resolution res, bytes32 seed, bool ready, bool expired)` | Hasil `_settle` tanpa menyimpan (state AWAIT_SETTLE). Dipakai frontend untuk menampilkan hasil dan memilih gas limit sebelum `descend`/`cashOut`. Loot di `res.lootTable` sebelum cap; frontend menerapkan cap dari `poolInfo()` |
| `ownerOf(address caller) → address` | resolve operator → owner (operator dicek dulu), atau dirinya sendiri kalau punya run aktif, atau `address(0)` |
| `operatorOf(address operator) → address` | owner run **aktif** yang memakai operator ini, atau `address(0)` |
| `previewEncounter(address owner) → (Encounter, uint8 monsterId, bool ready, bool expired)` | **Wajib** (jalur normal). Encounter lantai ini tanpa menyimpan (state AWAIT_REVEAL). `ready = block.number > targetBlock`. Di state setelah reveal: encounter tersimpan dengan `ready = true`. NONE: semua nol |
| `monsterStats(uint8 floor) → (uint16 hp, uint16 atk, uint128 loot)` | |
| `getBoards() → (BoardEntry[10], BoardEntry[10])` | |
| `poolInfo() → (pool, reserved, treasury, entryFee)` | |

## 5. Events

Semua event membawa `owner` dan `runId` (indexed) supaya mudah difilter.

```solidity
event RunStarted(address indexed owner, uint32 indexed runId, address operator, uint128 entryFee);
event FloorEntered(address indexed owner, uint32 indexed runId, uint8 floor, uint64 targetBlock);
event EncounterRevealed(address indexed owner, uint32 indexed runId, uint8 floor, Encounter enc, uint8 monsterId, bytes32 seed);
event ActionCommitted(address indexed owner, uint32 indexed runId, uint8 floor, Action action, bool usePotion, uint64 targetBlock);
event ItemsBought(address indexed owner, uint32 indexed runId, uint8 swords, uint8 shields, uint8 potions, uint128 cost);
event FloorResolved(address indexed owner, uint32 indexed runId, uint8 floor, Action action, bytes32 resolveSeed,
                    bool survived, uint16 hpAfter, int128 bagDelta, uint8 outcomeCode);
event LootAwarded(address indexed owner, uint32 indexed runId, uint128 amount, uint128 tableAmount); // amount < table → kena cap
event CashedOut(address indexed owner, uint32 indexed runId, uint8 floor, uint128 amount);
event RunDied(address indexed owner, uint32 indexed runId, uint8 floor, uint128 lostBag, uint8 cause); // 1=KILLED 2=EXPIRED 3=TRAP
event PoolChanged(uint128 pool, uint128 reserved);
event EntryFeeSet(uint128 entryFee);                          // admin, ditambahkan Phase 2
event TreasuryWithdrawn(address indexed to, uint128 amount);  // admin, ditambahkan Phase 2
```

Urutan event per tx dijaga identik antara jalur normal dan fallback (diuji `test_parity_*`). Kematian di resolusi: `FloorResolved(survived=false, hpAfter=0, bagDelta=0)` lalu `RunDied`. BUY: `ItemsBought` lalu `FloorResolved(outcome=BUY, bagDelta=-cost)`. LEAVE: `FloorResolved(outcome=LEAVE, resolveSeed=0)`.

`outcomeCode` (= enum `Outcome`): 1 WIN, 2 FLED, 3 FLEE_FAIL_WIN, 4 TREASURE, 5 MIMIC_WIN, 6 TRAP_HP, 7 TRAP_LOOT, 8 DISARM_OK, 9 DISARM_FAIL (`survived=false` kalau HP habis), 10 LEAVE, 11 BUY, 12 KILLED, 13 FLEE_FAIL_KILLED, 14 MIMIC_KILLED.
Kode 12–14 ditambahkan di Phase 1 supaya kematian tetap punya kode yang menjelaskan penyebabnya.
Frontend me-replay combat round per round dari `resolveSeed` + stat sebelum resolusi (lewat `packages/game-logic`), jadi log round tidak perlu di-emit.

## 6. Custom errors

```solidity
error NotRunController();         // bukan owner/operator
error WrongState(RunState expected, RunState actual);
error TooEarly(uint64 targetBlock, uint256 current);
error InvalidAction();
error InsufficientFee();
error TopUpTooLarge();
error OperatorInUse();
error InsufficientBag();
error ItemLimit();
error NoPotion();
error MaxFloorReached();
error TransferFailed();
error InvalidFloor();             // DepthsLogic.monster di luar 1..20
error BlockhashUnavailable();     // blockhash(targetBlock) == 0 (jaga-jaga, §7)
error InvalidFee();               // setEntryFee di luar 0.2–20 MON
error InsufficientTreasury();     // withdrawTreasury > treasury
```

Admin memakai error OZ: `OwnableUnauthorizedAccount`, `EnforcedPause`. Re-entry memakai `ReentrancyGuardReentrantCall`.

## 7. Seed

```solidity
function _seed(Run storage r, address owner, uint8 purpose) internal view returns (bytes32) {
    bytes32 bh = blockhash(r.targetBlock);
    // bh == 0 seharusnya tidak terjadi karena expiry sudah dicek sebelumnya; tetap revert untuk jaga-jaga
    if (bh == bytes32(0)) revert BlockhashUnavailable();
    return keccak256(abi.encode(bh, owner, r.runId, r.floor, purpose));  // semua field di-pad 32 byte
}
```

## 8. Gas per jalur (diukur Phase 2)

Sumber: `test/DepthsGas.t.sol`, dijalankan dengan `forge test --match-contract DepthsGas --isolate --network monad -vv`. Angka = gas tx penuh (21k intrinsic + calldata + eksekusi sebelum refund), yaitu **gas limit minimum**. Kolom Monad memakai jadwal gas Monad di foundry (storage per page 128 slot: cold page 8.1k, state growth 17k per slot baru; cold account 10.1k). Kolom Ethereum untuk pembanding. **Kalibrasi ulang dengan `cast estimate` di testnet saat Phase 3** sebelum dipakai di `lib/gas.ts`.

| Fungsi / jalur | Target awal | Monad | Ethereum | Catatan |
|---|---|---|---|---|
| enterDungeon (player lama, session key sama) | ≤ 120k | **107k** ✅ | 80k | kasus umum |
| enterDungeon (player + session key baru) | ≤ 120k | 203k ⚠️ | 176k | sekali per player: akun burner baru (25k), slot baru run/stats/operator (state growth) |
| act FIGHT di AWAIT_REVEAL (`_reveal` + commit) | ≤ 85k | **53k** ✅ | 51k | 70k di run pertama player (slot `encounterSeed` baru) |
| act LEAVE / BUY 1+1+1 di AWAIT_REVEAL | ≤ 95k | **54k / 75k** ✅ | 52k / 67k | |
| descend di AWAIT_SETTLE (`_settle` + commit) | ≤ 60k + resolusi | **54k** FLED, **70k** award, **73k** FIGHT 11 serangan ✅ | 46k / 57k / 60k | combat ≈ **260 gas per serangan** (draw); award + PoolChanged ≈ 16k |
| descend di AWAIT_SETTLE → mati | – | 132k | 132k | termasuk insert board kedalaman baru; board penuh & tidak masuk jauh lebih murah |
| cashOut di AWAIT_SETTLE (board penuh, tidak masuk) | ≤ 110k + resolusi | **105k** (5 serangan) ✅ | 84k | kasus umum setelah board terisi |
| cashOut di AWAIT_SETTLE (masuk 2 board, posisi akhir) | – | 175k | 173k | 2 entry baru × 2 slot |
| cashOut worst case (masuk posisi #1 board penuh, geser 9 entry × 2 board) | – | ±320k | 316k | dari `--gas-report` max |
| descend / cashOut di FLOOR_CLEARED | ≤ 35k / ≤ 90k | 45k ⚠️ / **89k** ✅ | 38k / 68k | setelah fallback settle |
| reveal / settle TREASURE (fallback) | ≤ 50k / ≤ 40k + resolusi | **39k** ✅ / 59k | 40k / 52k | settle = 43k + award 16k |
| reapExpired (board penuh / board baru) | – | 58k / 98k | 48k / 96k | |

**Kalibrasi testnet (Phase 3, 2026-10-23).** `eth_estimateGas` di Monad testnet saat smoke test (`scripts/smoke.sh`) dan uji keeper, dibandingkan dengan simulasi `--network monad` di atas:

| Jalur (testnet) | `cast estimate` | Simulasi | Selisih |
|---|---|---|---|
| enterDungeon (player + burner baru) | 204,931 | 202,591 | +1.2% |
| enterDungeon (player lama, burner sama) | 108,630 | 107,049 | +1.5% |
| enterDungeon (player lama, burner baru) | 153,526 | – | akun burner baru (+25k) dan slot operator baru |
| act FIGHT di AWAIT_REVEAL (floor 2) | 52,947 | 52,873 | +0.1% |
| act LEAVE di AWAIT_REVEAL (floor 1, run pertama) | 72,648 | – | LEAVE + slot `encounterSeed` baru |
| act FIGHT / LEAVE di AWAIT_ACTION | 46,802 / 47,668 | 47,185 (OPEN) | ±1% |
| descend di FLOOR_CLEARED | 45,084 | 44,769 | +0.7% |
| reveal (fallback, juga dari keeper) | 39,033–39,075 | 39,124 | −0.2% |
| settle FIGHT WIN (fallback, juga dari keeper) | 62,534 | – | |
| cashOut di AWAIT_SETTLE (WIN, masuk 2 board) | 176,654 | 175,191 | +0.8% |
| cashOut di FLOOR_CLEARED (bag 0 / bag > 0, masuk board) | 103,689 / 152,955–163,047 | – | biaya board bergantung posisi |

Kesimpulan: `forge test --isolate --network monad` akurat untuk menyusun `base[jalur]` di `lib/gas.ts`, dengan margin 20% sudah lebih dari cukup. Setiap estimate di atas lolos dengan limit = estimate × 1.2 (semua tx status 1).

Panduan `lib/gas.ts`:
- `act`, `descend`, `reveal`, `settle`: `base[jalur] + serangan × 260 + margin 20%`, dengan `serangan` dari `replayCombat` (jumlah draw combat).
- `cashOut`: biaya board bergantung posisi insert, jadi pakai `eth_estimateGas` (hasil sudah deterministik sebelum tx dikirim) + margin, atau batas atas 350k.
- Worst case combat (64 round, 129 draw) menambah ±34k di atas base. Keeper boleh memakai limit tetap: `settle` 150k, `reapExpired` 120k (tanpa auto cash out), `settle` floor 20 (auto cash out) 400k.

Catatan Phase 1: `DepthsLogic.resolveCombat` worst case (129 draw) = **33.7k gas** setelah `rand` memakai scratch-space keccak dan `dmg` unchecked (sebelumnya 102k). Dijaga oleh `test_combat_worstCaseGas` (< 40k).

Optimasi Phase 2 (ukuran pertama vs akhir, jadwal Ethereum: cashOut masuk 2 board baru 291k → 173k, enterDungeon player lama 146k → 80k, act floor 2+ 52k → 51k; plus ±8k per tx di jadwal Monad dari poin 3–4):
1. Panjang board disimpan (`_cashLen/_depthLen`) supaya slot kosong tidak dipindai/digeser.
2. Run dan tautan operator tidak di-`delete` (§3).
3. `ReentrancyGuardTransient` (TSTORE) menggantikan guard storage di page terpisah.
4. `ownerOf` mengecek operator dulu (tidak membaca page run milik operator).

Monad menagih **gas limit**, termasuk tx revert, jadi limit worst case untuk semua tx membuang MON burner.

## 9. Test wajib

- **Unit**: setiap transisi state di tabel §4, setiap custom error.
- **Logic**: semua baris tabel monster, batas `dmg` (min 1), MAX_ROUNDS, flee chance di floor 1/10/20.
- **Expiry**: `vm.roll(target + 257)` → `act`/`descend`/`cashOut` (jalur normal) maupun `reveal`/`settle` (fallback) memicu `RunDied(cause=EXPIRED)` tanpa revert.
- **Anti-cheat**: `descend`/`act` lalu tx keputusan berikutnya di block yang sama → `TooEarly`.
- **Parity jalur**: untuk seed yang sama, jalur normal (`act` di AWAIT_REVEAL, `descend`/`cashOut` di AWAIT_SETTLE) dan jalur fallback (`reveal` → `act`, `settle` → `descend`/`cashOut`) menghasilkan state, event, dan saldo yang identik.
- **Mati di lazy settle**: `descend`/`cashOut` yang `_settle`-nya mati tidak revert, emit `RunDied(KILLED)`, bag masuk pool, run dihapus, dan tidak ada transfer.
- **Preview**: `previewEncounter` / `previewResolve` sama dengan hasil yang kemudian disimpan oleh tx berikutnya.
- **Operator**: operator tidak bisa menyentuh run owner lain. `cashOut` oleh operator → dana masuk ke owner.
- **Fuzz**: `act` dengan input acak tidak pernah merusak invariant.
- **Invariant** (handler acak: enter / act / descend / cashOut di semua state yang valid, reveal / settle fallback, seedPool, roll block):
  - `address(depths).balance >= pool + reserved + treasury`
  - `reserved == Σ runs[aktif].bag`
  - `hp <= maxHp` untuk semua run aktif
- **Vectors**: `GenVectors.t.sol` menulis `test/vectors/combat.json` dan `encounter.json` (≥ 200 kasus) lewat `vm.writeJson`, lalu dikonsumsi `packages/game-logic/test/parity.test.ts`.
