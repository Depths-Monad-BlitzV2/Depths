// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Encounter, Outcome, Resolution, InvalidFloor} from "./DepthsTypes.sol";

/// @title DepthsLogic
/// @notice Logic gameplay pure. Semua angka berasal dari docs/GAME_DESIGN.md dan di-mirror 1:1 di
///         packages/game-logic. Ubah keduanya bersamaan lalu regenerate test vectors.
/// @dev Index draw RNG per seed:
///      encounter: 0 = tipe, 1 = monsterId
///      combat:    0 = flee/mimic/trap roll, 1 = loot treasure, mulai 1 = serangan combat
library DepthsLogic {
    uint256 internal constant MMON = 1e15;
    uint256 internal constant CMON = 1e16; // 0.01 MON, satuan tabel loot

    uint8 internal constant MAX_FLOOR = 20;
    uint16 internal constant BASE_HP = 100;
    uint16 internal constant BASE_ATK = 12;
    uint256 internal constant MAX_ROUNDS = 64;
    uint16 internal constant POTION_HEAL = 50;

    // Merchant, GAME_DESIGN §7
    uint256 internal constant SWORD_PRICE = 400 * MMON;
    uint256 internal constant SHIELD_PRICE = 400 * MMON;
    uint256 internal constant POTION_PRICE = 200 * MMON;
    uint256 internal constant MAX_SWORDS = 5;
    uint256 internal constant MAX_SHIELDS = 5;
    uint256 internal constant MAX_POTIONS = 3;
    uint16 internal constant SWORD_ATK = 10;
    uint16 internal constant SHIELD_HP = 20;

    // Tabel monster floor 1..20, 12 bit per floor (bit (floor-1)*12). Lihat GAME_DESIGN §4.1.
    uint256 private constant HP_TABLE = 0x3292c02642141cf19215e1301090e60c80aa09107806405004103402801e;
    uint256 private constant ATK_TABLE = 0x7c06f06305804f04603f03803202d02802201d01801300f00c009007005;
    uint256 private constant LOOT_TABLE = 0x6525804c842839e3242bc2602121cc1901400f00b408c06403c02801e014; // cMON

    /// @notice Stat monster untuk satu floor.
    /// @return hp HP monster
    /// @return atk ATK monster
    /// @return loot loot tabel dalam wei (sebelum cap pool)
    function monster(uint8 floor) internal pure returns (uint16 hp, uint16 atk, uint128 loot) {
        if (floor == 0 || floor > MAX_FLOOR) revert InvalidFloor();
        uint256 shift = uint256(floor - 1) * 12;
        hp = uint16((HP_TABLE >> shift) & 0xfff);
        atk = uint16((ATK_TABLE >> shift) & 0xfff);
        loot = uint128(((LOOT_TABLE >> shift) & 0xfff) * CMON);
    }

    /// @notice Draw RNG ke-`i` dari sebuah seed: `uint256(keccak256(abi.encode(seed, i)))`.
    /// @dev Pakai scratch space 0x00–0x3f supaya tidak alokasi memory per draw (combat bisa 129 draw).
    function rand(bytes32 seed, uint256 i) internal pure returns (uint256 r) {
        assembly ("memory-safe") {
            mstore(0x00, seed)
            mstore(0x20, i)
            r := keccak256(0x00, 0x40)
        }
    }

    /// @notice Damage dengan variasi 80%–120%, minimal 1.
    /// @dev `atk` selalu berasal dari uint16, jadi perkalian unchecked tidak bisa overflow.
    function dmg(uint256 atk, uint256 r) internal pure returns (uint256 d) {
        unchecked {
            d = atk * (80 + r % 41) / 100;
        }
        if (d == 0) d = 1;
    }

    /// @notice Tier monster: 0 = floor 1–3, 1 = 4–6, 2 = 7–10, 3 = 11–20.
    function tierOf(uint8 floor) internal pure returns (uint8) {
        if (floor <= 3) return 0;
        if (floor <= 6) return 1;
        if (floor <= 10) return 2;
        return 3;
    }

    /// @notice Roll encounter lantai. `monsterId = tier * 4 + rand(1) % 4` (kosmetik, selalu dihitung).
    function rollEncounter(bytes32 seed, uint8 floor) internal pure returns (Encounter enc, uint8 monsterId) {
        uint256 r = rand(seed, 0) % 100;
        if (r < 40) enc = Encounter.MONSTER;
        else if (r < 65) enc = Encounter.TREASURE;
        else if (r < 80) enc = Encounter.TRAP;
        else enc = Encounter.MERCHANT;
        monsterId = tierOf(floor) * 4 + uint8(rand(seed, 1) % 4);
    }

    /// @notice Peluang flee sukses dalam persen: max(20, 60 − 4 × floor).
    function fleeChance(uint8 floor) internal pure returns (uint256) {
        uint256 dec = uint256(floor) * 4;
        return dec >= 40 ? 20 : 60 - dec;
    }

    /// @notice Combat deterministik (GAME_DESIGN §4.3). Draw serangan mulai index 1.
    /// @return win true kalau monster mati sebelum player dan sebelum MAX_ROUNDS
    /// @return hpAfter HP player setelah combat (0 kalau kalah)
    function resolveCombat(
        bytes32 seed,
        uint16 playerHp,
        uint16 playerAtk,
        uint16 monsterHp,
        uint16 monsterAtk,
        bool monsterFirst
    ) internal pure returns (bool win, uint16 hpAfter) {
        // unchecked aman: atk, HP ≤ 65535 sehingga dmg ≤ 78642 dan HP signed tidak bisa overflow
        unchecked {
            int256 ph = int256(uint256(playerHp));
            int256 mh = int256(uint256(monsterHp));
            uint256 i = 1;
            if (monsterFirst) {
                ph -= int256(dmg(monsterAtk, rand(seed, i++)));
                if (ph <= 0) return (false, 0);
            }
            for (uint256 round; round < MAX_ROUNDS; ++round) {
                mh -= int256(dmg(playerAtk, rand(seed, i++)));
                if (mh <= 0) return (true, uint16(uint256(ph)));
                ph -= int256(dmg(monsterAtk, rand(seed, i++)));
                if (ph <= 0) return (false, 0);
            }
            return (false, 0);
        }
    }

    /// @notice Resolusi encounter monster dengan aksi FIGHT atau FLEE.
    function resolveMonster(bytes32 seed, uint8 floor, uint16 hp, uint16 atk, bool flee)
        internal
        pure
        returns (Resolution memory res)
    {
        (uint16 mHp, uint16 mAtk, uint128 loot) = monster(floor);
        if (flee) {
            if (rand(seed, 0) % 100 < fleeChance(floor)) {
                return Resolution(Outcome.FLED, true, hp, 0, 0);
            }
            (bool w, uint16 h) = resolveCombat(seed, hp, atk, mHp, mAtk, true);
            return w
                ? Resolution(Outcome.FLEE_FAIL_WIN, true, h, loot, 0)
                : Resolution(Outcome.FLEE_FAIL_KILLED, false, 0, 0, 0);
        }
        (bool won, uint16 hpAfter) = resolveCombat(seed, hp, atk, mHp, mAtk, false);
        return won ? Resolution(Outcome.WIN, true, hpAfter, loot, 0) : Resolution(Outcome.KILLED, false, 0, 0, 0);
    }

    /// @notice Resolusi OPEN treasure. 5% mimic: stat floor+2 (maks 20), loot 2× loot tabel floor ini.
    ///         Bukan mimic: (10 + rand(1) % 41) × 20 mMON.
    function resolveTreasure(bytes32 seed, uint8 floor, uint16 hp, uint16 atk)
        internal
        pure
        returns (Resolution memory res)
    {
        if (rand(seed, 0) % 100 < 5) {
            uint8 mf = floor + 2 > MAX_FLOOR ? MAX_FLOOR : floor + 2;
            (uint16 mHp, uint16 mAtk,) = monster(mf);
            (,, uint128 loot) = monster(floor);
            (bool w, uint16 h) = resolveCombat(seed, hp, atk, mHp, mAtk, false);
            return w
                ? Resolution(Outcome.MIMIC_WIN, true, h, loot * 2, 0)
                : Resolution(Outcome.MIMIC_KILLED, false, 0, 0, 0);
        }
        uint128 amount = uint128((10 + rand(seed, 1) % 41) * 20 * MMON); // 200–1000 mMON
        return Resolution(Outcome.TREASURE, true, hp, amount, 0);
    }

    /// @notice Resolusi trap. PROCEED tidak pernah fatal; DISARM gagal bisa fatal.
    function resolveTrap(bytes32 seed, uint8 floor, uint16 hp, uint128 bag, bool disarm)
        internal
        pure
        returns (Resolution memory res)
    {
        uint256 r = rand(seed, 0) % 100;
        uint256 base = 10 + 3 * uint256(floor);
        if (disarm) {
            if (r < 50) return Resolution(Outcome.DISARM_OK, true, hp, uint128(100 * uint256(floor) * MMON), 0);
            uint256 loss = 2 * base;
            if (loss >= hp) return Resolution(Outcome.DISARM_FAIL, false, 0, 0, 0);
            return Resolution(Outcome.DISARM_FAIL, true, uint16(hp - loss), 0, 0);
        }
        if (r < 60 || bag == 0) {
            uint16 after_ = base >= hp ? 1 : uint16(hp - base);
            return Resolution(Outcome.TRAP_HP, true, after_, 0, 0);
        }
        return Resolution(Outcome.TRAP_LOOT, true, hp, 0, bag / 5);
    }
}
