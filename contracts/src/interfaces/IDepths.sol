// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Action, Encounter, Run, BoardEntry, Resolution} from "../DepthsTypes.sol";

/// @notice Interface publik Depths untuk frontend dan keeper. Lihat docs/CONTRACT_SPEC.md §4.
interface IDepths {
    // ---------------------------------------------------------------- player / operator
    function enterDungeon(address operator) external payable;
    function act(Action a, uint8 swordQty, uint8 shieldQty, uint8 potionQty, bool usePotion) external;
    function descend() external;
    function cashOut() external;
    function withdrawOperator() external;

    // ---------------------------------------------------------------- relay fallback (permissionless)
    function reveal(address owner) external;
    function settle(address owner) external;
    function reapExpired(address owner) external;

    // ---------------------------------------------------------------- admin
    function seedPool() external payable;
    function setEntryFee(uint128 fee) external;
    function withdrawTreasury(address to, uint128 amt) external;
    function pause() external;
    function unpause() external;

    // ---------------------------------------------------------------- view
    function getRun(address owner) external view returns (Run memory);
    function ownerOf(address caller) external view returns (address);
    function operatorOf(address operator) external view returns (address);
    function previewEncounter(address owner)
        external
        view
        returns (Encounter enc, uint8 monsterId, bool ready, bool expired);
    function previewResolve(address owner)
        external
        view
        returns (Resolution memory res, bytes32 seed, bool ready, bool expired);
    function monsterStats(uint8 floor) external pure returns (uint16 hp, uint16 atk, uint128 loot);
    function getBoards() external view returns (BoardEntry[10] memory cashouts, BoardEntry[10] memory depths);
    function poolInfo() external view returns (uint128, uint128, uint128, uint128);
}
