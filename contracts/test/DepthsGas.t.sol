// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {console} from "forge-std/Test.sol";
import {DepthsBase} from "./utils/DepthsBase.sol";
import {DepthsLogic} from "../src/DepthsLogic.sol";
import "../src/DepthsTypes.sol";

/// @notice Gas per jalur untuk CONTRACT_SPEC §8 dan apps/web/lib/gas.ts.
/// @dev Jalankan dengan `forge test --match-contract DepthsGas --isolate --network monad -vv` (jadwal gas Monad:
///      storage per page 128 slot, cold account 10.1k) supaya setiap call adalah tx
///      terpisah (storage cold/warm akurat). Angka = gasTotalUsed (sudah termasuk 21000 intrinsic, sebelum refund) + calldata,
///      yaitu gas limit minimum yang dibutuhkan (Monad menagih gas limit).
contract DepthsGasTest is DepthsBase {
    function _report(string memory path, bytes memory data) internal view returns (uint256 total) {
        Vm.Gas memory g = vm.lastCallGas();
        // gasTotalUsed sudah termasuk 21000 intrinsic; calldata ditambahkan supaya konservatif
        total = g.gasTotalUsed + _calldataGas(data);
        console.log(path, total);
    }

    function _calldataGas(bytes memory data) internal pure returns (uint256 gas) {
        for (uint256 k; k < data.length; ++k) {
            gas += data[k] == 0 ? 4 : 16;
        }
    }

    function _actData(Action a, uint8 s, uint8 sh, uint8 p, bool pot) internal view returns (bytes memory) {
        return abi.encodeCall(d.act, (a, s, sh, p, pot));
    }

    function test_gas_enterDungeon() public {
        bytes memory data = abi.encodeCall(d.enterDungeon, (aliceOp));
        _enter(alice, aliceOp);
        uint256 first = _report("enterDungeon (player baru, operator baru)", data);
        _act(aliceOp, alice, Encounter.TREASURE, Action.LEAVE, false);
        _cashOut(aliceOp);
        _enter(alice, aliceOp);
        _report("enterDungeon (player lama)", data);
        // regression guard; jadwal Monad (state growth 17k/slot baru, akun baru 25k) ± 203k
        assertLe(first, 220_000);
    }

    function test_gas_actRevealCommit() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        _report("act FIGHT di AWAIT_REVEAL (floor 1, slot seed baru)", _actData(Action.FIGHT, 0, 0, 0, false));
        _roll(2);
        _forceOutcome(alice, Outcome.WIN);
        _descend(aliceOp);
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        _report("act FIGHT di AWAIT_REVEAL (floor 2+)", _actData(Action.FIGHT, 0, 0, 0, false));
    }

    function test_gas_actInstant() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 4);
        _act(aliceOp, alice, Encounter.TREASURE, Action.LEAVE, false);
        _report("act LEAVE di AWAIT_REVEAL", _actData(Action.LEAVE, 0, 0, 0, false));
        _descend(aliceOp);
        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.prank(aliceOp);
        d.act(Action.BUY, 1, 1, 1, false);
        _report("act BUY 1/1/1 di AWAIT_REVEAL", _actData(Action.BUY, 1, 1, 1, false));
    }

    function test_gas_descendLazySettle() public {
        bytes memory data = abi.encodeCall(d.descend, ());
        _enter(alice, aliceOp);
        _commit(aliceOp, alice, Encounter.MONSTER, Action.FLEE, Outcome.FLED);
        _descend(aliceOp);
        _report("descend AWAIT_SETTLE FLED (tanpa combat, tanpa loot)", data);

        _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        _descend(aliceOp);
        _report("descend AWAIT_SETTLE TREASURE (award, tanpa combat)", data);

        for (uint8 k; k < 2; ++k) {
            _commit(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, Outcome.WIN);
            uint256 attacks = _attacks(alice);
            _descend(aliceOp);
            _report("descend AWAIT_SETTLE FIGHT WIN", data);
            console.log("  serangan (draw combat) =", attacks, "floor =", _run(alice).floor - 1);
        }
    }

    function test_gas_descendDeath() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 1);
        _reachFloor(alice, aliceOp, 12);
        _commit(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, Outcome.KILLED);
        uint256 attacks = _attacks(alice);
        _descend(aliceOp);
        _report("descend AWAIT_SETTLE KILLED (mati, board kedalaman)", abi.encodeCall(d.descend, ()));
        console.log("  serangan =", attacks);
    }

    function test_gas_cashOutLazySettle() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 2);
        _commit(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, Outcome.WIN);
        uint256 attacks = _attacks(alice);
        _cashOut(aliceOp);
        _report("cashOut AWAIT_SETTLE FIGHT WIN (+transfer, 2 board baru)", abi.encodeCall(d.cashOut, ()));
        console.log("  serangan =", attacks);
    }

    function test_gas_floorCleared() public {
        _enter(alice, aliceOp);
        _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        d.settle(alice);
        _report("settle fallback TREASURE", abi.encodeCall(d.settle, (alice)));
        _descend(aliceOp);
        _report("descend FLOOR_CLEARED", abi.encodeCall(d.descend, ()));
        _roll(2);
        _forceEncounter(alice, Encounter.TREASURE);
        d.reveal(alice);
        _report("reveal fallback", abi.encodeCall(d.reveal, (alice)));
        vm.prank(aliceOp);
        d.act(Action.OPEN, 0, 0, 0, false);
        _report("act OPEN di AWAIT_ACTION (setelah reveal fallback)", _actData(Action.OPEN, 0, 0, 0, false));
        _roll(2);
        _forceOutcome(alice, Outcome.TREASURE);
        d.settle(alice);
        _cashOut(aliceOp);
        _report("cashOut FLOOR_CLEARED (+transfer, 2 board baru)", abi.encodeCall(d.cashOut, ()));
    }

    /// @dev Kasus umum setelah game ramai: board penuh, run tidak masuk board.
    function test_gas_boardFull() public {
        for (uint256 k; k < 10; ++k) {
            address p = makeAddr(string.concat("filler", vm.toString(k)));
            vm.deal(p, 10 ether);
            _enter(p, address(0));
            _lootFloors(p, p, 3);
            _act(p, p, Encounter.TREASURE, Action.LEAVE, false);
            _cashOut(p);
        }
        _enter(alice, aliceOp);
        _commit(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, Outcome.WIN);
        uint256 attacks = _attacks(alice);
        _cashOut(aliceOp);
        _report("cashOut AWAIT_SETTLE FIGHT WIN (board penuh, tidak masuk)", abi.encodeCall(d.cashOut, ()));
        console.log("  serangan =", attacks);

        _enter(alice, aliceOp);
        _report("enterDungeon (run ke-2, operator sama)", abi.encodeCall(d.enterDungeon, (aliceOp)));
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        _report("act FIGHT di AWAIT_REVEAL (run ke-2, floor 1)", _actData(Action.FIGHT, 0, 0, 0, false));
        _roll(2);
        _forceOutcome(alice, Outcome.WIN);
        d.settle(alice);
        _cashOut(aliceOp);
        _report("cashOut FLOOR_CLEARED (board penuh, tidak masuk)", abi.encodeCall(d.cashOut, ()));

        _enter(alice, aliceOp);
        vm.roll(_target(alice) + WINDOW + 1);
        d.reapExpired(alice);
        _report("reapExpired (board penuh)", abi.encodeCall(d.reapExpired, (alice)));
    }

    function test_gas_reapExpired() public {
        _enter(alice, aliceOp);
        vm.roll(_target(alice) + WINDOW + 1);
        d.reapExpired(alice);
        _report("reapExpired", abi.encodeCall(d.reapExpired, (alice)));
    }

    /// @dev Jumlah serangan (draw combat) di resolusi yang sedang pending, mirror DepthsLogic.resolveCombat.
    function _attacks(address owner) internal view returns (uint256 n) {
        Run memory r = _run(owner);
        (, bytes32 seed,,) = d.previewResolve(owner);
        (uint16 mHp, uint16 mAtk,) = DepthsLogic.monster(r.floor);
        int256 ph = int256(uint256(r.hp));
        int256 mh = int256(uint256(mHp));
        uint256 i = 1;
        for (uint256 round; round < 64; ++round) {
            mh -= int256(DepthsLogic.dmg(r.atk, DepthsLogic.rand(seed, i++)));
            if (mh <= 0) return i - 1;
            ph -= int256(DepthsLogic.dmg(mAtk, DepthsLogic.rand(seed, i++)));
            if (ph <= 0) return i - 1;
        }
        return i - 1;
    }
}
