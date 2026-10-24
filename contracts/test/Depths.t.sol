// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {DepthsBase} from "./utils/DepthsBase.sol";
import {Depths} from "../src/Depths.sol";
import {DepthsLogic} from "../src/DepthsLogic.sol";
import "../src/DepthsTypes.sol";

/// @dev Contract tanpa receive: transfer ke sini gagal.
contract Rejecter {
    function enter(Depths d, address op) external payable {
        d.enterDungeon{value: msg.value}(op);
    }

    function cashOut(Depths d) external {
        d.cashOut();
    }
}

/// @dev Operator yang mencoba re-enter saat menerima top-up.
contract ReentrantOperator {
    Depths internal d;

    constructor(Depths d_) {
        d = d_;
    }

    receive() external payable {
        d.enterDungeon{value: msg.value}(address(0));
    }
}

contract DepthsTest is DepthsBase {
    uint256 constant MMON = 1e15;

    // ================================================================ constructor / admin

    function test_constructor() public view {
        assertEq(d.owner(), admin);
        assertEq(d.pool(), SEED);
        assertEq(d.entryFee(), 1 ether);
        assertEq(d.nextRunId(), 1);
        _assertSolvent();
    }

    function test_constructor_noSeed() public {
        Depths d2 = new Depths(admin);
        assertEq(d2.pool(), 0);
    }

    function test_seedPool_anyone() public {
        vm.expectEmit(address(d));
        emit PoolChanged(uint128(SEED + 3 ether), 0);
        vm.prank(stranger);
        d.seedPool{value: 3 ether}();
        assertEq(d.pool(), SEED + 3 ether);
        _assertSolvent();
    }

    function test_setEntryFee() public {
        vm.expectEmit(address(d));
        emit EntryFeeSet(2 ether);
        vm.prank(admin);
        d.setEntryFee(2 ether);
        assertEq(d.entryFee(), 2 ether);
    }

    function test_setEntryFee_bounds() public {
        vm.startPrank(admin);
        vm.expectRevert(InvalidFee.selector);
        d.setEntryFee(0.2 ether - 1);
        vm.expectRevert(InvalidFee.selector);
        d.setEntryFee(20 ether + 1);
        d.setEntryFee(0.2 ether);
        d.setEntryFee(20 ether);
        vm.stopPrank();
    }

    function test_setEntryFee_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        d.setEntryFee(2 ether);
    }

    function test_setEntryFee_doesNotAffectActiveRun() public {
        _enter(alice, aliceOp);
        vm.prank(admin);
        d.setEntryFee(5 ether);
        _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        uint256 before = alice.balance;
        _cashOut(aliceOp);
        assertGt(alice.balance, before, "cash out jalan normal");
        // run baru pakai fee baru
        vm.prank(alice);
        vm.expectRevert(InsufficientFee.selector);
        d.enterDungeon{value: 1 ether}(address(0));
    }

    function test_withdrawTreasury() public {
        _enter(alice, address(0));
        uint128 t = d.treasury();
        assertEq(t, 0.05 ether);
        uint256 before = stranger.balance;
        vm.expectEmit(address(d));
        emit TreasuryWithdrawn(stranger, t);
        vm.prank(admin);
        d.withdrawTreasury(stranger, t);
        assertEq(stranger.balance - before, t);
        assertEq(d.treasury(), 0);
        _assertSolvent();
    }

    function test_withdrawTreasury_cannotTouchPool() public {
        _enter(alice, address(0));
        vm.expectRevert(InsufficientTreasury.selector);
        vm.prank(admin);
        d.withdrawTreasury(admin, 0.05 ether + 1);
    }

    function test_withdrawTreasury_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        d.withdrawTreasury(stranger, 0);
    }

    function test_withdrawTreasury_transferFailed() public {
        _enter(alice, address(0));
        Rejecter rj = new Rejecter();
        vm.expectRevert(TransferFailed.selector);
        vm.prank(admin);
        d.withdrawTreasury(address(rj), 0.05 ether);
    }

    function test_pause_blocksEnterOnly() public {
        _enter(alice, aliceOp);
        vm.prank(admin);
        d.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(bob);
        d.enterDungeon{value: FEE}(address(0));
        // run aktif tetap jalan
        _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        _cashOut(aliceOp);
        assertEq(uint8(_state(alice)), uint8(RunState.NONE));
        vm.prank(admin);
        d.unpause();
        _enter(bob, address(0));
    }

    function test_pause_onlyOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        d.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        d.unpause();
        vm.stopPrank();
    }

    function test_ownership_twoStep() public {
        vm.prank(admin);
        d.transferOwnership(bob);
        assertEq(d.owner(), admin);
        vm.prank(bob);
        d.acceptOwnership();
        assertEq(d.owner(), bob);
    }

    function test_noReceive() public {
        vm.prank(stranger);
        (bool ok,) = address(d).call{value: 1 ether}("");
        assertFalse(ok, "transfer langsung ditolak");
    }

    // ================================================================ enterDungeon

    function test_enter_initRun() public {
        uint256 opBefore = aliceOp.balance;
        uint64 target = uint64(block.number + 1);
        vm.expectEmit(address(d));
        emit RunStarted(alice, 1, aliceOp, uint128(FEE));
        vm.expectEmit(address(d));
        emit FloorEntered(alice, 1, 1, target);
        vm.expectEmit(address(d));
        emit PoolChanged(uint128(SEED + 0.95 ether), 0);
        _enter(alice, aliceOp);

        Run memory r = _run(alice);
        assertEq(r.operator, aliceOp);
        assertEq(r.runId, 1);
        assertEq(r.state, uint8(RunState.AWAIT_REVEAL));
        assertEq(r.floor, 1);
        assertEq(r.hp, DepthsLogic.BASE_HP);
        assertEq(r.maxHp, DepthsLogic.BASE_HP);
        assertEq(r.atk, 12);
        assertEq(r.targetBlock, target);
        assertEq(r.bag, 0);

        assertEq(d.pool(), SEED + 0.95 ether, "95% ke pool");
        assertEq(d.treasury(), 0.05 ether, "rake 5%");
        assertEq(aliceOp.balance - opBefore, TOPUP, "top-up diteruskan");
        assertEq(d.operatorOf(aliceOp), alice);
        assertEq(d.ownerOf(aliceOp), alice);
        assertEq(d.ownerOf(alice), alice);
        assertEq(d.nextRunId(), 2);
        (uint32 runs,,,) = d.stats(alice);
        assertEq(runs, 1);
        _assertSolvent();
    }

    function test_enter_withoutOperator() public {
        _enter(alice, address(0));
        assertEq(_run(alice).operator, address(0));
        assertEq(d.ownerOf(alice), alice);
    }

    function test_enter_insufficientFee() public {
        vm.expectRevert(InsufficientFee.selector);
        vm.prank(alice);
        d.enterDungeon{value: FEE - 1}(aliceOp);
    }

    function test_enter_topUpTooLarge() public {
        vm.expectRevert(TopUpTooLarge.selector);
        vm.prank(alice);
        d.enterDungeon{value: FEE + 0.5 ether + 1}(aliceOp);
        // tepat di batas boleh
        vm.prank(alice);
        d.enterDungeon{value: FEE + 0.5 ether}(aliceOp);
    }

    function test_enter_topUpWithoutOperator() public {
        vm.expectRevert(TopUpTooLarge.selector);
        vm.prank(alice);
        d.enterDungeon{value: FEE + 1}(address(0));
    }

    function test_enter_activeRun() public {
        _enter(alice, aliceOp);
        vm.expectRevert(abi.encodeWithSelector(WrongState.selector, RunState.NONE, RunState.AWAIT_REVEAL));
        vm.prank(alice);
        d.enterDungeon{value: FEE}(address(0));
    }

    function test_enter_operatorInUse() public {
        _enter(alice, aliceOp);
        // operator yang sudah dipakai owner lain
        vm.expectRevert(OperatorInUse.selector);
        vm.prank(bob);
        d.enterDungeon{value: FEE}(aliceOp);
        // operator yang sedang punya run sendiri
        vm.expectRevert(OperatorInUse.selector);
        vm.prank(bob);
        d.enterDungeon{value: FEE}(alice);
        // operator aktif tidak bisa memulai run sendiri
        vm.deal(aliceOp, 10 ether);
        vm.expectRevert(OperatorInUse.selector);
        vm.prank(aliceOp);
        d.enterDungeon{value: FEE}(address(0));
    }

    function test_enter_topUpTransferFailed() public {
        Rejecter rj = new Rejecter();
        vm.expectRevert(TransferFailed.selector);
        vm.prank(alice);
        d.enterDungeon{value: FEE + TOPUP}(address(rj));
    }

    function test_enter_reentrantOperatorBlocked() public {
        ReentrantOperator ro = new ReentrantOperator(d);
        // re-enter di receive() kena ReentrancyGuard → call gagal → TransferFailed
        vm.expectRevert(TransferFailed.selector);
        vm.prank(alice);
        d.enterDungeon{value: FEE + TOPUP}(address(ro));
    }

    function test_enter_operatorReusableAfterRunEnds() public {
        _enter(alice, aliceOp);
        _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        _cashOut(aliceOp);
        assertEq(d.operatorOf(aliceOp), address(0), "tautan dihapus");
        _enter(bob, aliceOp);
        assertEq(d.ownerOf(aliceOp), bob);
    }

    // ================================================================ act

    function test_act_tooEarlySameBlock() public {
        _enter(alice, aliceOp);
        uint64 t = _target(alice);
        vm.expectRevert(abi.encodeWithSelector(TooEarly.selector, t, block.number));
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);
        // blok target sendiri juga belum boleh (blockhash belum ada)
        vm.roll(t);
        vm.expectRevert(abi.encodeWithSelector(TooEarly.selector, t, block.number));
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);
    }

    function test_act_normalPath_revealAndCommit() public {
        _enter(alice, aliceOp);
        _roll(2);
        _forceEncounter(alice, Encounter.MONSTER);
        (, uint8 mid,,) = d.previewEncounter(alice);
        bytes32 seed = keccak256(abi.encode(blockhash(_target(alice)), alice, uint32(1), uint8(1), uint8(1)));

        vm.expectEmit(address(d));
        emit EncounterRevealed(alice, 1, 1, Encounter.MONSTER, mid, seed);
        vm.expectEmit(address(d));
        emit ActionCommitted(alice, 1, 1, Action.FIGHT, false, uint64(block.number + 1));
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);

        Run memory r = _run(alice);
        assertEq(r.state, uint8(RunState.AWAIT_SETTLE));
        assertEq(r.encounter, uint8(Encounter.MONSTER));
        assertEq(r.monsterId, mid);
        assertEq(r.encounterSeed, seed);
        assertEq(r.pendingAction, uint8(Action.FIGHT));
        assertEq(r.targetBlock, block.number + 1);
    }

    function test_act_ownerCanPlay() public {
        _enter(alice, aliceOp);
        _act(alice, alice, Encounter.MONSTER, Action.FIGHT, false);
        assertEq(uint8(_state(alice)), uint8(RunState.AWAIT_SETTLE));
    }

    function test_act_notController() public {
        _enter(alice, aliceOp);
        _roll(2);
        vm.expectRevert(NotRunController.selector);
        vm.prank(stranger);
        d.act(Action.FIGHT, 0, 0, 0, false);
    }

    function test_act_invalidActionPerEncounter() public {
        _enter(alice, aliceOp);
        _lootUntil(alice, aliceOp, DepthsLogic.POTION_PRICE);
        _roll(2);
        Action[4][4] memory invalid = [
            [Action.OPEN, Action.PROCEED, Action.BUY, Action.LEAVE], // MONSTER
            [Action.FIGHT, Action.FLEE, Action.PROCEED, Action.BUY], // TREASURE
            [Action.FIGHT, Action.OPEN, Action.LEAVE, Action.BUY], // TRAP
            [Action.FIGHT, Action.OPEN, Action.PROCEED, Action.DISARM] // MERCHANT
        ];
        for (uint256 e; e < 4; ++e) {
            _forceEncounter(alice, Encounter(e + 1));
            for (uint256 k; k < 4; ++k) {
                vm.expectRevert(InvalidAction.selector);
                vm.prank(aliceOp);
                d.act(invalid[e][k], 0, 0, 0, false);
            }
            vm.expectRevert(InvalidAction.selector);
            vm.prank(aliceOp);
            d.act(Action.NONE, 0, 0, 0, false);
        }
    }

    function test_act_quantitiesOnlyForBuy() public {
        _enter(alice, aliceOp);
        _lootUntil(alice, aliceOp, DepthsLogic.POTION_PRICE);
        _roll(2);
        _forceEncounter(alice, Encounter.MONSTER);
        vm.expectRevert(InvalidAction.selector);
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 1, 0, 0, false);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.expectRevert(InvalidAction.selector);
        vm.prank(aliceOp);
        d.act(Action.LEAVE, 0, 0, 1, false);
    }

    function test_act_noPotion() public {
        _enter(alice, aliceOp);
        _roll(2);
        _forceEncounter(alice, Encounter.MONSTER);
        vm.expectRevert(NoPotion.selector);
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, true);
    }

    function test_act_potionNotWithInstantAction() public {
        _enter(alice, aliceOp);
        _roll(2);
        _forceEncounter(alice, Encounter.TREASURE);
        vm.expectRevert(InvalidAction.selector);
        vm.prank(aliceOp);
        d.act(Action.LEAVE, 0, 0, 0, true);
    }

    function test_act_wrongState() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        _roll(2);
        vm.expectRevert(abi.encodeWithSelector(WrongState.selector, RunState.AWAIT_ACTION, RunState.AWAIT_SETTLE));
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);
    }

    function test_act_leaveInstant() public {
        _enter(alice, aliceOp);
        _roll(2);
        _forceEncounter(alice, Encounter.TREASURE);
        vm.expectEmit(address(d));
        emit FloorResolved(alice, 1, 1, Action.LEAVE, bytes32(0), true, DepthsLogic.BASE_HP, 0, uint8(Outcome.LEAVE));
        vm.prank(aliceOp);
        d.act(Action.LEAVE, 0, 0, 0, false);
        assertEq(uint8(_state(alice)), uint8(RunState.FLOOR_CLEARED));
        // FLOOR_CLEARED tidak punya expiry
        _roll(1000);
        _descend(aliceOp);
        assertEq(_run(alice).floor, 2);
    }

    function test_act_blockhashUnavailable() public {
        _enter(alice, aliceOp);
        _roll(2);
        vm.setBlockhash(_target(alice), bytes32(0));
        vm.expectRevert(BlockhashUnavailable.selector);
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);
    }

    // ================================================================ merchant

    function test_buy() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 4);
        Run memory r0 = _run(alice);
        uint128 cost = uint128(400 * MMON + 400 * MMON + 200 * MMON);
        assertGe(r0.bag, cost, "bag cukup");
        uint128 pool0 = d.pool();

        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.expectEmit(address(d));
        emit ItemsBought(alice, 1, 1, 1, 1, cost);
        vm.expectEmit(address(d));
        emit FloorResolved(alice, 1, r0.floor, Action.BUY, bytes32(0), true, r0.hp + 20, -int128(cost), 11);
        vm.prank(aliceOp);
        d.act(Action.BUY, 1, 1, 1, false);

        Run memory r = _run(alice);
        assertEq(r.state, uint8(RunState.FLOOR_CLEARED));
        assertEq(r.bag, r0.bag - cost);
        assertEq(r.atk, 22);
        assertEq(r.maxHp, r0.maxHp + 20);
        assertEq(r.hp, r0.hp + 20);
        assertEq(r.swords, 1);
        assertEq(r.shields, 1);
        assertEq(r.potions, 1);
        assertEq(d.pool(), pool0 + cost, "belanja masuk pool");
        assertEq(d.reserved(), r.bag);
        _assertSolvent();
    }

    function test_buy_insufficientBag() public {
        _enter(alice, aliceOp);
        _lootUntil(alice, aliceOp, DepthsLogic.POTION_PRICE);
        assertLt(_run(alice).bag, 4600 * MMON, "bag di bawah harga borong");
        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.expectRevert(InsufficientBag.selector);
        vm.prank(aliceOp);
        d.act(Action.BUY, 5, 5, 3, false);
    }

    function test_buy_itemLimit() public {
        _enter(alice, aliceOp);
        _lootUntil(alice, aliceOp, DepthsLogic.POTION_PRICE);
        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.startPrank(aliceOp);
        vm.expectRevert(ItemLimit.selector);
        d.act(Action.BUY, 6, 0, 0, false);
        vm.expectRevert(ItemLimit.selector);
        d.act(Action.BUY, 0, 6, 0, false);
        vm.expectRevert(ItemLimit.selector);
        d.act(Action.BUY, 0, 0, 4, false);
        vm.stopPrank();
    }

    function test_buy_potionCarryLimitAcrossFloors() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 5);
        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.prank(aliceOp);
        d.act(Action.BUY, 0, 0, 3, false);
        _descend(aliceOp);
        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.expectRevert(ItemLimit.selector);
        vm.prank(aliceOp);
        d.act(Action.BUY, 0, 0, 1, false);
    }

    function test_buy_zeroItemsActsAsLeave() public {
        _enter(alice, aliceOp);
        _lootUntil(alice, aliceOp, DepthsLogic.POTION_PRICE);
        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.prank(aliceOp);
        d.act(Action.BUY, 0, 0, 0, false);
        assertEq(uint8(_state(alice)), uint8(RunState.FLOOR_CLEARED));
    }

    function test_potion_healsBeforeResolve() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 2);
        // trap PROCEED yang kena HP untuk menurunkan HP
        _commit(aliceOp, alice, Encounter.TRAP, Action.PROCEED, Outcome.TRAP_HP);
        _descend(aliceOp);
        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.prank(aliceOp);
        d.act(Action.BUY, 0, 0, 1, false);
        _descend(aliceOp);
        uint16 hp0 = _run(alice).hp;
        assertLt(hp0, DepthsLogic.BASE_HP);

        _act(aliceOp, alice, Encounter.TREASURE, Action.OPEN, true);
        _roll(2);
        Resolution memory res = _forceOutcome(alice, Outcome.TREASURE);
        uint16 healed = hp0 + 50 > DepthsLogic.BASE_HP ? DepthsLogic.BASE_HP : hp0 + 50;
        assertEq(res.hpAfter, healed, "preview sudah termasuk potion");
        _descend(aliceOp);
        Run memory r = _run(alice);
        assertEq(r.hp, healed);
        assertEq(r.potions, 0, "potion terpakai");
        assertFalse(r.usePotion);
    }

    // ================================================================ settle: hasil per encounter

    function test_settle_fightWin_viaDescend() public {
        _enter(alice, aliceOp);
        Resolution memory res = _commit(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, Outcome.WIN);
        (,, uint128 loot) = d.monsterStats(1);
        assertEq(res.lootTable, loot);
        uint128 pool0 = d.pool();

        vm.expectEmit(address(d));
        emit LootAwarded(alice, 1, loot, loot);
        _descend(aliceOp);

        Run memory r = _run(alice);
        assertEq(r.floor, 2);
        assertEq(r.state, uint8(RunState.AWAIT_REVEAL));
        assertEq(r.hp, res.hpAfter);
        assertEq(r.bag, loot);
        assertEq(r.targetBlock, block.number + 1);
        assertEq(d.pool(), pool0 - loot);
        assertEq(d.reserved(), loot);
        _assertSolvent();
    }

    function test_settle_fled() public {
        _enter(alice, aliceOp);
        _commit(aliceOp, alice, Encounter.MONSTER, Action.FLEE, Outcome.FLED);
        vm.prank(stranger);
        d.settle(alice);
        Run memory r = _run(alice);
        assertEq(r.state, uint8(RunState.FLOOR_CLEARED));
        assertEq(r.hp, DepthsLogic.BASE_HP);
        assertEq(r.bag, 0);
    }

    function test_settle_fleeFailWin() public {
        _enter(alice, aliceOp);
        Resolution memory res = _commit(aliceOp, alice, Encounter.MONSTER, Action.FLEE, Outcome.FLEE_FAIL_WIN);
        vm.prank(stranger);
        d.settle(alice);
        assertEq(_run(alice).bag, res.lootTable);
    }

    function test_settle_treasure() public {
        _enter(alice, aliceOp);
        Resolution memory res = _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        assertGe(res.lootTable, 200 * MMON);
        assertLe(res.lootTable, 1000 * MMON);
        vm.prank(stranger);
        d.settle(alice);
        assertEq(_run(alice).bag, res.lootTable);
    }

    function test_settle_mimicWin() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 4);
        // beli sword supaya mimic (floor + 2) bisa dikalahkan
        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.prank(aliceOp);
        d.act(Action.BUY, 2, 0, 0, false);
        _descend(aliceOp);
        uint128 bag0 = _run(alice).bag;
        Resolution memory res = _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.MIMIC_WIN);
        (,, uint128 loot) = d.monsterStats(_run(alice).floor);
        assertEq(res.lootTable, loot * 2);
        vm.prank(stranger);
        d.settle(alice);
        assertEq(_run(alice).bag, bag0 + loot * 2);
    }

    function test_settle_trapHp() public {
        _enter(alice, aliceOp);
        _commit(aliceOp, alice, Encounter.TRAP, Action.PROCEED, Outcome.TRAP_HP);
        vm.prank(stranger);
        d.settle(alice);
        assertEq(_run(alice).hp, DepthsLogic.BASE_HP - 13);
    }

    function test_settle_trapLoot_bagToPool() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 1);
        uint128 bag0 = _run(alice).bag;
        uint128 pool0 = d.pool();
        _commit(aliceOp, alice, Encounter.TRAP, Action.PROCEED, Outcome.TRAP_LOOT);
        vm.expectEmit(address(d));
        emit FloorResolved(alice, 1, 2, Action.PROCEED, _resolveSeed(alice), true, DepthsLogic.BASE_HP, -int128(bag0 / 5), 7);
        vm.prank(stranger);
        d.settle(alice);
        assertEq(_run(alice).bag, bag0 - bag0 / 5);
        assertEq(d.pool(), pool0 + bag0 / 5);
        assertEq(d.reserved(), bag0 - bag0 / 5);
        _assertSolvent();
    }

    function test_settle_disarmOk_salvage() public {
        _enter(alice, aliceOp);
        _commit(aliceOp, alice, Encounter.TRAP, Action.DISARM, Outcome.DISARM_OK);
        vm.prank(stranger);
        d.settle(alice);
        assertEq(_run(alice).bag, 100 * MMON);
    }

    function test_settle_disarmFail_survive() public {
        _enter(alice, aliceOp);
        _commit(aliceOp, alice, Encounter.TRAP, Action.DISARM, Outcome.DISARM_FAIL);
        vm.prank(stranger);
        d.settle(alice);
        assertEq(_run(alice).hp, DepthsLogic.BASE_HP - 26);
    }

    function test_settle_disarmFail_fatal_causeTrap() public {
        _enter(alice, aliceOp);
        // floor 19: kerugian 2 × (10 + 57) = 134 > 130 HP (BASE_HP)
        _reachFloor(alice, aliceOp, 19);
        _commit(aliceOp, alice, Encounter.TRAP, Action.DISARM, Outcome.DISARM_FAIL);
        vm.expectEmit(address(d));
        emit RunDied(alice, 1, 19, 0, uint8(DeathCause.TRAP));
        vm.prank(stranger);
        d.settle(alice);
        assertEq(uint8(_state(alice)), uint8(RunState.NONE));
    }

    function test_settle_lootCappedByPool() public {
        // pool tipis: hanya dari entry fee
        Depths d2 = new Depths(admin);
        d = d2;
        _enter(alice, aliceOp);
        uint128 pool0 = d.pool(); // 0.95 MON
        Resolution memory res = _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        uint128 cap = pool0 * 500 / 1e4;
        assertLt(cap, res.lootTable);
        vm.expectEmit(address(d));
        emit LootAwarded(alice, 1, cap, res.lootTable);
        vm.prank(stranger);
        d.settle(alice);
        assertEq(_run(alice).bag, cap);
        assertEq(d.pool(), pool0 - cap);
        _assertSolvent();
    }

    function test_settle_permissionless_tooEarly_wrongState() public {
        _enter(alice, aliceOp);
        vm.expectRevert(abi.encodeWithSelector(WrongState.selector, RunState.AWAIT_SETTLE, RunState.AWAIT_REVEAL));
        d.settle(alice);
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        vm.expectRevert(abi.encodeWithSelector(TooEarly.selector, _target(alice), block.number));
        d.settle(alice);
    }

    // ================================================================ mati di lazy settle

    function test_descend_deathDoesNotRevert() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 2);
        _reachFloor(alice, aliceOp, 12);
        uint128 bag = _run(alice).bag;
        assertGt(bag, 0);
        uint128 pool0 = d.pool();
        uint256 aliceBal = alice.balance;
        _commit(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, Outcome.KILLED);

        vm.expectEmit(address(d));
        emit FloorResolved(alice, 1, 12, Action.FIGHT, _resolveSeed(alice), false, 0, 0, uint8(Outcome.KILLED));
        vm.expectEmit(address(d));
        emit RunDied(alice, 1, 12, bag, uint8(DeathCause.KILLED));
        _descend(aliceOp);

        assertEq(uint8(_state(alice)), uint8(RunState.NONE), "run dihapus");
        assertEq(d.operatorOf(aliceOp), address(0));
        assertEq(d.pool(), pool0 + bag, "bag masuk pool");
        assertEq(d.reserved(), 0);
        assertEq(alice.balance, aliceBal, "tidak ada transfer");
        (, uint8 best,, uint128 lost) = d.stats(alice);
        assertEq(best, 12);
        assertEq(lost, bag);
        _assertSolvent();
    }

    function test_cashOut_deathDoesNotRevert() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 1);
        _reachFloor(alice, aliceOp, 12);
        uint256 aliceBal = alice.balance;
        _commit(aliceOp, alice, Encounter.MONSTER, Action.FLEE, Outcome.FLEE_FAIL_KILLED);
        vm.recordLogs();
        _cashOut(aliceOp);
        assertEq(uint8(_state(alice)), uint8(RunState.NONE));
        assertEq(alice.balance, aliceBal, "mati = tidak ada payout");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_count(logs, CashedOut.selector), 0, "tidak ada CashedOut");
        assertEq(_count(logs, RunDied.selector), 1);
        _assertSolvent();
    }

    function test_mimicKilled() public {
        _enter(alice, aliceOp);
        _reachFloor(alice, aliceOp, 8);
        _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.MIMIC_KILLED);
        vm.expectEmit(address(d));
        emit RunDied(alice, 1, 8, 0, uint8(DeathCause.KILLED));
        _descend(aliceOp);
    }

    // ================================================================ descend

    function test_descend_tooEarly() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        // tx keputusan berikutnya di blok yang sama dengan act
        vm.expectRevert(abi.encodeWithSelector(TooEarly.selector, _target(alice), block.number));
        _descend(aliceOp);
        vm.expectRevert(abi.encodeWithSelector(TooEarly.selector, _target(alice), block.number));
        _cashOut(aliceOp);
    }

    function test_descend_wrongState() public {
        _enter(alice, aliceOp);
        _roll(2);
        vm.expectRevert(abi.encodeWithSelector(WrongState.selector, RunState.FLOOR_CLEARED, RunState.AWAIT_REVEAL));
        _descend(aliceOp);
        vm.expectRevert(abi.encodeWithSelector(WrongState.selector, RunState.FLOOR_CLEARED, RunState.AWAIT_REVEAL));
        _cashOut(aliceOp);
    }

    function test_descend_notController() public {
        vm.expectRevert(NotRunController.selector);
        _descend(stranger);
        vm.expectRevert(NotRunController.selector);
        _cashOut(stranger);
    }

    function test_descend_fromFloorCleared() public {
        _enter(alice, aliceOp);
        _commit(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, Outcome.WIN);
        d.settle(alice);
        vm.expectEmit(address(d));
        emit FloorEntered(alice, 1, 2, uint64(block.number + 1));
        _descend(aliceOp);
        Run memory r = _run(alice);
        assertEq(r.floor, 2);
        assertEq(r.encounter, 0);
    }

    // ================================================================ floor 20

    function test_floor20_descendReverts() public {
        _enter(alice, aliceOp);
        _reachFloor(alice, aliceOp, 20);
        _act(aliceOp, alice, Encounter.TREASURE, Action.LEAVE, false);
        vm.expectRevert(MaxFloorReached.selector);
        _descend(aliceOp);
        // BUY/LEAVE di floor 20 → FLOOR_CLEARED, lalu cash out manual
        _cashOut(aliceOp);
        (, uint8 best,,) = d.stats(alice);
        assertEq(best, 20);
    }

    function test_floor20_descendRevertsInAwaitSettle() public {
        _enter(alice, aliceOp);
        _reachFloor(alice, aliceOp, 20);
        _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        vm.expectRevert(MaxFloorReached.selector);
        _descend(aliceOp);
    }

    function test_floor20_autoCashOut_viaSettle() public {
        _enter(alice, aliceOp);
        _reachFloor(alice, aliceOp, 20);
        Resolution memory res = _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        uint256 bal = alice.balance;
        vm.expectEmit(address(d));
        emit CashedOut(alice, 1, 20, res.lootTable);
        vm.prank(stranger);
        d.settle(alice);
        assertEq(alice.balance - bal, res.lootTable, "auto cash out ke owner");
        assertEq(uint8(_state(alice)), uint8(RunState.NONE));
        _assertSolvent();
    }

    function test_floor20_autoCashOut_viaCashOut() public {
        _enter(alice, aliceOp);
        _reachFloor(alice, aliceOp, 20);
        Resolution memory res = _commit(aliceOp, alice, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        uint256 bal = alice.balance;
        vm.recordLogs();
        _cashOut(aliceOp);
        assertEq(alice.balance - bal, res.lootTable, "dibayar sekali");
        assertEq(_count(vm.getRecordedLogs(), CashedOut.selector), 1);
    }

    // ================================================================ cashOut

    function test_cashOut_byOperator_paysOwner() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 2);
        _commit(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, Outcome.WIN);
        d.settle(alice);
        uint128 bag = _run(alice).bag;
        uint256 aliceBal = alice.balance;
        uint256 opBal = aliceOp.balance;

        vm.expectEmit(address(d));
        emit CashedOut(alice, 1, 3, bag);
        _cashOut(aliceOp);

        assertEq(alice.balance - aliceBal, bag, "payout ke owner");
        assertEq(aliceOp.balance, opBal, "operator tidak menerima apa pun");
        assertEq(uint8(_state(alice)), uint8(RunState.NONE));
        assertEq(d.operatorOf(aliceOp), address(0));
        assertEq(d.reserved(), 0);
        (uint32 runs, uint8 best, uint128 cashed,) = d.stats(alice);
        assertEq(runs, 1);
        assertEq(best, 3);
        assertEq(cashed, bag);
        (BoardEntry[10] memory cash, BoardEntry[10] memory depth) = d.getBoards();
        assertEq(cash[0].player, alice);
        assertEq(cash[0].value, bag);
        assertEq(depth[0].floor, 3);
        _assertSolvent();
    }

    function test_cashOut_lazySettle() public {
        _enter(alice, aliceOp);
        Resolution memory res = _commit(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, Outcome.WIN);
        uint256 bal = alice.balance;
        _cashOut(aliceOp);
        assertEq(alice.balance - bal, res.lootTable);
        _assertSolvent();
    }

    function test_cashOut_emptyBag() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.TREASURE, Action.LEAVE, false);
        _cashOut(aliceOp);
        assertEq(uint8(_state(alice)), uint8(RunState.NONE));
        (BoardEntry[10] memory cash, BoardEntry[10] memory depth) = d.getBoards();
        assertEq(cash[0].player, address(0), "bag 0 tidak masuk board cash out");
        assertEq(depth[0].player, alice);
    }

    function test_cashOut_transferFailed() public {
        Rejecter rj = new Rejecter();
        vm.deal(address(rj), 10 ether);
        vm.prank(address(rj));
        d.enterDungeon{value: FEE + TOPUP}(aliceOp);
        _commit(aliceOp, address(rj), Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
        vm.expectRevert(TransferFailed.selector);
        _cashOut(aliceOp);
    }

    // ================================================================ operator

    function test_operator_isolatedPerOwner() public {
        _enter(alice, aliceOp);
        _enter(bob, bobOp);
        _act(bobOp, bob, Encounter.MONSTER, Action.FIGHT, false);
        // bobOp hanya menyentuh run bob
        assertEq(uint8(_state(bob)), uint8(RunState.AWAIT_SETTLE));
        assertEq(uint8(_state(alice)), uint8(RunState.AWAIT_REVEAL));
        assertEq(d.ownerOf(bobOp), bob);
        assertEq(d.ownerOf(stranger), address(0));
    }

    function test_withdrawOperator() public {
        _enter(alice, aliceOp);
        vm.prank(aliceOp);
        d.withdrawOperator();
        assertEq(d.operatorOf(aliceOp), address(0));
        assertEq(_run(alice).operator, address(0));
        _roll(2);
        vm.expectRevert(NotRunController.selector);
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);
        // owner tetap bisa main
        _act(alice, alice, Encounter.MONSTER, Action.FIGHT, false);
        vm.expectRevert(NotRunController.selector);
        vm.prank(aliceOp);
        d.withdrawOperator();
    }

    // ================================================================ slot basi setelah run selesai

    function test_secondRun_startsClean() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 4);
        _roll(2);
        _forceEncounter(alice, Encounter.MERCHANT);
        vm.prank(aliceOp);
        d.act(Action.BUY, 1, 1, 1, false);
        _cashOut(aliceOp);

        Run memory ended = _run(alice);
        assertEq(ended.state, 0);
        assertEq(ended.runId, 0, "getRun kosong untuk run selesai");
        assertEq(ended.operator, address(0));

        _enter(alice, aliceOp);
        Run memory r = _run(alice);
        assertEq(r.runId, 2);
        assertEq(r.floor, 1);
        assertEq(r.hp, DepthsLogic.BASE_HP);
        assertEq(r.maxHp, DepthsLogic.BASE_HP);
        assertEq(r.atk, 12);
        assertEq(r.swords + r.shields + r.potions, 0);
        assertEq(r.bag, 0);
        assertEq(r.encounter, 0);
        assertEq(r.pendingAction, 0);
        assertFalse(r.usePotion);
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        bytes32 seed =
            keccak256(abi.encode(blockhash(_run(alice).targetBlock - 2), alice, uint32(2), uint8(1), uint8(1)));
        assertEq(_run(alice).encounterSeed, seed, "seed run baru, bukan sisa run lama");
    }

    function test_staleOperator_cannotControlNextRun() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.TREASURE, Action.LEAVE, false);
        _cashOut(aliceOp);
        assertEq(d.operatorOf(aliceOp), address(0));
        assertEq(d.ownerOf(aliceOp), address(0));

        // run baru tanpa operator: operator lama tidak boleh menyentuh
        _enter(alice, address(0));
        _roll(2);
        vm.expectRevert(NotRunController.selector);
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);

        // run baru dengan operator lain: operator lama tetap tidak berlaku
        _act(alice, alice, Encounter.TREASURE, Action.LEAVE, false);
        _cashOut(alice);
        address op2 = makeAddr("op2");
        _enter(alice, op2);
        assertEq(d.ownerOf(op2), alice);
        assertEq(d.ownerOf(aliceOp), address(0));
    }

    function test_staleOperator_reusableByOthers() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.TREASURE, Action.LEAVE, false);
        _cashOut(aliceOp);
        // operator basi milik alice bisa dipakai bob, dan bisa memulai run sendiri
        _enter(bob, aliceOp);
        assertEq(d.ownerOf(aliceOp), bob);
        vm.expectRevert(OperatorInUse.selector);
        vm.prank(alice);
        d.enterDungeon{value: FEE}(aliceOp);
    }

    function test_staleOperator_canStartOwnRun() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.TREASURE, Action.LEAVE, false);
        _cashOut(aliceOp);
        vm.deal(aliceOp, 10 ether);
        _enter(aliceOp, address(0));
        assertEq(d.ownerOf(aliceOp), aliceOp);
    }

    function test_operatorIsOwnerItself() public {
        vm.prank(alice);
        d.enterDungeon{value: FEE + TOPUP}(alice);
        assertEq(d.ownerOf(alice), alice);
        _act(alice, alice, Encounter.TREASURE, Action.LEAVE, false);
        _cashOut(alice);
        _enter(alice, address(0));
    }

    // ================================================================ expiry

    function test_expiry_act() public {
        _enter(alice, aliceOp);
        vm.roll(_target(alice) + WINDOW + 1);
        _expectExpiredDeath(alice, 1);
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);
        assertEq(uint8(_state(alice)), uint8(RunState.NONE));
    }

    function test_expiry_windowBoundaryStillValid() public {
        _enter(alice, aliceOp);
        vm.roll(_target(alice) + WINDOW);
        _forceEncounter(alice, Encounter.MONSTER);
        (,, bool ready, bool expired) = d.previewEncounter(alice);
        assertTrue(ready);
        assertFalse(expired);
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);
        assertEq(uint8(_state(alice)), uint8(RunState.AWAIT_SETTLE));
    }

    function test_expiry_descend() public {
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 1);
        uint128 bag = _run(alice).bag;
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        vm.roll(_target(alice) + WINDOW + 1);
        _expectExpiredDeath(alice, 2, bag);
        _descend(aliceOp);
        assertEq(uint8(_state(alice)), uint8(RunState.NONE));
        _assertSolvent();
    }

    function test_expiry_cashOut() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        vm.roll(_target(alice) + WINDOW + 1);
        uint256 bal = alice.balance;
        _expectExpiredDeath(alice, 1);
        _cashOut(aliceOp);
        assertEq(alice.balance, bal);
    }

    function test_expiry_reveal() public {
        _enter(alice, aliceOp);
        vm.roll(_target(alice) + WINDOW + 1);
        (,, bool ready, bool expired) = d.previewEncounter(alice);
        assertTrue(ready && expired);
        _expectExpiredDeath(alice, 1);
        vm.prank(stranger);
        d.reveal(alice);
    }

    function test_expiry_settle() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        vm.roll(_target(alice) + WINDOW + 1);
        (,, bool ready, bool expired) = d.previewResolve(alice);
        assertTrue(ready && expired);
        _expectExpiredDeath(alice, 1);
        vm.prank(stranger);
        d.settle(alice);
    }

    function test_reapExpired() public {
        _enter(alice, aliceOp);
        vm.expectRevert(abi.encodeWithSelector(TooEarly.selector, _target(alice) + WINDOW, block.number));
        d.reapExpired(alice);
        vm.roll(_target(alice) + WINDOW + 1);
        _expectExpiredDeath(alice, 1);
        vm.prank(stranger);
        d.reapExpired(alice);
        vm.expectRevert(abi.encodeWithSelector(WrongState.selector, RunState.AWAIT_REVEAL, RunState.NONE));
        d.reapExpired(alice);
    }

    function test_reapExpired_awaitSettle() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        vm.roll(_target(alice) + WINDOW + 1);
        d.reapExpired(alice);
        assertEq(uint8(_state(alice)), uint8(RunState.NONE));
    }

    function test_reapExpired_wrongState() public {
        _enter(alice, aliceOp);
        _act(aliceOp, alice, Encounter.TREASURE, Action.LEAVE, false);
        _roll(1000);
        vm.expectRevert(abi.encodeWithSelector(WrongState.selector, RunState.AWAIT_REVEAL, RunState.FLOOR_CLEARED));
        d.reapExpired(alice);
    }

    // ================================================================ fallback reveal

    function test_reveal_fallback() public {
        _enter(alice, aliceOp);
        _roll(2);
        _forceEncounter(alice, Encounter.TRAP);
        vm.prank(stranger);
        d.reveal(alice);
        Run memory r = _run(alice);
        assertEq(r.state, uint8(RunState.AWAIT_ACTION));
        assertEq(r.encounter, uint8(Encounter.TRAP));
        // AWAIT_ACTION tidak punya expiry
        _roll(1000);
        vm.prank(aliceOp);
        d.act(Action.PROCEED, 0, 0, 0, false);
        assertEq(uint8(_state(alice)), uint8(RunState.AWAIT_SETTLE));
    }

    function test_reveal_tooEarly_wrongState() public {
        _enter(alice, aliceOp);
        vm.expectRevert(abi.encodeWithSelector(TooEarly.selector, _target(alice), block.number));
        d.reveal(alice);
        _roll(2);
        d.reveal(alice);
        vm.expectRevert(abi.encodeWithSelector(WrongState.selector, RunState.AWAIT_REVEAL, RunState.AWAIT_ACTION));
        d.reveal(alice);
    }

    // ================================================================ preview

    function test_previewEncounter_states() public {
        (Encounter e, uint8 mid, bool ready, bool expired) = d.previewEncounter(alice);
        assertEq(uint8(e), 0);
        assertFalse(ready || expired);
        assertEq(mid, 0);

        _enter(alice, aliceOp);
        (e,, ready,) = d.previewEncounter(alice);
        assertFalse(ready, "belum ready di blok commit");
        assertEq(uint8(e), 0);

        _roll(2);
        _forceEncounter(alice, Encounter.MONSTER);
        (Encounter pe, uint8 pmid,,) = d.previewEncounter(alice);
        vm.prank(aliceOp);
        d.act(Action.FIGHT, 0, 0, 0, false);
        Run memory r = _run(alice);
        assertEq(uint8(pe), r.encounter, "preview == tersimpan");
        assertEq(pmid, r.monsterId);
        (e, mid, ready,) = d.previewEncounter(alice);
        assertEq(uint8(e), r.encounter, "setelah reveal mengembalikan yang tersimpan");
        assertTrue(ready);
    }

    function test_previewResolve_matchesSettle() public {
        _enter(alice, aliceOp);
        (Resolution memory res, bytes32 seed, bool ready,) = d.previewResolve(alice);
        assertFalse(ready);
        assertEq(seed, bytes32(0));
        _act(aliceOp, alice, Encounter.MONSTER, Action.FIGHT, false);
        (,, ready,) = d.previewResolve(alice);
        assertFalse(ready);
        _roll(2);
        (res, seed, ready,) = d.previewResolve(alice);
        assertTrue(ready);
        assertEq(seed, _resolveSeed(alice));
        vm.expectEmit(address(d));
        emit FloorResolved(
            alice,
            1,
            1,
            Action.FIGHT,
            seed,
            res.survived,
            res.hpAfter,
            res.survived ? int128(res.lootTable) : int128(0),
            uint8(res.outcome)
        );
        d.settle(alice);
    }

    function testFuzz_preview_matchesStoredResult(bytes32 h1, bytes32 h2, uint8 choice) public {
        vm.assume(h1 != 0 && h2 != 0);
        _enter(alice, aliceOp);
        _roll(2);
        vm.setBlockhash(_target(alice), h1);
        (Encounter e,,,) = d.previewEncounter(alice);
        Action a = _pick(e, choice);
        vm.prank(aliceOp);
        d.act(a, 0, 0, 0, false);
        assertEq(_run(alice).encounter, uint8(e));
        if (a == Action.BUY || a == Action.LEAVE) return;
        _roll(2);
        vm.setBlockhash(_target(alice), h2);
        (Resolution memory res,,,) = d.previewResolve(alice);
        uint128 cap = d.pool() * 500 / 1e4;
        d.settle(alice);
        if (!res.survived) {
            assertEq(uint8(_state(alice)), uint8(RunState.NONE));
        } else {
            Run memory r = _run(alice);
            assertEq(r.hp, res.hpAfter);
            assertEq(r.bag, (res.lootTable < cap ? res.lootTable : cap) - res.bagLoss);
        }
        _assertSolvent();
    }

    // ================================================================ parity jalur normal vs fallback

    function test_parity_winTreasureCashOut() public {
        _parity(1, Encounter.MONSTER, Action.FIGHT, Outcome.WIN, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE);
    }

    function test_parity_deathOnSecondFloor() public {
        _parity(
            11,
            Encounter.TRAP,
            Action.DISARM,
            Outcome.DISARM_OK,
            Encounter.MONSTER,
            Action.FLEE,
            Outcome.FLEE_FAIL_KILLED
        );
    }

    function test_parity_treasureThenTrapLoss() public {
        _parity(1, Encounter.TREASURE, Action.OPEN, Outcome.TREASURE, Encounter.TRAP, Action.PROCEED, Outcome.TRAP_LOOT);
    }

    struct Snapshot {
        bytes32 logsHash;
        uint256 logCount;
        uint128 pool;
        uint128 reserved;
        uint128 treasury;
        uint256 balance;
        uint256 aliceBal;
        bytes32 runHash;
        bytes32 statsHash;
        bytes32 boardsHash;
    }

    /// @dev Dua lantai lalu cashOut, dijalankan lewat jalur normal dan fallback dengan blockhash yang sama.
    function _parity(uint8 startFloor, Encounter e1, Action a1, Outcome o1, Encounter e2, Action a2, Outcome o2)
        internal
    {
        _enter(alice, aliceOp);
        _reachFloor(alice, aliceOp, startFloor);
        // commit terakhir (enter/descend) terjadi di blok b, jadi target = b + 1
        uint256 b = block.number;
        uint256 snap = vm.snapshotState();

        // jalur normal, sekaligus memilih blockhash
        bytes32[4] memory h;
        vm.recordLogs();
        vm.roll(b + 2);
        _forceEncounter(alice, e1);
        h[0] = blockhash(b + 1);
        _actAs(aliceOp, a1);
        vm.roll(b + 4);
        _forceOutcome(alice, o1);
        h[1] = blockhash(b + 3);
        _descend(aliceOp);
        vm.roll(b + 6);
        _forceEncounter(alice, e2);
        h[2] = blockhash(b + 5);
        _actAs(aliceOp, a2);
        vm.roll(b + 8);
        _forceOutcome(alice, o2);
        h[3] = blockhash(b + 7);
        _cashOutIfAlive();
        Snapshot memory normal = _snapshot();

        vm.revertToState(snap);
        vm.recordLogs();
        vm.roll(b + 2);
        vm.setBlockhash(b + 1, h[0]);
        vm.prank(stranger);
        d.reveal(alice);
        _actAs(aliceOp, a1);
        vm.roll(b + 4);
        vm.setBlockhash(b + 3, h[1]);
        vm.prank(stranger);
        d.settle(alice);
        _descend(aliceOp);
        vm.roll(b + 6);
        vm.setBlockhash(b + 5, h[2]);
        vm.prank(stranger);
        d.reveal(alice);
        _actAs(aliceOp, a2);
        vm.roll(b + 8);
        vm.setBlockhash(b + 7, h[3]);
        vm.prank(stranger);
        d.settle(alice);
        _cashOutIfAlive();
        Snapshot memory fallback_ = _snapshot();

        assertGt(normal.logCount, 5);
        assertEq(normal.logCount, fallback_.logCount, "jumlah event");
        assertEq(normal.logsHash, fallback_.logsHash, "event identik");
        assertEq(normal.pool, fallback_.pool);
        assertEq(normal.reserved, fallback_.reserved);
        assertEq(normal.treasury, fallback_.treasury);
        assertEq(normal.balance, fallback_.balance);
        assertEq(normal.aliceBal, fallback_.aliceBal, "saldo owner");
        assertEq(normal.runHash, fallback_.runHash, "state run");
        assertEq(normal.statsHash, fallback_.statsHash);
        assertEq(normal.boardsHash, fallback_.boardsHash);
        _assertSolvent();
    }

    function _actAs(address caller, Action a) internal {
        vm.prank(caller);
        d.act(a, 0, 0, 0, false);
    }

    function _cashOutIfAlive() internal {
        if (_state(alice) != RunState.NONE) _cashOut(aliceOp);
    }

    function _snapshot() internal returns (Snapshot memory s) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes memory packed;
        for (uint256 k; k < logs.length; ++k) {
            packed = abi.encode(keccak256(packed), logs[k].emitter, logs[k].topics, logs[k].data);
        }
        s.logsHash = keccak256(packed);
        s.logCount = logs.length;
        (s.pool, s.reserved, s.treasury,) = d.poolInfo();
        s.balance = address(d).balance;
        s.aliceBal = alice.balance;
        s.runHash = keccak256(abi.encode(d.getRun(alice)));
        (uint32 runs, uint8 best, uint128 cashed, uint128 lost) = d.stats(alice);
        s.statsHash = keccak256(abi.encode(runs, best, cashed, lost));
        (BoardEntry[10] memory cash, BoardEntry[10] memory depth) = d.getBoards();
        s.boardsHash = keccak256(abi.encode(cash, depth));
    }

    // ================================================================ board

    function test_boards_insertionSort() public {
        address[12] memory players;
        uint256[12] memory lootFloors = [uint256(1), 3, 2, 5, 1, 4, 2, 6, 3, 1, 2, 7];
        for (uint256 k; k < 12; ++k) {
            players[k] = makeAddr(string.concat("p", vm.toString(k)));
            vm.deal(players[k], 10 ether);
            _enter(players[k], address(0));
            _lootFloors(players[k], players[k], lootFloors[k]);
            _act(players[k], players[k], Encounter.TREASURE, Action.LEAVE, false);
            _cashOut(players[k]);
        }
        (BoardEntry[10] memory cash, BoardEntry[10] memory depth) = d.getBoards();
        for (uint256 k = 1; k < 10; ++k) {
            assertGe(cash[k - 1].value, cash[k].value, "cash desc");
            assertTrue(
                depth[k - 1].floor > depth[k].floor
                    || (depth[k - 1].floor == depth[k].floor && depth[k - 1].value >= depth[k].value),
                "depth desc"
            );
            assertTrue(cash[k].player != address(0));
        }
        assertEq(depth[0].floor, 8, "7 lantai loot + 1 lantai merchant");
        assertEq(depth[0].player, players[11]);
        // floor: 8,7,6,5,4,4,3,3,3,2 | dua dari tiga entry floor 2 terdepak
        assertEq(depth[9].floor, 2);
    }

    function test_boards_deathCountsForDepth() public {
        _enter(alice, aliceOp);
        _reachFloor(alice, aliceOp, 9);
        vm.roll(_target(alice) + WINDOW + 1);
        d.reapExpired(alice);
        (BoardEntry[10] memory cash, BoardEntry[10] memory depth) = d.getBoards();
        assertEq(cash[0].player, address(0));
        assertEq(depth[0].player, alice);
        assertEq(depth[0].floor, 9);
    }

    // ================================================================ fuzz

    /// @dev `act` dengan input acak tidak pernah merusak invariant (CONTRACT_SPEC §9).
    function testFuzz_act_randomInputs(
        bytes32 h,
        uint8 a,
        uint8 s,
        uint8 sh,
        uint8 p,
        bool pot,
        uint16 wait,
        bool viaOperator
    ) public {
        vm.assume(h != 0);
        _enter(alice, aliceOp);
        _lootFloors(alice, aliceOp, 2);
        _roll(1 + uint256(wait) % 300);
        if (block.number <= _target(alice) + WINDOW) vm.setBlockhash(_target(alice), h);
        vm.prank(viaOperator ? aliceOp : alice);
        try d.act(Action(a % 8), s % 7, sh % 7, p % 5, pot) {} catch {}
        Run memory r = _run(alice);
        assertEq(d.reserved(), r.bag, "reserved == bag");
        assertLe(r.hp, r.maxHp);
        _assertSolvent();
        if (r.state == uint8(RunState.AWAIT_SETTLE)) {
            _roll(1 + uint256(wait) % 300);
            try d.settle(alice) {} catch {}
            assertEq(d.reserved(), _run(alice).bag);
            _assertSolvent();
        }
    }

    // ================================================================ helpers

    function _resolveSeed(address owner) internal view returns (bytes32) {
        Run memory r = _run(owner);
        return keccak256(abi.encode(blockhash(r.targetBlock), owner, r.runId, r.floor, uint8(2)));
    }

    function _expectExpiredDeath(address owner, uint8 floor) internal {
        _expectExpiredDeath(owner, floor, 0);
    }

    function _expectExpiredDeath(address owner, uint8 floor, uint128 bag) internal {
        vm.expectEmit(address(d));
        emit RunDied(owner, _run(owner).runId, floor, bag, uint8(DeathCause.EXPIRED));
    }

    function _pick(Encounter e, uint8 choice) internal pure returns (Action) {
        bool first = choice % 2 == 0;
        if (e == Encounter.MONSTER) return first ? Action.FIGHT : Action.FLEE;
        if (e == Encounter.TREASURE) return first ? Action.OPEN : Action.LEAVE;
        if (e == Encounter.TRAP) return first ? Action.PROCEED : Action.DISARM;
        return Action.LEAVE;
    }

    function _count(Vm.Log[] memory logs, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 k; k < logs.length; ++k) {
            if (logs[k].topics[0] == sig) ++n;
        }
    }
}
