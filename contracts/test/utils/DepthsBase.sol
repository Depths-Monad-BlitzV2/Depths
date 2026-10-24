// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Depths} from "../../src/Depths.sol";
import {Run, RunState, Encounter, Action, Outcome, Resolution} from "../../src/DepthsTypes.sol";

/// @dev Helper bersama test Depths. RNG dikontrol dengan `vm.setBlockhash(targetBlock, h)`: helper mencoba
///      hash berurutan sampai view preview contract menghasilkan encounter/outcome yang diinginkan.
abstract contract DepthsBase is Test {
    uint256 internal constant FEE = 1 ether;
    uint256 internal constant TOPUP = 0.25 ether;
    uint256 internal constant SEED = 100 ether;
    uint256 internal constant WINDOW = 256;

    Depths internal d;
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal aliceOp = makeAddr("aliceOp");
    address internal bob = makeAddr("bob");
    address internal bobOp = makeAddr("bobOp");
    address internal stranger = makeAddr("stranger");
    uint256 private _hashNonce;

    function setUp() public virtual {
        vm.roll(1000);
        vm.deal(admin, 1000 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(stranger, 100 ether);
        vm.prank(admin);
        d = new Depths{value: SEED}(admin);
    }

    // ---------------------------------------------------------------- akses state

    function _run(address owner) internal view returns (Run memory) {
        return d.getRun(owner);
    }

    function _state(address owner) internal view returns (RunState) {
        return RunState(d.getRun(owner).state);
    }

    function _target(address owner) internal view returns (uint64) {
        return d.getRun(owner).targetBlock;
    }

    function _roll(uint256 n) internal {
        vm.roll(block.number + n);
    }

    function _assertSolvent() internal view {
        assertEq(address(d).balance, uint256(d.pool()) + d.reserved() + d.treasury(), "balance == buckets");
    }

    // ---------------------------------------------------------------- kontrol RNG

    function _nextHash() internal returns (bytes32) {
        return keccak256(abi.encode("depths.test.blockhash", ++_hashNonce));
    }

    /// @dev Butuh `block.number > targetBlock`.
    function _forceEncounter(address owner, Encounter want) internal {
        uint64 t = _target(owner);
        for (uint256 k; k < 1000; ++k) {
            vm.setBlockhash(t, _nextHash());
            (Encounter e,,,) = d.previewEncounter(owner);
            if (e == want) return;
        }
        revert("forceEncounter: tidak ketemu");
    }

    /// @dev Butuh state AWAIT_SETTLE dan `block.number > targetBlock`.
    function _forceOutcome(address owner, Outcome want) internal returns (Resolution memory res) {
        uint64 t = _target(owner);
        for (uint256 k; k < 5000; ++k) {
            vm.setBlockhash(t, _nextHash());
            (res,,,) = d.previewResolve(owner);
            if (res.outcome == want) return res;
        }
        revert("forceOutcome: tidak ketemu");
    }

    // ---------------------------------------------------------------- alur

    function _enter(address owner, address op) internal {
        vm.prank(owner);
        d.enterDungeon{value: op == address(0) ? FEE : FEE + TOPUP}(op);
    }

    /// @dev Roll 2 blok (commit di b, target b + 1, valid mulai b + 2), paksa encounter, lalu `act` (jalur normal: `_reveal` di dalam `act`).
    function _act(address caller, address owner, Encounter enc, Action a, bool usePotion) internal {
        _roll(2);
        _forceEncounter(owner, enc);
        vm.prank(caller);
        d.act(a, 0, 0, 0, usePotion);
    }

    /// @dev `_act` lalu roll 2 blok dan paksa outcome. Run berakhir di AWAIT_SETTLE yang ready.
    function _commit(address caller, address owner, Encounter enc, Action a, Outcome want)
        internal
        returns (Resolution memory)
    {
        _act(caller, owner, enc, a, false);
        _roll(2);
        return _forceOutcome(owner, want);
    }

    function _descend(address caller) internal {
        vm.prank(caller);
        d.descend();
    }

    function _cashOut(address caller) internal {
        vm.prank(caller);
        d.cashOut();
    }

    /// @dev Lewati lantai dengan merchant LEAVE sampai `floor` (state AWAIT_REVEAL di floor itu).
    function _reachFloor(address owner, address caller, uint8 floor) internal {
        while (_run(owner).floor < floor) {
            _act(caller, owner, Encounter.MERCHANT, Action.LEAVE, false);
            _descend(caller);
        }
    }

    /// @dev Isi bag dengan treasure (OPEN, bukan mimic) lalu descend, sebanyak `n` lantai.
    function _lootFloors(address owner, address caller, uint256 n) internal {
        for (uint256 k; k < n; ++k) {
            _commit(caller, owner, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
            _descend(caller);
        }
    }
}
