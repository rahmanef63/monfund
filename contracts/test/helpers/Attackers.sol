// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Campaign} from "../../src/Campaign.sol";

/// @notice Malicious campaign creator: tries to re-enter `withdraw()` from its
///         `receive()` while the first withdrawal is still executing.
contract ReentrantCreator {
    Campaign public campaign;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;
    /// @notice Selector of the last revert the re-entrant call produced. Swallowing it
    ///         would make every test pass on CEI alone, whether or not a guard exists.
    bytes4 public lastError;
    bool internal armed;

    function setCampaign(Campaign c) external {
        campaign = c;
    }

    function createVia(address factory, uint256 goal, uint256 deadline, string calldata description)
        external
        returns (address)
    {
        (bool ok, bytes memory ret) = factory.call(
            abi.encodeWithSignature("createCampaign(uint256,uint256,string)", goal, deadline, description)
        );
        require(ok, "create failed");
        address c = abi.decode(ret, (address));
        campaign = Campaign(c);
        return c;
    }

    function attackWithdraw() external {
        armed = true;
        campaign.withdraw();
        armed = false;
    }

    receive() external payable {
        if (!armed) return;
        reentryAttempts++;
        // Re-enter. Must revert on the ReentrancyGuard; if it ever succeeds the
        // guard is broken and we record it.
        try campaign.withdraw() {
            reentrySucceeded = true;
        } catch (bytes memory err) {
            lastError = bytes4(err);
        }
    }
}

/// @notice Malicious contributor: tries to re-enter `refund()` from its `receive()`
///         to drain more than it put in.
contract ReentrantContributor {
    Campaign public campaign;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;
    /// @notice Selector of the last revert the re-entrant call produced.
    bytes4 public lastError;
    bool internal armed;

    function setCampaign(Campaign c) external {
        campaign = c;
    }

    function contribute(uint256 amount) external payable {
        campaign.contribute{value: amount}();
    }

    function attackRefund() external {
        armed = true;
        campaign.refund();
        armed = false;
    }

    receive() external payable {
        if (!armed) return;
        reentryAttempts++;
        try campaign.refund() {
            reentrySucceeded = true;
        } catch (bytes memory err) {
            lastError = bytes4(err);
        }
    }
}

/// @notice Malicious campaign creator: tries to re-enter `contribute()` from its
///         `receive()` while `withdraw()` is still executing.
/// @dev    This is the only cross-function re-entrancy that is reachable in time.
///         `withdraw()` has no deadline check, so the creator can withdraw while the
///         campaign is still open — `refund()` and `contribute()`, by contrast, are
///         mutually exclusive in time and can never re-enter one another.
contract WithdrawToContributeReentrant {
    Campaign public campaign;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;
    /// @notice Selector of the last revert the re-entrant call produced.
    bytes4 public lastError;
    bool internal armed;

    function createVia(address factory, uint256 goal, uint256 deadline, string calldata description)
        external
        returns (address)
    {
        (bool ok, bytes memory ret) = factory.call(
            abi.encodeWithSignature("createCampaign(uint256,uint256,string)", goal, deadline, description)
        );
        require(ok, "create failed");
        address c = abi.decode(ret, (address));
        campaign = Campaign(c);
        return c;
    }

    function attackWithdraw() external {
        armed = true;
        campaign.withdraw();
        armed = false;
    }

    receive() external payable {
        if (!armed) return;
        reentryAttempts++;
        // The withdrawal has already credited this contract, so the 1 wei is available.
        try campaign.contribute{value: 1 wei}() {
            reentrySucceeded = true;
        } catch (bytes memory err) {
            lastError = bytes4(err);
        }
    }
}

/// @notice Recipient that always reverts on receiving MON — used to prove the
///         contract surfaces a failed transfer instead of silently swallowing it.
contract RejectingReceiver {
    Campaign public campaign;

    function setCampaign(Campaign c) external {
        campaign = c;
    }

    function contribute(uint256 amount) external payable {
        campaign.contribute{value: amount}();
    }

    function doRefund() external {
        campaign.refund();
    }

    function doWithdraw() external {
        campaign.withdraw();
    }

    /// The escape hatch for exactly this contract: it can never receive MON itself, so
    /// the only way it can release the raise is by naming somebody else.
    function doWithdrawTo(address payable to) external {
        campaign.withdrawTo(to);
    }

    receive() external payable {
        revert("no thanks");
    }
}
