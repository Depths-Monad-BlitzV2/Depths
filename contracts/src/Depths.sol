// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
// Transient (EIP-1153): guard storage biasa memakai slot ERC-7201 di page sendiri (+8.1k cold page di Monad).
// TSTORE/TLOAD terverifikasi di Monad testnet lewat eth_call (lihat docs/SPIKE_RESULTS.md).
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {DepthsLogic} from "./DepthsLogic.sol";
import {IDepths} from "./interfaces/IDepths.sol";
import "./DepthsTypes.sol";

/// @title Depths
/// @notice On-chain roguelike: bayar entry, turun lantai, CASH OUT atau GO DEEPER. Mati = bag masuk pool.
/// @dev State, akses, dan uang saja. Gameplay ada di DepthsLogic (pure). Randomness: commit
///      `targetBlock = block.number + 1`, lalu reveal/settle di tx berikutnya (ARCHITECTURE §4.2).
///      Invariant: `address(this).balance >= pool + reserved + treasury`, `reserved == Σ bag run aktif`.
contract Depths is IDepths, Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeCast for uint256;

    uint256 public constant RAKE_BPS = 500;
    uint256 public constant MAX_AWARD_BPS = 500;
    uint8 public constant MAX_FLOOR = DepthsLogic.MAX_FLOOR;
    uint16 public constant BASE_HP = DepthsLogic.BASE_HP;
    uint16 public constant BASE_ATK = DepthsLogic.BASE_ATK;
    uint256 public constant BLOCKHASH_WINDOW = 256;
    uint256 public constant MAX_GAS_TOPUP = 0.5 ether;
    uint256 public constant MAX_ROUNDS = DepthsLogic.MAX_ROUNDS;
    uint8 public constant PURPOSE_ENCOUNTER = 1;
    uint8 public constant PURPOSE_RESOLVE = 2;
    uint128 public constant MIN_ENTRY_FEE = 0.2 ether;
    uint128 public constant MAX_ENTRY_FEE = 20 ether;
    uint256 private constant BOARD_SIZE = 10;

    /// @dev Run yang selesai hanya di-set `state = NONE, bag = 0`; slot lain dibiarkan supaya run berikutnya
    ///      menulis non-zero → non-zero (2.9k) bukan 0 → non-zero (20k). Monad menagih gas limit, jadi refund
    ///      dari `delete` tidak membantu. `getRun` mengembalikan struct kosong untuk state NONE.
    mapping(address owner => Run) internal _runs;
    /// @dev Session key → owner, bisa basi setelah run selesai. Selalu baca lewat `operatorOf()`.
    mapping(address operator => address owner) internal _operatorOf;
    mapping(address => PlayerStats) public stats;
    /// @dev Diurutkan desc berdasarkan value (cash out terbesar).
    BoardEntry[10] internal _topCashouts;
    /// @dev Diurutkan desc berdasarkan floor, tie → value. Memuat run yang cash out maupun mati.
    BoardEntry[10] internal _topDepths;

    uint128 public pool;
    uint128 public reserved;
    uint128 public treasury;
    uint128 public entryFee = 1 ether;
    uint32 public nextRunId = 1;
    /// @dev Jumlah entry terisi per board (satu slot dengan nextRunId), supaya slot kosong tidak dipindai/digeser.
    uint8 internal _cashLen;
    uint8 internal _depthLen;

    /// @param initialOwner pemilik admin (Ownable2Step)
    /// @dev `msg.value` (opsional) langsung menjadi seed pool.
    constructor(address initialOwner) payable Ownable(initialOwner) {
        if (msg.value != 0) {
            pool = msg.value.toUint128();
            emit PoolChanged(pool, 0);
        }
    }

    // ================================================================ player / operator

    /// @notice Mulai run baru. `msg.value = entryFee + gasTopUp`; top-up diteruskan ke `operator`.
    /// @param operator session key yang boleh memainkan run ini (boleh address(0) = main wallet saja)
    function enterDungeon(address operator) external payable nonReentrant whenNotPaused {
        Run storage r = _runs[msg.sender];
        if (r.state != uint8(RunState.NONE)) revert WrongState(RunState.NONE, RunState(r.state));
        if (operatorOf(msg.sender) != address(0)) revert OperatorInUse();
        uint128 fee = entryFee;
        if (msg.value < fee) revert InsufficientFee();
        uint256 topUp = msg.value - fee;
        if (topUp > MAX_GAS_TOPUP) revert TopUpTooLarge();
        if (operator != address(0)) {
            if (operatorOf(operator) != address(0) || _runs[operator].state != uint8(RunState.NONE)) {
                revert OperatorInUse();
            }
            // session key biasanya dipakai ulang per owner, jadi ini sering menulis nilai yang sama
            _operatorOf[operator] = msg.sender;
        } else if (topUp != 0) {
            revert TopUpTooLarge();
        }

        uint128 rake = uint128(uint256(fee) * RAKE_BPS / 1e4);
        treasury += rake;
        pool += fee - rake;

        uint32 runId = nextRunId++;
        uint64 target = uint64(block.number + 1);
        // slot 0 dan 1 ditulis penuh; encounterSeed (slot 2) sengaja tidak disentuh dan baru valid setelah reveal
        r.operator = operator;
        r.runId = runId;
        r.state = uint8(RunState.AWAIT_REVEAL);
        r.floor = 1;
        r.encounter = 0;
        r.pendingAction = 0;
        r.swords = 0;
        r.shields = 0;
        r.potions = 0;
        r.usePotion = false;
        r.hp = BASE_HP;
        r.maxHp = BASE_HP;
        r.atk = BASE_ATK;
        r.monsterId = 0;
        r.targetBlock = target;
        r.bag = 0;
        stats[msg.sender].runs++;

        emit RunStarted(msg.sender, runId, operator, fee);
        emit FloorEntered(msg.sender, runId, 1, target);
        emit PoolChanged(pool, reserved);

        if (topUp != 0) _send(operator, topUp);
    }

    /// @notice Pilih aksi untuk encounter lantai ini. Di AWAIT_REVEAL, encounter di-reveal dulu.
    /// @dev BUY/LEAVE instan → FLOOR_CLEARED. Aksi lain di-commit → AWAIT_SETTLE.
    ///      Reveal expired → run mati tanpa revert.
    function act(Action a, uint8 swordQty, uint8 shieldQty, uint8 potionQty, bool usePotion) external {
        (address owner, Run storage r) = _controlled();
        RunState s = RunState(r.state);
        if (s == RunState.AWAIT_REVEAL) {
            if (!_reveal(owner, r)) return;
        } else if (s != RunState.AWAIT_ACTION) {
            revert WrongState(RunState.AWAIT_ACTION, s);
        }
        if (!_validAction(Encounter(r.encounter), a)) revert InvalidAction();
        if (a != Action.BUY && (swordQty | shieldQty | potionQty) != 0) revert InvalidAction();

        if (a == Action.BUY || a == Action.LEAVE) {
            if (usePotion) revert InvalidAction();
            if (a == Action.BUY) {
                _buy(owner, r, swordQty, shieldQty, potionQty);
            } else {
                emit FloorResolved(owner, r.runId, r.floor, a, bytes32(0), true, r.hp, 0, uint8(Outcome.LEAVE));
            }
            r.state = uint8(RunState.FLOOR_CLEARED);
            return;
        }

        if (usePotion && r.potions == 0) revert NoPotion();
        uint64 target = uint64(block.number + 1);
        r.pendingAction = uint8(a);
        r.usePotion = usePotion;
        r.targetBlock = target;
        r.state = uint8(RunState.AWAIT_SETTLE);
        emit ActionCommitted(owner, r.runId, r.floor, a, usePotion, target);
    }

    /// @notice GO DEEPER. Di AWAIT_SETTLE, hasil lantai ini di-settle dulu (mati → selesai, tidak revert).
    function descend() external {
        (address owner, Run storage r) = _controlled();
        RunState s = RunState(r.state);
        if (s != RunState.FLOOR_CLEARED && s != RunState.AWAIT_SETTLE) {
            revert WrongState(RunState.FLOOR_CLEARED, s);
        }
        if (r.floor >= MAX_FLOOR) revert MaxFloorReached();
        if (s == RunState.AWAIT_SETTLE && !_settle(owner, r)) return;

        uint8 floor = r.floor + 1;
        uint64 target = uint64(block.number + 1);
        r.floor = floor;
        r.encounter = 0;
        r.monsterId = 0;
        r.targetBlock = target;
        r.state = uint8(RunState.AWAIT_REVEAL);
        emit FloorEntered(owner, r.runId, floor, target);
    }

    /// @notice CASH OUT. Bag selalu dikirim ke owner, tidak pernah ke operator.
    /// @dev Di AWAIT_SETTLE, hasil lantai ini di-settle dulu (mati → selesai, tidak revert).
    function cashOut() external nonReentrant {
        (address owner, Run storage r) = _controlled();
        RunState s = RunState(r.state);
        if (s == RunState.AWAIT_SETTLE) {
            if (!_settle(owner, r)) return; // mati: tidak ada payout, tidak revert
        } else if (s != RunState.FLOOR_CLEARED) {
            revert WrongState(RunState.FLOOR_CLEARED, s);
        }
        _cashOut(owner, r);
    }

    /// @notice Operator melepas tautannya ke run owner (mis. untuk ganti session key).
    function withdrawOperator() external {
        address owner = operatorOf(msg.sender);
        if (owner == address(0)) revert NotRunController();
        delete _operatorOf[msg.sender];
        _runs[owner].operator = address(0);
    }

    // ================================================================ relay fallback

    /// @notice Kunci encounter lantai ini (siapa saja). Expired → run mati.
    function reveal(address owner) external {
        Run storage r = _runs[owner];
        if (r.state != uint8(RunState.AWAIT_REVEAL)) revert WrongState(RunState.AWAIT_REVEAL, RunState(r.state));
        _reveal(owner, r);
    }

    /// @notice Kunci hasil aksi lantai ini (siapa saja). Expired → run mati. Floor 20 → auto cash out.
    function settle(address owner) external nonReentrant {
        Run storage r = _runs[owner];
        if (r.state != uint8(RunState.AWAIT_SETTLE)) revert WrongState(RunState.AWAIT_SETTLE, RunState(r.state));
        if (_settle(owner, r) && r.floor == MAX_FLOOR) _cashOut(owner, r);
    }

    /// @notice Bersihkan run yang sudah lewat window blockhash (siapa saja).
    function reapExpired(address owner) external {
        Run storage r = _runs[owner];
        RunState s = RunState(r.state);
        if (s != RunState.AWAIT_REVEAL && s != RunState.AWAIT_SETTLE) revert WrongState(RunState.AWAIT_REVEAL, s);
        if (!_expired(r)) revert TooEarly(uint64(r.targetBlock + BLOCKHASH_WINDOW), block.number);
        _die(owner, r, DeathCause.EXPIRED);
    }

    // ================================================================ admin

    /// @notice Tambah dana pool. Siapa saja boleh.
    function seedPool() external payable {
        pool += msg.value.toUint128();
        emit PoolChanged(pool, reserved);
    }

    /// @notice Ubah entry fee (0.2–20 MON). Run aktif tidak terpengaruh.
    function setEntryFee(uint128 fee) external onlyOwner {
        if (fee < MIN_ENTRY_FEE || fee > MAX_ENTRY_FEE) revert InvalidFee();
        entryFee = fee;
        emit EntryFeeSet(fee);
    }

    /// @notice Tarik rake. Hanya dari bucket `treasury`; pool dan reserved tidak bisa ditarik.
    function withdrawTreasury(address to, uint128 amt) external nonReentrant onlyOwner {
        if (amt > treasury) revert InsufficientTreasury();
        treasury -= amt;
        emit TreasuryWithdrawn(to, amt);
        _send(to, amt);
    }

    /// @notice Blokir `enterDungeon`. Run aktif tetap bisa jalan sampai selesai.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Buka kembali `enterDungeon`.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ================================================================ view

    /// @notice State run owner (kosong kalau tidak ada run aktif).
    function getRun(address owner) external view returns (Run memory r) {
        if (_runs[owner].state != uint8(RunState.NONE)) r = _runs[owner];
    }

    /// @notice Owner run aktif yang memakai `operator` sebagai session key, atau address(0).
    function operatorOf(address operator) public view returns (address owner) {
        owner = _operatorOf[operator];
        if (owner == address(0)) return owner;
        Run storage r = _runs[owner];
        if (r.state == uint8(RunState.NONE) || r.operator != operator) return address(0);
    }

    /// @notice Owner run yang dikendalikan `caller` (dirinya sendiri atau lewat operator), atau address(0).
    /// @dev Operator (jalur normal) dicek dulu: cukup page `_operatorOf` + page run owner, tanpa membaca
    ///      page run milik operator. Operator aktif tidak mungkin punya run sendiri (dicek di enterDungeon).
    function ownerOf(address caller) public view returns (address) {
        address owner = operatorOf(caller);
        if (owner != address(0)) return owner;
        return _runs[caller].state != uint8(RunState.NONE) ? caller : address(0);
    }

    /// @notice Encounter lantai ini tanpa menyimpan. Di state setelah reveal, mengembalikan yang tersimpan.
    /// @return enc encounter (NONE kalau belum ready / expired / tidak ada run)
    /// @return monsterId id kosmetik
    /// @return ready `block.number > targetBlock` (selalu true kalau sudah tersimpan)
    /// @return expired lewat window blockhash, run akan mati saat disentuh
    function previewEncounter(address owner)
        external
        view
        returns (Encounter enc, uint8 monsterId, bool ready, bool expired)
    {
        Run storage r = _runs[owner];
        RunState s = RunState(r.state);
        if (s == RunState.NONE) return (Encounter.NONE, 0, false, false);
        if (s != RunState.AWAIT_REVEAL) return (Encounter(r.encounter), r.monsterId, true, false);
        ready = block.number > r.targetBlock;
        expired = _expired(r);
        if (ready && !expired) {
            (enc, monsterId) = DepthsLogic.rollEncounter(_seed(r, owner, PURPOSE_ENCOUNTER), r.floor);
        }
    }

    /// @notice Hasil `_settle` tanpa menyimpan (state AWAIT_SETTLE). `res.lootTable` sebelum cap pool.
    function previewResolve(address owner)
        external
        view
        returns (Resolution memory res, bytes32 seed, bool ready, bool expired)
    {
        Run storage r = _runs[owner];
        if (r.state != uint8(RunState.AWAIT_SETTLE)) return (res, seed, false, false);
        ready = block.number > r.targetBlock;
        expired = _expired(r);
        if (ready && !expired) (res, seed) = _computeResolve(owner, r);
    }

    /// @notice Stat monster tabel untuk satu floor (1..20).
    function monsterStats(uint8 floor) external pure returns (uint16 hp, uint16 atk, uint128 loot) {
        return DepthsLogic.monster(floor);
    }

    /// @notice Papan top-10 cash out dan top-10 kedalaman.
    function getBoards() external view returns (BoardEntry[10] memory cashouts, BoardEntry[10] memory depths) {
        return (_topCashouts, _topDepths);
    }

    /// @notice Saldo bucket dan entry fee saat ini.
    function poolInfo() external view returns (uint128, uint128, uint128, uint128) {
        return (pool, reserved, treasury, entryFee);
    }

    // ================================================================ internal: state machine

    function _controlled() internal view returns (address owner, Run storage r) {
        owner = ownerOf(msg.sender);
        if (owner == address(0)) revert NotRunController();
        r = _runs[owner];
    }

    /// @return alive false kalau run mati karena expired
    function _reveal(address owner, Run storage r) internal returns (bool alive) {
        _requireReady(r);
        if (_expired(r)) {
            _die(owner, r, DeathCause.EXPIRED);
            return false;
        }
        bytes32 seed = _seed(r, owner, PURPOSE_ENCOUNTER);
        (Encounter enc, uint8 monsterId) = DepthsLogic.rollEncounter(seed, r.floor);
        r.encounter = uint8(enc);
        r.monsterId = monsterId;
        r.encounterSeed = seed;
        r.state = uint8(RunState.AWAIT_ACTION);
        emit EncounterRevealed(owner, r.runId, r.floor, enc, monsterId, seed);
        return true;
    }

    /// @dev Tidak pernah transfer. Auto cash out floor 20 dilakukan pemanggil (`settle` / `cashOut`), supaya
    ///      setiap fungsi punya satu titik transfer di akhir (CEI).
    /// @return open true kalau run masih hidup di FLOOR_CLEARED (false = mati)
    function _settle(address owner, Run storage r) internal returns (bool open) {
        _requireReady(r);
        if (_expired(r)) {
            _die(owner, r, DeathCause.EXPIRED);
            return false;
        }
        (Resolution memory res, bytes32 seed) = _computeResolve(owner, r);
        Action a = Action(r.pendingAction);
        if (r.usePotion) r.potions--;
        r.pendingAction = 0;
        r.usePotion = false;

        if (!res.survived) {
            emit FloorResolved(owner, r.runId, r.floor, a, seed, false, 0, 0, uint8(res.outcome));
            _die(owner, r, res.outcome == Outcome.DISARM_FAIL ? DeathCause.TRAP : DeathCause.KILLED);
            return false;
        }

        r.hp = res.hpAfter;
        uint128 award = 0;
        if (res.lootTable != 0) {
            uint128 cap = uint128(uint256(pool) * MAX_AWARD_BPS / 1e4);
            award = res.lootTable < cap ? res.lootTable : cap;
            pool -= award;
            reserved += award;
            r.bag += award;
            emit LootAwarded(owner, r.runId, award, res.lootTable);
        }
        if (res.bagLoss != 0) {
            r.bag -= res.bagLoss;
            reserved -= res.bagLoss;
            pool += res.bagLoss;
        }
        emit FloorResolved(
            owner, r.runId, r.floor, a, seed, true, res.hpAfter, int128(award) - int128(res.bagLoss), uint8(res.outcome)
        );
        if (award != 0 || res.bagLoss != 0) emit PoolChanged(pool, reserved);

        r.state = uint8(RunState.FLOOR_CLEARED);
        return true;
    }

    /// @dev Dipakai bersama oleh `_settle` dan `previewResolve`, jadi preview selalu identik dengan hasil.
    function _computeResolve(address owner, Run storage r) internal view returns (Resolution memory res, bytes32 seed) {
        seed = _seed(r, owner, PURPOSE_RESOLVE);
        uint16 hp = r.hp;
        if (r.usePotion) {
            uint256 healed = uint256(hp) + DepthsLogic.POTION_HEAL;
            hp = healed > r.maxHp ? r.maxHp : uint16(healed);
        }
        Action a = Action(r.pendingAction);
        uint8 floor = r.floor;
        if (a == Action.FIGHT || a == Action.FLEE) {
            res = DepthsLogic.resolveMonster(seed, floor, hp, r.atk, a == Action.FLEE);
        } else if (a == Action.OPEN) {
            res = DepthsLogic.resolveTreasure(seed, floor, hp, r.atk);
        } else {
            res = DepthsLogic.resolveTrap(seed, floor, hp, r.bag, a == Action.DISARM);
        }
    }

    function _buy(address owner, Run storage r, uint8 swordQty, uint8 shieldQty, uint8 potionQty) internal {
        uint256 swords = uint256(r.swords) + swordQty;
        uint256 shields = uint256(r.shields) + shieldQty;
        uint256 potions = uint256(r.potions) + potionQty;
        if (swords > DepthsLogic.MAX_SWORDS || shields > DepthsLogic.MAX_SHIELDS || potions > DepthsLogic.MAX_POTIONS) {
            revert ItemLimit();
        }
        uint128 cost = uint128(
            swordQty * DepthsLogic.SWORD_PRICE + shieldQty * DepthsLogic.SHIELD_PRICE + potionQty
                * DepthsLogic.POTION_PRICE
        );
        if (cost > r.bag) revert InsufficientBag();

        r.bag -= cost;
        reserved -= cost;
        pool += cost;
        // batas item di atas menjaga semua nilai jauh di bawah batas uint8/uint16
        r.swords = uint8(swords);
        r.shields = uint8(shields);
        r.potions = uint8(potions);
        r.atk += uint16(swordQty) * DepthsLogic.SWORD_ATK;
        r.maxHp += uint16(shieldQty) * DepthsLogic.SHIELD_HP;
        r.hp += uint16(shieldQty) * DepthsLogic.SHIELD_HP;

        emit ItemsBought(owner, r.runId, swordQty, shieldQty, potionQty, cost);
        emit FloorResolved(
            owner, r.runId, r.floor, Action.BUY, bytes32(0), true, r.hp, -int128(cost), uint8(Outcome.BUY)
        );
        if (cost != 0) emit PoolChanged(pool, reserved);
    }

    /// @dev Bag masuk pool, run dan tautan operator dihapus. Tidak ada transfer.
    function _die(address owner, Run storage r, DeathCause cause) internal {
        uint128 bag = r.bag;
        uint8 floor = r.floor;
        uint32 runId = r.runId;
        reserved -= bag;
        pool += bag;

        PlayerStats storage st = stats[owner];
        st.totalLost += bag;
        if (floor > st.bestFloor) st.bestFloor = floor;
        _depthLen = _insert(_topDepths, _depthLen, BoardEntry(owner, bag, floor, runId), true);

        _clear(r);
        emit RunDied(owner, runId, floor, bag, uint8(cause));
        emit PoolChanged(pool, reserved);
    }

    /// @dev CEI: semua state diubah dulu, baru transfer ke owner.
    function _cashOut(address owner, Run storage r) internal {
        uint128 amount = r.bag;
        uint8 floor = r.floor;
        uint32 runId = r.runId;
        reserved -= amount;

        PlayerStats storage st = stats[owner];
        st.totalCashedOut += amount;
        if (floor > st.bestFloor) st.bestFloor = floor;
        BoardEntry memory e = BoardEntry(owner, amount, floor, runId);
        if (amount != 0) _cashLen = _insert(_topCashouts, _cashLen, e, false);
        _depthLen = _insert(_topDepths, _depthLen, e, true);

        _clear(r);
        emit CashedOut(owner, runId, floor, amount);
        emit PoolChanged(pool, reserved);

        if (amount != 0) _send(owner, amount);
    }

    /// @dev Tutup run. Tautan operator otomatis tidak berlaku karena `operatorOf()` mengecek state run.
    function _clear(Run storage r) internal {
        r.state = uint8(RunState.NONE);
        r.bag = 0;
    }

    // ================================================================ internal: helpers

    function _validAction(Encounter enc, Action a) internal pure returns (bool) {
        if (enc == Encounter.MONSTER) return a == Action.FIGHT || a == Action.FLEE;
        if (enc == Encounter.TREASURE) return a == Action.OPEN || a == Action.LEAVE;
        if (enc == Encounter.TRAP) return a == Action.PROCEED || a == Action.DISARM;
        if (enc == Encounter.MERCHANT) return a == Action.BUY || a == Action.LEAVE;
        return false;
    }

    function _requireReady(Run storage r) internal view {
        uint64 target = r.targetBlock;
        if (block.number <= target) revert TooEarly(target, block.number);
    }

    function _expired(Run storage r) internal view returns (bool) {
        return block.number > uint256(r.targetBlock) + BLOCKHASH_WINDOW;
    }

    /// @dev Panggil hanya setelah `_requireReady` dan cek expiry.
    function _seed(Run storage r, address owner, uint8 purpose) internal view returns (bytes32) {
        bytes32 bh = blockhash(r.targetBlock);
        if (bh == bytes32(0)) revert BlockhashUnavailable();
        return keccak256(abi.encode(bh, owner, r.runId, r.floor, purpose));
    }

    /// @dev Insertion sort desc atas `len` entry terisi (selalu rapat di depan). Tie → entry lama tetap di atas.
    ///      Board penuh dan entry baru tidak lebih baik dari entry terakhir → hanya 1 SLOAD.
    /// @return panjang board yang baru
    function _insert(BoardEntry[10] storage board, uint8 len, BoardEntry memory e, bool byFloor)
        internal
        returns (uint8)
    {
        uint256 i = len;
        while (i > 0 && _better(e, board[i - 1], byFloor)) --i;
        if (i == BOARD_SIZE) return len;
        uint256 last = len == BOARD_SIZE ? BOARD_SIZE - 1 : len;
        for (uint256 j = last; j > i; --j) {
            board[j] = board[j - 1];
        }
        board[i] = e;
        return len == BOARD_SIZE ? len : len + 1;
    }

    function _better(BoardEntry memory a, BoardEntry storage b, bool byFloor) internal view returns (bool) {
        if (!byFloor) return a.value > b.value;
        uint8 bf = b.floor;
        return a.floor > bf || (a.floor == bf && a.value > b.value);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
