# Smart Contract Spec — Depths

Target: Solidity `0.8.28`, Foundry, EVM Monad. Angka gameplay: lihat [GAME_DESIGN.md](GAME_DESIGN.md). Alasan desain: lihat [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. File

| File | Isi |
|---|---|
| `src/DepthsTypes.sol` | enum, struct, event, custom error (dipakai bersama) |
| `src/DepthsLogic.sol` | `library DepthsLogic`, semua `internal pure`: tabel, `rollEncounter`, `resolveCombat`, `resolveTrap`, `resolveTreasure`, `fleeChance`, `dmg`, `rand` |
| `src/Depths.sol` | `contract Depths is Ownable2Step, Pausable, ReentrancyGuard`: storage, state machine, uang |
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
mapping(address owner => Run) public runs;
mapping(address operator => address owner) public operatorOf;   // dihapus saat run selesai
mapping(address => PlayerStats) public stats;
BoardEntry[10] public topCashouts;   // diurutkan desc berdasarkan value
BoardEntry[10] public topDepths;     // diurutkan desc berdasarkan floor, tie → value
uint128 public pool;
uint128 public reserved;
uint128 public treasury;
uint128 public entryFee = 0.05 ether;
uint32  public nextRunId = 1;
```

Konstanta: `RAKE_BPS=500`, `MAX_AWARD_BPS=500`, `MAX_FLOOR=20`, `BASE_HP=100`, `BASE_ATK=12`, `BLOCKHASH_WINDOW=256`, `MAX_GAS_TOPUP=0.5 ether`, `MAX_ROUNDS=64`, `PURPOSE_ENCOUNTER=1`, `PURPOSE_RESOLVE=2`.

## 4. Fungsi eksternal

### Player / operator

| Fungsi | Guard | Efek |
|---|---|---|
| `enterDungeon(address operator) payable` | `whenNotPaused`, `nonReentrant`, state == NONE, `msg.value >= entryFee`, `msg.value - entryFee <= MAX_GAS_TOPUP`, operator bukan owner run lain | Split fee ke pool/treasury, init run (floor 1, HP/ATK base), `targetBlock = block.number+1`, state AWAIT_REVEAL, forward top-up ke operator, `stats.runs++` |
| `descend()` | caller = owner atau operator, state ∈ {FLOOR_CLEARED, AWAIT_SETTLE}, floor < MAX_FLOOR | Kalau AWAIT_SETTLE: `_settle` dulu (butuh `block.number > targetBlock`, expired → `_die(EXPIRED)`). Kalau hasil `_settle` mati → selesai di situ, **tidak revert**. Kalau hidup: `floor++`, `targetBlock = block.number+1`, state AWAIT_REVEAL |
| `act(Action a, uint8 swordQty, uint8 shieldQty, uint8 potionQty, bool usePotion)` | caller = owner/operator, state ∈ {AWAIT_REVEAL, AWAIT_ACTION}, aksi valid untuk encounter (lihat tabel di bawah) | Kalau AWAIT_REVEAL: `_reveal` dulu (butuh `block.number > targetBlock`, expired → `_die(EXPIRED)` tanpa revert). Lalu BUY/LEAVE: diproses instan → FLOOR_CLEARED. Lainnya: simpan `pendingAction`, `usePotion`, `targetBlock = block.number+1`, state AWAIT_SETTLE. Aksi tidak valid untuk encounter hasil `_reveal` → revert `InvalidAction` (frontend sudah tahu encounter dari `previewEncounter`) |
| `cashOut()` | `nonReentrant`, caller = owner/operator, state ∈ {FLOOR_CLEARED, AWAIT_SETTLE} | Kalau AWAIT_SETTLE: `_settle` dulu (mati → selesai, tidak revert). Lalu `reserved -= bag`, update stats/board, hapus run, **transfer ke owner** (CEI: state dulu, baru transfer) |
| `withdrawOperator()` | caller = operator | Lepas tautan operator (opsional, untuk ganti session key) |

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
| `reapExpired(address owner)` | state ∈ {AWAIT_REVEAL, AWAIT_SETTLE} dan sudah expired | `_die(EXPIRED)` (dipakai keeper untuk bersih-bersih) |

### Admin (owner)

| Fungsi | Catatan |
|---|---|
| `seedPool() payable` | Siapa saja boleh (bukan hanya owner) |
| `setEntryFee(uint128)` | Batas 0.01–1 MON. Tidak mempengaruhi run aktif |
| `withdrawTreasury(address to, uint128 amt)` | Hanya dari bucket `treasury`. **Tidak ada** fungsi menarik `pool` atau `reserved` |
| `pause()` / `unpause()` | Hanya memblokir `enterDungeon`. Run aktif tetap bisa jalan sampai selesai/cash out |

### View

| Fungsi | Return |
|---|---|
| `getRun(address owner) → Run` | |
| `previewResolve(address owner) → (Resolution res, bytes32 seed, bool ready, bool expired)` | Hasil `_settle` tanpa menyimpan (state AWAIT_SETTLE). Dipakai frontend untuk menampilkan hasil dan memilih gas limit sebelum `descend`/`cashOut`. Loot di `res.lootTable` sebelum cap; frontend menerapkan cap dari `poolInfo()` |
| `ownerOf(address caller) → address` | resolve operator → owner |
| `previewEncounter(address owner) → (Encounter, uint8 monsterId, bool ready, bool expired)` | **Wajib** (jalur normal). Encounter lantai ini tanpa menyimpan (state AWAIT_REVEAL). `ready = block.number > targetBlock` |
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
```

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
```

## 7. Seed

```solidity
function _seed(Run storage r, address owner, uint8 purpose) internal view returns (bytes32) {
    bytes32 bh = blockhash(r.targetBlock);
    // bh == 0 seharusnya tidak terjadi karena expiry sudah dicek sebelumnya; tetap revert untuk jaga-jaga
    return keccak256(abi.encode(bh, owner, r.runId, r.floor, purpose));
}
```

## 8. Target gas (isi setelah `forge test --gas-report`)

| Fungsi / jalur | Gas used (target) | Catatan |
|---|---|---|
| enterDungeon | ≤ 120k | |
| act di AWAIT_REVEAL (`_reveal` + commit) | ≤ 85k | jalur normal |
| act BUY/LEAVE di AWAIT_REVEAL | ≤ 95k | jalur normal, instan |
| descend di AWAIT_SETTLE (`_settle` + commit) | ≤ 60k + resolusi | resolusi: combat ≈ 260 gas per serangan (±520 per round) + award |
| cashOut di AWAIT_SETTLE (`_settle` + transfer + board) | ≤ 110k + resolusi | |
| descend / cashOut di FLOOR_CLEARED | ≤ 35k / ≤ 90k | setelah fallback settle |
| reveal / settle (fallback) | ≤ 50k / ≤ 40k + resolusi | |

Simpan di `apps/web/lib/gas.ts` sebagai fungsi per jalur: `base[jalur] + rounds × GAS_PER_ROUND` + margin, dengan `rounds` dari `replayCombat`. Monad menagih **gas limit**, termasuk tx revert, jadi limit worst case untuk semua tx membuang MON burner. Fallback `settle` dari keeper boleh memakai limit worst case (64 round).

Catatan Phase 1: `DepthsLogic.resolveCombat` worst case (129 draw) = **33.7k gas** setelah `rand` memakai scratch-space keccak dan `dmg` unchecked (sebelumnya 102k). Dijaga oleh `test_combat_worstCaseGas` (< 40k).

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
