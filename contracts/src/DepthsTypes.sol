// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Tipe, event, dan error bersama Depths. Lihat docs/CONTRACT_SPEC.md §2, §5, §6.

enum RunState {
    NONE,
    AWAIT_REVEAL,
    AWAIT_ACTION,
    AWAIT_SETTLE,
    FLOOR_CLEARED
}

enum Encounter {
    NONE,
    MONSTER,
    TREASURE,
    TRAP,
    MERCHANT
}

enum Action {
    NONE,
    FIGHT,
    FLEE,
    OPEN,
    LEAVE,
    PROCEED,
    DISARM,
    BUY
}

/// @dev Nilai numerik = `outcomeCode` di event FloorResolved.
enum Outcome {
    NONE,
    WIN, // 1
    FLED, // 2
    FLEE_FAIL_WIN, // 3
    TREASURE, // 4
    MIMIC_WIN, // 5
    TRAP_HP, // 6
    TRAP_LOOT, // 7
    DISARM_OK, // 8
    DISARM_FAIL, // 9 (survived = false kalau HP habis)
    LEAVE, // 10
    BUY, // 11
    KILLED, // 12
    FLEE_FAIL_KILLED, // 13
    MIMIC_KILLED // 14
}

/// @dev Penyebab di event RunDied.
enum DeathCause {
    NONE,
    KILLED, // 1
    EXPIRED, // 2
    TRAP // 3
}

struct Run {
    // slot 0
    address operator;
    uint32 runId;
    uint8 state; // RunState
    uint8 floor;
    uint8 encounter; // Encounter
    uint8 pendingAction; // Action
    uint8 swords;
    uint8 shields;
    uint8 potions;
    // slot 1
    bool usePotion;
    uint16 hp;
    uint16 maxHp;
    uint16 atk;
    uint8 monsterId; // kosmetik
    uint64 targetBlock;
    uint128 bag; // wei
    // slot 2
    bytes32 encounterSeed;
}

struct PlayerStats {
    uint32 runs;
    uint8 bestFloor;
    uint128 totalCashedOut;
    uint128 totalLost;
}

struct BoardEntry {
    address player;
    uint128 value;
    uint8 floor;
    uint32 runId;
}

/// @dev Hasil resolusi pure dari DepthsLogic. Depths.sol yang menerapkan cap pool ke `lootTable`.
struct Resolution {
    Outcome outcome;
    bool survived;
    uint16 hpAfter;
    uint128 lootTable; // loot sebelum cap MAX_AWARD_BPS (wei)
    uint128 bagLoss; // bag yang pindah ke pool (wei)
}

event RunStarted(address indexed owner, uint32 indexed runId, address operator, uint128 entryFee);
event FloorEntered(address indexed owner, uint32 indexed runId, uint8 floor, uint64 targetBlock);
event EncounterRevealed(
    address indexed owner, uint32 indexed runId, uint8 floor, Encounter enc, uint8 monsterId, bytes32 seed
);
event ActionCommitted(
    address indexed owner, uint32 indexed runId, uint8 floor, Action action, bool usePotion, uint64 targetBlock
);
event ItemsBought(
    address indexed owner, uint32 indexed runId, uint8 swords, uint8 shields, uint8 potions, uint128 cost
);
event FloorResolved(
    address indexed owner,
    uint32 indexed runId,
    uint8 floor,
    Action action,
    bytes32 resolveSeed,
    bool survived,
    uint16 hpAfter,
    int128 bagDelta,
    uint8 outcomeCode
);
event LootAwarded(address indexed owner, uint32 indexed runId, uint128 amount, uint128 tableAmount);
event CashedOut(address indexed owner, uint32 indexed runId, uint8 floor, uint128 amount);
event RunDied(address indexed owner, uint32 indexed runId, uint8 floor, uint128 lostBag, uint8 cause);
event PoolChanged(uint128 pool, uint128 reserved);

error NotRunController();
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
error InvalidFloor();
