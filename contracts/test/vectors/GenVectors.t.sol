// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DepthsLogic} from "../../src/DepthsLogic.sol";
import {Encounter, Resolution} from "../../src/DepthsTypes.sol";

/// @notice Menulis test vectors ke test/vectors/*.json untuk parity test packages/game-logic.
/// @dev Input diturunkan dari keccak tag + index, jadi output deterministik. Uang (wei) ditulis
///      sebagai string desimal karena melebihi presisi number JSON.
contract GenVectors is Test {
    string constant DIR = "test/vectors/";

    function _x(string memory tag, uint256 k) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(tag, k)));
    }

    function _seed(string memory tag, uint256 k) internal pure returns (bytes32) {
        return keccak256(abi.encode(tag, k, "seed"));
    }

    function _b(bool v) internal pure returns (string memory) {
        return v ? "true" : "false";
    }

    function _q(uint256 v) internal pure returns (string memory) {
        return string.concat('"', vm.toString(v), '"');
    }

    function _join(string[] memory items) internal pure returns (string memory out) {
        for (uint256 k; k < items.length; ++k) {
            out = string.concat(out, k == 0 ? "\n    " : ",\n    ", items[k]);
        }
    }

    function _res(Resolution memory r) internal view returns (string memory) {
        return string.concat(
            '"outcome":',
            vm.toString(uint8(r.outcome)),
            ',"survived":',
            _b(r.survived),
            ',"hpAfter":',
            vm.toString(r.hpAfter),
            ',"lootTable":',
            _q(r.lootTable),
            ',"bagLoss":',
            _q(r.bagLoss)
        );
    }

    function test_generateVectors() public {
        _encounter();
        _combat();
        _treasure();
        _trap();
    }

    function _encounter() internal {
        string[] memory rands = new string[](20);
        for (uint256 k; k < 20; ++k) {
            bytes32 seed = _seed("rand", k);
            uint256 i = _x("rand", k) % 200;
            rands[k] = string.concat(
                '{"seed":"', vm.toString(seed), '","i":', vm.toString(i), ',"value":', _q(DepthsLogic.rand(seed, i)), "}"
            );
        }
        string[] memory cases = new string[](100);
        for (uint256 k; k < 100; ++k) {
            bytes32 seed = _seed("encounter", k);
            uint8 floor = uint8(1 + _x("encounter", k) % 20);
            (Encounter enc, uint8 monsterId) = DepthsLogic.rollEncounter(seed, floor);
            cases[k] = string.concat(
                '{"seed":"',
                vm.toString(seed),
                '","floor":',
                vm.toString(floor),
                ',"enc":',
                vm.toString(uint8(enc)),
                ',"monsterId":',
                vm.toString(monsterId),
                "}"
            );
        }
        vm.writeFile(
            string.concat(DIR, "encounter.json"),
            string.concat('{\n  "rand": [', _join(rands), '\n  ],\n  "cases": [', _join(cases), "\n  ]\n}\n")
        );
    }

    function _combat() internal {
        // 100 combat acak + 4 edge case; 60 resolusi monster (fight/flee)
        string[] memory cases = new string[](104);
        for (uint256 k; k < 104; ++k) {
            bytes32 seed = _seed("combat", k);
            uint256 x = _x("combat", k);
            uint16 php;
            uint16 patk;
            uint16 mhp;
            uint16 matk;
            bool first;
            if (k < 100) {
                (mhp, matk,) = DepthsLogic.monster(uint8(1 + x % 20));
                php = uint16(1 + (x >> 8) % 300);
                patk = uint16(12 + 10 * ((x >> 16) % 6) + (x >> 24) % 5);
                first = (x >> 32) & 1 == 1;
            } else if (k == 100) {
                (php, patk, mhp, matk, first) = (300, 1, 809, 1, false); // round limit
            } else if (k == 101) {
                (php, patk, mhp, matk, first) = (300, 1, 64, 1, false); // menang di round terakhir
            } else if (k == 102) {
                (php, patk, mhp, matk, first) = (1, 1000, 30, 5, true); // mati sebelum menyerang
            } else {
                (php, patk, mhp, matk, first) = (50, 0, 30, 0, false); // atk 0 → dmg 1
            }
            (bool win, uint16 hpAfter) = DepthsLogic.resolveCombat(seed, php, patk, mhp, matk, first);
            cases[k] = string.concat(
                string.concat(
                    '{"seed":"',
                    vm.toString(seed),
                    '","playerHp":',
                    vm.toString(php),
                    ',"playerAtk":',
                    vm.toString(patk),
                    ',"monsterHp":',
                    vm.toString(mhp)
                ),
                string.concat(
                    ',"monsterAtk":',
                    vm.toString(matk),
                    ',"monsterFirst":',
                    _b(first),
                    ',"win":',
                    _b(win),
                    ',"hpAfter":',
                    vm.toString(hpAfter),
                    "}"
                )
            );
        }
        string[] memory monsters = new string[](60);
        for (uint256 k; k < 60; ++k) {
            bytes32 seed = _seed("monster", k);
            uint256 x = _x("monster", k);
            uint8 floor = uint8(1 + x % 20);
            uint16 hp = uint16(1 + (x >> 8) % 300);
            uint16 atk = uint16(12 + 10 * ((x >> 16) % 6));
            bool flee = k % 2 == 1;
            Resolution memory r = DepthsLogic.resolveMonster(seed, floor, hp, atk, flee);
            monsters[k] = string.concat(
                '{"seed":"',
                vm.toString(seed),
                '","floor":',
                vm.toString(floor),
                ',"hp":',
                vm.toString(hp),
                ',"atk":',
                vm.toString(atk),
                ',"flee":',
                _b(flee),
                ",",
                _res(r),
                "}"
            );
        }
        vm.writeFile(
            string.concat(DIR, "combat.json"),
            string.concat('{\n  "combat": [', _join(cases), '\n  ],\n  "monster": [', _join(monsters), "\n  ]\n}\n")
        );
    }

    function _treasure() internal {
        // 60 acak + mimic paksa (dicari) supaya cabang mimic pasti tercakup
        string[] memory cases = new string[](70);
        uint256 mimicSearch;
        for (uint256 k; k < 70; ++k) {
            bytes32 seed;
            if (k < 60) {
                seed = _seed("treasure", k);
            } else {
                do {
                    seed = _seed("mimic", mimicSearch++);
                } while (DepthsLogic.rand(seed, 0) % 100 >= 5);
            }
            uint256 x = _x("treasure", k);
            uint8 floor = uint8(1 + x % 20);
            uint16 hp = uint16(1 + (x >> 8) % 300);
            uint16 atk = uint16(12 + 10 * ((x >> 16) % 6));
            Resolution memory r = DepthsLogic.resolveTreasure(seed, floor, hp, atk);
            cases[k] = string.concat(
                '{"seed":"',
                vm.toString(seed),
                '","floor":',
                vm.toString(floor),
                ',"hp":',
                vm.toString(hp),
                ',"atk":',
                vm.toString(atk),
                ",",
                _res(r),
                "}"
            );
        }
        vm.writeFile(
            string.concat(DIR, "treasure.json"), string.concat('{\n  "cases": [', _join(cases), "\n  ]\n}\n")
        );
    }

    function _trap() internal {
        string[] memory cases = new string[](60);
        for (uint256 k; k < 60; ++k) {
            bytes32 seed = _seed("trap", k);
            uint256 x = _x("trap", k);
            uint8 floor = uint8(1 + x % 20);
            uint16 hp = uint16(1 + (x >> 8) % 200);
            // seperempat kasus bag kosong
            uint128 bag = (x >> 16) % 4 == 0 ? 0 : uint128(((x >> 24) % 1000) * 1e15 + 1);
            bool disarm = k % 2 == 1;
            Resolution memory r = DepthsLogic.resolveTrap(seed, floor, hp, bag, disarm);
            cases[k] = string.concat(
                '{"seed":"',
                vm.toString(seed),
                '","floor":',
                vm.toString(floor),
                ',"hp":',
                vm.toString(hp),
                ',"bag":',
                _q(bag),
                ',"disarm":',
                _b(disarm),
                ",",
                _res(r),
                "}"
            );
        }
        vm.writeFile(string.concat(DIR, "trap.json"), string.concat('{\n  "cases": [', _join(cases), "\n  ]\n}\n"));
    }
}
