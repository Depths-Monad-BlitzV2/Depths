// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Depths} from "../../src/Depths.sol";
import {Run, RunState} from "../../src/DepthsTypes.sol";
import {DepthsHandler} from "./DepthsHandler.sol";

/// @notice Invariant solvency (CONTRACT_SPEC §9). Konfigurasi runs/depth di foundry.toml [invariant].
contract DepthsInvariantTest is Test {
    Depths internal d;
    DepthsHandler internal h;
    address internal admin = makeAddr("admin");

    function setUp() public {
        vm.roll(1000);
        vm.deal(admin, 100 ether);
        vm.prank(admin);
        d = new Depths{value: 20 ether}(admin);
        h = new DepthsHandler(d, admin);
        targetContract(address(h));
    }

    function invariant_solvency() public view {
        assertGe(address(d).balance, uint256(d.pool()) + d.reserved() + d.treasury());
    }

    /// @dev Tanpa forced send, saldo harus sama persis dengan jumlah bucket.
    function invariant_balanceExact() public view {
        assertEq(address(d).balance, uint256(d.pool()) + d.reserved() + d.treasury());
    }

    function invariant_reservedEqualsBags() public view {
        uint256 sum;
        for (uint256 k; k < h.ownerCount(); ++k) {
            sum += d.getRun(h.owners(k)).bag;
        }
        assertEq(d.reserved(), sum);
    }

    function invariant_hpWithinMax() public view {
        for (uint256 k; k < h.ownerCount(); ++k) {
            Run memory r = d.getRun(h.owners(k));
            if (r.state == uint8(RunState.NONE)) continue;
            assertLe(r.hp, r.maxHp);
            assertGt(r.hp, 0, "run hidup selalu HP > 0");
        }
    }

    function invariant_operatorLinks() public view {
        for (uint256 k; k < h.ownerCount(); ++k) {
            address o = h.owners(k);
            address op = h.operators(k);
            Run memory r = d.getRun(o);
            if (r.state == uint8(RunState.NONE)) assertEq(d.operatorOf(op), address(0), "tautan dihapus");
            if (r.operator != address(0)) assertEq(d.operatorOf(r.operator), o);
        }
    }

    /// @dev Penjaga: handler harus benar-benar bermain (bukan no-op karena revert tertelan).
    function test_handlerReachesDeepFloors() public {
        for (uint256 k; k < 100; ++k) {
            uint256 x = uint256(keccak256(abi.encode(k)));
            uint256 f = x % 13;
            uint256 i = x >> 8;
            if (f == 0) h.enter(i, (x >> 20) % 2 == 0, x >> 30);
            else if (f == 1) h.act(i, x >> 40, 1, 1, 1, (x >> 50) % 2 == 0, (x >> 60) % 2 == 0);
            else if (f == 2) h.descend(i, true);
            else if (f == 3) h.cashOut(i, true);
            else if (f == 4) h.reveal(i);
            else if (f == 5) h.settle(i);
            else if (f == 6) h.reap(i);
            else if (f == 7) h.seedPool(x);
            else if (f == 8) h.withdrawTreasury(x);
            else if (f == 9) h.roll(x);
            else h.stepA(i, x >> 70);
        }
        console.log("enter", h.calls("enter"), "act", h.calls("act"));
        console.log("descend", h.calls("descend"), "cashOut", h.calls("cashOut"));
        console.log("reveal", h.calls("reveal"), "maxFloor", h.maxFloor());
        assertGt(h.calls("enter"), 5);
        assertGt(h.calls("act"), 20);
        assertGt(h.calls("descend"), 10);
        assertGt(h.calls("cashOut"), 0);
        assertGe(h.maxFloor(), 5);
        invariant_balanceExact();
        invariant_reservedEqualsBags();
    }
}
