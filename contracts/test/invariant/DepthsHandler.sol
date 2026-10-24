// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Depths} from "../../src/Depths.sol";
import {Run, RunState, Encounter, Action} from "../../src/DepthsTypes.sol";

/// @dev Handler invariant: aksi acak untuk beberapa owner + operator. Aksi dipilih valid sesuai encounter
///      supaya run bisa turun dalam, tapi revert tetap ditelan (fail_on_revert = false).
contract DepthsHandler is Test {
    Depths public immutable d;
    address public immutable admin;
    address[] public owners;
    address[] public operators;

    // ghost counter, untuk memastikan semua jalur benar-benar tersentuh
    mapping(bytes32 => uint256) public calls;
    uint256 public deaths;
    uint256 public cashouts;
    uint8 public maxFloor;

    constructor(Depths d_, address admin_) {
        d = d_;
        admin = admin_;
        for (uint256 k; k < 3; ++k) {
            address o = makeAddr(string.concat("owner", vm.toString(k)));
            owners.push(o);
            operators.push(makeAddr(string.concat("operator", vm.toString(k))));
            vm.deal(o, 1_000 ether);
        }
    }

    function ownerCount() external view returns (uint256) {
        return owners.length;
    }

    // ---------------------------------------------------------------- aksi

    /// @dev Majukan run sesuai state seperti player sungguhan (90% GO DEEPER). Didaftarkan 3× supaya
    ///      bobotnya lebih besar dari aksi acak, sehingga run bisa mencapai lantai dalam.
    ///      `stepA/B/C` = 1–6 langkah berturut-turut untuk owner yang sama.
    function stepA(uint256 i, uint256 choice) external {
        _step(i, choice);
    }

    function stepB(uint256 i, uint256 choice) external {
        _step(i, choice);
    }

    function stepC(uint256 i, uint256 choice) external {
        _step(i, choice);
    }

    function _step(uint256 i, uint256 seed) internal {
        // 1–6 langkah per panggilan
        uint256 n = 1 + seed % 6;
        for (uint256 k; k < n; ++k) {
            _advance(i, uint256(keccak256(abi.encode(seed, k))));
        }
    }

    function _advance(uint256 i, uint256 choice) internal {
        (address o,) = _pick(i);
        RunState s = RunState(d.getRun(o).state);
        if (s == RunState.NONE) {
            this.enter(i, choice % 2 == 0, choice);
        } else if (s == RunState.AWAIT_REVEAL || s == RunState.AWAIT_ACTION) {
            this.act(i, choice | 1, uint8(choice >> 8), uint8(choice >> 16), uint8(choice >> 24), choice % 3 == 0, true);
        } else if (choice % 10 == 0) {
            this.cashOut(i, true);
        } else {
            this.descend(i, true);
        }
    }

    function enter(uint256 i, bool withOperator, uint256 topUp) external {
        (address o, address op) = _pick(i);
        if (!withOperator) op = address(0);
        topUp = op == address(0) ? 0 : bound(topUp, 0, d.MAX_GAS_TOPUP());
        // hitung value sebelum prank: view call juga memakai prank
        uint256 value = d.entryFee() + topUp;
        vm.prank(o);
        try d.enterDungeon{value: value}(op) {
            calls["enter"]++;
        } catch {}
    }

    function act(uint256 i, uint256 choice, uint8 s, uint8 sh, uint8 p, bool usePotion, bool viaOperator) external {
        (address o, address op) = _pick(i);
        _waitTarget(o);
        (Encounter e,,,) = d.previewEncounter(o);
        Action a = _choose(e, choice);
        if (a != Action.BUY) (s, sh, p) = (0, 0, 0);
        else (s, sh, p) = (s % 3, sh % 3, p % 3);
        vm.prank(_caller(o, op, viaOperator));
        try d.act(a, s, sh, p, usePotion && a != Action.BUY && a != Action.LEAVE) {
            calls["act"]++;
        } catch {}
        _track(o);
    }

    function descend(uint256 i, bool viaOperator) external {
        (address o, address op) = _pick(i);
        _waitTarget(o);
        vm.prank(_caller(o, op, viaOperator));
        try d.descend() {
            calls["descend"]++;
        } catch {}
        _track(o);
    }

    function cashOut(uint256 i, bool viaOperator) external {
        (address o, address op) = _pick(i);
        _waitTarget(o);
        bool live = d.getRun(o).state != uint8(RunState.NONE);
        vm.prank(_caller(o, op, viaOperator));
        try d.cashOut() {
            calls["cashOut"]++;
        } catch {}
        _track(o);
        if (live && d.getRun(o).state == uint8(RunState.NONE)) cashouts++;
    }

    function reveal(uint256 i) external {
        (address o,) = _pick(i);
        try d.reveal(o) {
            calls["reveal"]++;
        } catch {}
        _track(o);
    }

    function settle(uint256 i) external {
        (address o,) = _pick(i);
        try d.settle(o) {
            calls["settle"]++;
        } catch {}
        _track(o);
    }

    function reap(uint256 i) external {
        (address o,) = _pick(i);
        try d.reapExpired(o) {
            calls["reap"]++;
            deaths++;
        } catch {}
    }

    function seedPool(uint256 amount) external {
        amount = bound(amount, 0, 5 ether);
        vm.deal(address(this), amount);
        d.seedPool{value: amount}();
        calls["seedPool"]++;
    }

    function withdrawTreasury(uint256 amount) external {
        amount = bound(amount, 0, d.treasury());
        vm.prank(admin);
        d.withdrawTreasury(admin, uint128(amount));
        calls["withdrawTreasury"]++;
    }

    /// @dev Sebagian besar 1–4 blok; sesekali lompat lewat window supaya expiry ikut teruji.
    function roll(uint256 n) external {
        n = bound(n, 1, 40);
        vm.roll(block.number + (n == 40 ? 300 : n % 4 + 1));
        calls["roll"]++;
    }

    // ---------------------------------------------------------------- helper

    function _pick(uint256 i) internal view returns (address, address) {
        i = i % owners.length;
        return (owners[i], operators[i]);
    }

    function _choose(Encounter e, uint256 choice) internal pure returns (Action) {
        // 1/16 aksi acak apa pun (termasuk tidak valid)
        if (choice % 16 == 0) return Action((choice >> 4) % 8);
        bool first = (choice >> 4) % 4 != 0;
        if (e == Encounter.MONSTER) return first ? Action.FIGHT : Action.FLEE;
        if (e == Encounter.TREASURE) return first ? Action.OPEN : Action.LEAVE;
        if (e == Encounter.TRAP) return first ? Action.PROCEED : Action.DISARM;
        if (e == Encounter.MERCHANT) return first ? Action.BUY : Action.LEAVE;
        return Action.FIGHT;
    }

    /// @dev Seperti frontend: tunggu blok target sebelum tx keputusan. TooEarly diuji di unit test.
    function _waitTarget(address o) internal {
        Run memory r = d.getRun(o);
        bool pending = r.state == uint8(RunState.AWAIT_REVEAL) || r.state == uint8(RunState.AWAIT_SETTLE);
        if (pending && block.number <= r.targetBlock) vm.roll(uint256(r.targetBlock) + 1);
    }

    function _caller(address o, address op, bool viaOperator) internal view returns (address) {
        return viaOperator && d.operatorOf(op) == o ? op : o;
    }

    function _track(address o) internal {
        Run memory r = d.getRun(o);
        if (r.floor > maxFloor) maxFloor = r.floor;
    }
}
