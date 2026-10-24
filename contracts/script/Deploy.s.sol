// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Depths} from "../src/Depths.sol";

/// @notice Deploy Depths + seed pool (testnet / anvil saja, CLAUDE.md aturan 9).
/// @dev forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
///      Env: PRIVATE_KEY (wajib), SEED_POOL (wei, default 0), OWNER (default deployer).
///      Hasil ditulis ke deployments/<chainId>.json untuk README, apps/web/.env.local, dan keeper.
contract DeployDepths is Script {
    uint256 internal constant MONAD_TESTNET = 10143;
    uint256 internal constant ANVIL = 31337;

    function run() external returns (Depths depths) {
        if (block.chainid != MONAD_TESTNET && block.chainid != ANVIL) revert("Deploy: hanya testnet/anvil");
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        uint256 seed = vm.envOr("SEED_POOL", uint256(0));
        address owner = vm.envOr("OWNER", deployer);

        vm.startBroadcast(key);
        depths = new Depths{value: seed}(owner);
        vm.stopBroadcast();

        // blok deploy = blok saat ini (simulasi); dipakai sebagai NEXT_PUBLIC_DEPLOY_BLOCK (awal scan event)
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeUint(obj, "seedPool", seed);
        vm.serializeUint(obj, "deployBlock", block.number);
        string memory json = vm.serializeAddress(obj, "depths", address(depths));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));

        console.log("Depths:", address(depths));
        console.log("owner:", owner);
        console.log("seed pool (wei):", seed);
        console.log("deploy block (approx):", block.number);
    }
}
