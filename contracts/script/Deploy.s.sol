// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";

/// @notice Simulation-only deploy script for the Safe multisig flow.
/// @dev Run WITHOUT --broadcast and WITH `--sender <SAFE_ADDRESS>`; the resulting
///      dry-run artifact carries the deployment bytecode that gets proposed to the
///      Safe via `propose.sh` (monskills `wallet/` skill). The Safe delegatecalls
///      CreateCall so the Safe itself is the deployer.
///
///      forge script script/Deploy.s.sol:DeployScript \
///        --rpc-url https://testnet-rpc.monad.xyz \
///        --sender $SAFE_ADDRESS
contract DeployScript is Script {
    function run() external returns (address factory) {
        vm.startBroadcast();
        factory = address(new CampaignFactory());
        vm.stopBroadcast();

        console.log("CampaignFactory (simulated) at:", factory);
    }
}
