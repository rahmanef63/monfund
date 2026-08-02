// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Campaign} from "./Campaign.sol";

/// @title CampaignFactory
/// @notice Deploys `Campaign` instances and keeps an onchain array of every campaign
///         address it has created, so the frontend can list campaigns with plain
///         `eth_call`s and no indexer.
/// @dev    Testnet demo contract. NOT AUDITED. Do not use with real funds.
///         The factory holds no funds and has no owner, admin or moderation role.
contract CampaignFactory {
    /// @notice Every campaign ever deployed by this factory, in creation order.
    address[] public campaigns;

    /// @notice True if the address was deployed by this factory.
    mapping(address campaign => bool created) public isCampaign;

    event CampaignCreated(
        address indexed campaign, address indexed creator, uint256 goal, uint256 deadline, uint256 index
    );

    error BadRange();

    /// @notice Deploy a new campaign owned by `msg.sender`.
    /// @param goal        Funding goal in wei of native MON. Must be greater than zero.
    /// @param deadline    Unix timestamp, strictly in the future.
    /// @param description Short description, 1..280 bytes.
    /// @return campaign   Address of the newly deployed campaign.
    function createCampaign(uint256 goal, uint256 deadline, string calldata description)
        external
        returns (address campaign)
    {
        // Argument validation lives in the Campaign constructor — one source of truth.
        campaign = address(new Campaign(msg.sender, goal, deadline, description));

        uint256 index = campaigns.length;
        campaigns.push(campaign);
        isCampaign[campaign] = true;

        emit CampaignCreated(campaign, msg.sender, goal, deadline, index);
    }

    /// @notice Number of campaigns deployed so far.
    function campaignsCount() external view returns (uint256) {
        return campaigns.length;
    }

    /// @notice The full campaign array.
    function getCampaigns() external view returns (address[] memory) {
        return campaigns;
    }

    /// @notice A slice of the campaign array, newest-last.
    /// @param offset Index to start from.
    /// @param limit  Maximum number of addresses to return.
    function getCampaigns(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = campaigns.length;
        if (offset > total) revert BadRange();

        // Clamped as `limit` vs the remaining tail, never as `offset + limit`, which
        // overflows for a large sentinel limit. `offset <= total` above makes the
        // subtraction safe.
        uint256 end = limit > total - offset ? total : offset + limit;

        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = campaigns[i];
        }
    }
}
