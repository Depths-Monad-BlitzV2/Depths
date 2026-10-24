// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {RngProbe} from "../src/spike/RngProbe.sol";

/// @notice forge script script/RngProbe.s.sol --rpc-url monad_testnet --broadcast
contract DeployRngProbe is Script {
    function run() external returns (RngProbe probe) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        probe = new RngProbe();
        vm.stopBroadcast();
        console.log("RngProbe:", address(probe));
    }
}
