// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DepthsLogic} from "../src/DepthsLogic.sol";
import {Encounter, Outcome, Resolution, InvalidFloor} from "../src/DepthsTypes.sol";

/// @dev Fungsi library internal dibungkus supaya revert bisa ditangkap vm.expectRevert.
contract LogicHarness {
    function monster(uint8 floor) external pure returns (uint16, uint16, uint128) {
        return DepthsLogic.monster(floor);
    }
}

contract DepthsLogicTest is Test {
    uint256 constant MMON = 1e15;
    LogicHarness harness = new LogicHarness();

    // GAME_DESIGN §4.1
    uint16[20] HP = [30, 40, 52, 65, 80, 100, 120, 145, 170, 200, 230, 265, 304, 350, 402, 463, 532, 612, 704, 809];
    uint16[20] ATK = [5, 7, 9, 12, 15, 19, 24, 29, 34, 40, 45, 50, 56, 63, 70, 79, 88, 99, 111, 124];
    uint16[20] LOOT = [10, 15, 20, 30, 50, 70, 90, 120, 160, 200, 230, 265, 304, 350, 402, 463, 532, 612, 704, 809];

    // ---------------------------------------------------------------- tabel

    function test_monsterTable_allRows() public view {
        for (uint8 f = 1; f <= 20; ++f) {
            (uint16 hp, uint16 atk, uint128 loot) = DepthsLogic.monster(f);
            assertEq(hp, HP[f - 1], "hp");
            assertEq(atk, ATK[f - 1], "atk");
            assertEq(loot, uint128(LOOT[f - 1]) * MMON, "loot");
        }
    }

    function test_monster_revertsOutOfRange() public {
        vm.expectRevert(InvalidFloor.selector);
        harness.monster(0);
        vm.expectRevert(InvalidFloor.selector);
        harness.monster(21);
    }

    // ---------------------------------------------------------------- dmg / rand

    function test_dmg_range() public pure {
        assertEq(DepthsLogic.dmg(100, 0), 80);
        assertEq(DepthsLogic.dmg(100, 40), 120);
        assertEq(DepthsLogic.dmg(100, 41), 80, "r % 41 wrap");
        assertEq(DepthsLogic.dmg(12, 20), 12);
    }

    function test_dmg_minimumOne() public pure {
        assertEq(DepthsLogic.dmg(0, 0), 1);
        assertEq(DepthsLogic.dmg(1, 0), 1);
        assertEq(DepthsLogic.dmg(1, 40), 1);
    }

    function testFuzz_dmg_bounds(uint16 atk, uint256 r) public pure {
        uint256 d = DepthsLogic.dmg(atk, r);
        assertGe(d, 1);
        assertGe(d, uint256(atk) * 80 / 100);
        assertLe(d, atk == 0 ? 1 : uint256(atk) * 120 / 100);
    }

    function testFuzz_rand_matchesAbiEncode(bytes32 seed, uint256 i) public pure {
        assertEq(DepthsLogic.rand(seed, i), uint256(keccak256(abi.encode(seed, i))));
    }

    // ---------------------------------------------------------------- encounter / flee

    function test_tierOf_boundaries() public pure {
        assertEq(DepthsLogic.tierOf(1), 0);
        assertEq(DepthsLogic.tierOf(3), 0);
        assertEq(DepthsLogic.tierOf(4), 1);
        assertEq(DepthsLogic.tierOf(6), 1);
        assertEq(DepthsLogic.tierOf(7), 2);
        assertEq(DepthsLogic.tierOf(10), 2);
        assertEq(DepthsLogic.tierOf(11), 3);
        assertEq(DepthsLogic.tierOf(20), 3);
    }

    function testFuzz_rollEncounter(bytes32 seed, uint8 floor) public pure {
        floor = uint8(bound(floor, 1, 20));
        (Encounter enc, uint8 monsterId) = DepthsLogic.rollEncounter(seed, floor);
        uint256 r = DepthsLogic.rand(seed, 0) % 100;
        Encounter expected = r < 40
            ? Encounter.MONSTER
            : r < 65 ? Encounter.TREASURE : r < 80 ? Encounter.TRAP : Encounter.MERCHANT;
        assertEq(uint8(enc), uint8(expected));
        assertEq(monsterId / 4, DepthsLogic.tierOf(floor));
    }

    function test_fleeChance() public pure {
        assertEq(DepthsLogic.fleeChance(1), 56);
        assertEq(DepthsLogic.fleeChance(5), 40);
        assertEq(DepthsLogic.fleeChance(9), 24);
        assertEq(DepthsLogic.fleeChance(10), 20);
        assertEq(DepthsLogic.fleeChance(20), 20);
    }

    // ---------------------------------------------------------------- combat

    function test_combat_oneShotKeepsHp() public pure {
        (bool win, uint16 hp) = DepthsLogic.resolveCombat(keccak256("a"), 77, 1000, 30, 5, false);
        assertTrue(win);
        assertEq(hp, 77);
    }

    function test_combat_monsterFirstCanKill() public pure {
        (bool win, uint16 hp) = DepthsLogic.resolveCombat(keccak256("b"), 1, 1000, 30, 5, true);
        assertFalse(win);
        assertEq(hp, 0);
    }

    function test_combat_roundLimitIsDeath() public pure {
        // dmg selalu 1 per serangan: monster 809 HP tidak mati dalam 64 round, player 300 HP tidak mati.
        (bool win, uint16 hp) = DepthsLogic.resolveCombat(keccak256("c"), 300, 1, 809, 1, false);
        assertFalse(win);
        assertEq(hp, 0);
    }

    function test_combat_roundLimitBoundary() public pure {
        // Tepat 64 serangan player dengan dmg 1 membunuh monster ber-HP 64 di round terakhir.
        (bool win, uint16 hp) = DepthsLogic.resolveCombat(keccak256("d"), 300, 1, 64, 1, false);
        assertTrue(win);
        assertEq(hp, 300 - 63);
        (win,) = DepthsLogic.resolveCombat(keccak256("d"), 300, 1, 65, 1, false);
        assertFalse(win);
    }

    function testFuzz_combat_hpNeverIncreases(bytes32 seed, uint16 php, uint16 patk, uint8 floor, bool first)
        public
        pure
    {
        floor = uint8(bound(floor, 1, 20));
        php = uint16(bound(php, 1, 1000));
        patk = uint16(bound(patk, 0, 200));
        (uint16 mhp, uint16 matk,) = DepthsLogic.monster(floor);
        (bool win, uint16 hp) = DepthsLogic.resolveCombat(seed, php, patk, mhp, matk, first);
        assertLe(hp, php);
        assertEq(win, hp > 0);
    }

    function test_combat_worstCaseGas() public view {
        uint256 g = gasleft();
        DepthsLogic.resolveCombat(keccak256("gas"), 300, 1, 809, 1, true);
        // 129 draw keccak; plafon supaya settle tetap di bawah target 150k (CONTRACT_SPEC §8)
        assertLt(g - gasleft(), 40_000);
    }

    // ---------------------------------------------------------------- monster

    function testFuzz_resolveMonster_flee(bytes32 seed, uint8 floor, uint16 hp) public pure {
        floor = uint8(bound(floor, 1, 20));
        hp = uint16(bound(hp, 1, 300));
        Resolution memory res = DepthsLogic.resolveMonster(seed, floor, hp, 12, true);
        bool fled = DepthsLogic.rand(seed, 0) % 100 < DepthsLogic.fleeChance(floor);
        if (fled) {
            assertEq(uint8(res.outcome), uint8(Outcome.FLED));
            assertEq(res.hpAfter, hp);
            assertEq(res.lootTable, 0);
        } else {
            assertTrue(res.outcome == Outcome.FLEE_FAIL_WIN || res.outcome == Outcome.FLEE_FAIL_KILLED);
            assertEq(res.survived, res.outcome == Outcome.FLEE_FAIL_WIN);
        }
    }

    function testFuzz_resolveMonster_fightLoot(bytes32 seed, uint8 floor, uint16 hp, uint16 atk) public pure {
        floor = uint8(bound(floor, 1, 20));
        hp = uint16(bound(hp, 1, 300));
        atk = uint16(bound(atk, 12, 62));
        Resolution memory res = DepthsLogic.resolveMonster(seed, floor, hp, atk, false);
        (,, uint128 loot) = DepthsLogic.monster(floor);
        if (res.survived) {
            assertEq(uint8(res.outcome), uint8(Outcome.WIN));
            assertEq(res.lootTable, loot);
        } else {
            assertEq(uint8(res.outcome), uint8(Outcome.KILLED));
            assertEq(res.hpAfter, 0);
        }
    }

    // ---------------------------------------------------------------- treasure

    function testFuzz_resolveTreasure(bytes32 seed, uint8 floor, uint16 hp) public pure {
        floor = uint8(bound(floor, 1, 20));
        hp = uint16(bound(hp, 1, 300));
        Resolution memory res = DepthsLogic.resolveTreasure(seed, floor, hp, 30);
        if (DepthsLogic.rand(seed, 0) % 100 < 5) {
            assertTrue(res.outcome == Outcome.MIMIC_WIN || res.outcome == Outcome.MIMIC_KILLED);
            if (res.survived) {
                (,, uint128 loot) = DepthsLogic.monster(floor);
                assertEq(res.lootTable, loot * 2);
            }
        } else {
            assertEq(uint8(res.outcome), uint8(Outcome.TREASURE));
            assertEq(res.hpAfter, hp);
            assertGe(res.lootTable, 10 * MMON);
            assertLe(res.lootTable, 50 * MMON);
        }
    }

    function test_mimic_statsCappedAtFloor20() public pure {
        // Cari seed mimic, lalu pastikan floor 19 dan 20 sama-sama melawan stat floor 20.
        bytes32 seed;
        for (uint256 k;; ++k) {
            seed = keccak256(abi.encode("mimic", k));
            if (DepthsLogic.rand(seed, 0) % 100 < 5) break;
        }
        (uint16 mhp, uint16 matk,) = DepthsLogic.monster(20);
        (bool w, uint16 h) = DepthsLogic.resolveCombat(seed, 250, 62, mhp, matk, false);
        Resolution memory r19 = DepthsLogic.resolveTreasure(seed, 19, 250, 62);
        Resolution memory r20 = DepthsLogic.resolveTreasure(seed, 20, 250, 62);
        assertEq(r19.survived, w);
        assertEq(r20.survived, w);
        assertEq(r19.hpAfter, h);
        assertEq(r20.hpAfter, h);
    }

    // ---------------------------------------------------------------- trap

    function testFuzz_trapProceed_neverFatal(bytes32 seed, uint8 floor, uint16 hp, uint128 bag) public pure {
        floor = uint8(bound(floor, 1, 20));
        hp = uint16(bound(hp, 1, 300));
        bag = uint128(bound(bag, 0, 100 ether));
        Resolution memory res = DepthsLogic.resolveTrap(seed, floor, hp, bag, false);
        assertTrue(res.survived);
        assertGe(res.hpAfter, 1);
        if (res.outcome == Outcome.TRAP_LOOT) {
            assertEq(res.bagLoss, bag / 5);
            assertEq(res.hpAfter, hp);
        } else {
            assertEq(uint8(res.outcome), uint8(Outcome.TRAP_HP));
            uint256 base = 10 + 3 * uint256(floor);
            assertEq(res.hpAfter, base >= hp ? 1 : hp - base);
        }
    }

    function testFuzz_trapProceed_emptyBagAlwaysHp(bytes32 seed, uint8 floor) public pure {
        floor = uint8(bound(floor, 1, 20));
        Resolution memory res = DepthsLogic.resolveTrap(seed, floor, 100, 0, false);
        assertEq(uint8(res.outcome), uint8(Outcome.TRAP_HP));
        assertEq(res.bagLoss, 0);
    }

    function testFuzz_trapDisarm(bytes32 seed, uint8 floor, uint16 hp) public pure {
        floor = uint8(bound(floor, 1, 20));
        hp = uint16(bound(hp, 1, 300));
        Resolution memory res = DepthsLogic.resolveTrap(seed, floor, hp, 1 ether, true);
        if (res.outcome == Outcome.DISARM_OK) {
            assertEq(res.lootTable, 5 * uint256(floor) * MMON);
            assertEq(res.hpAfter, hp);
        } else {
            assertEq(uint8(res.outcome), uint8(Outcome.DISARM_FAIL));
            uint256 loss = 2 * (10 + 3 * uint256(floor));
            assertEq(res.survived, loss < hp);
            assertEq(res.hpAfter, loss < hp ? hp - loss : 0);
        }
    }
}
