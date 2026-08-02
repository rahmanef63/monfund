// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Campaign} from "../src/Campaign.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";

contract CampaignFactoryTest is Test {
    CampaignFactory internal factory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant GOAL = 5 ether;
    string internal constant DESC = "Fund the community garden";

    event CampaignCreated(
        address indexed campaign, address indexed creator, uint256 goal, uint256 deadline, uint256 index
    );

    function setUp() public {
        vm.warp(1_700_000_000);
        factory = new CampaignFactory();
    }

    function test_StartsEmpty() public view {
        assertEq(factory.campaignsCount(), 0, "count");
        assertEq(factory.getCampaigns().length, 0, "array");
    }

    function test_CreateCampaign_AppendsToOnchainArray() public {
        uint256 deadline = block.timestamp + 3 days;

        vm.prank(alice);
        address a = factory.createCampaign(GOAL, deadline, DESC);
        vm.prank(bob);
        address b = factory.createCampaign(GOAL * 2, deadline + 1 days, "Second raise");

        assertEq(factory.campaignsCount(), 2, "count");
        assertEq(factory.campaigns(0), a, "index 0");
        assertEq(factory.campaigns(1), b, "index 1");

        address[] memory all = factory.getCampaigns();
        assertEq(all.length, 2, "array length");
        assertEq(all[0], a, "array 0");
        assertEq(all[1], b, "array 1");

        assertTrue(factory.isCampaign(a), "a registered");
        assertTrue(factory.isCampaign(b), "b registered");
        assertFalse(factory.isCampaign(address(0xdead)), "random address not registered");
    }

    function test_CreateCampaign_SetsCallerAsCreator() public {
        uint256 deadline = block.timestamp + 3 days;

        vm.prank(alice);
        Campaign a = Campaign(factory.createCampaign(GOAL, deadline, DESC));
        vm.prank(bob);
        Campaign b = Campaign(factory.createCampaign(GOAL, deadline, DESC));

        // The factory must never end up owning the campaign.
        assertEq(a.creator(), alice, "alice owns hers");
        assertEq(b.creator(), bob, "bob owns his");
        assertTrue(a.creator() != address(factory), "factory is not the creator");
    }

    function test_CreateCampaign_EmitsEvent() public {
        uint256 deadline = block.timestamp + 3 days;

        vm.prank(alice);
        address a = factory.createCampaign(GOAL, deadline, DESC);

        // Re-emit check with the known address.
        vm.expectEmit(true, true, true, true, address(factory));
        emit CampaignCreated(_predictNext(), alice, GOAL, deadline, 1);
        vm.prank(alice);
        factory.createCampaign(GOAL, deadline, DESC);

        assertTrue(a != address(0), "deployed");
    }

    function _predictNext() internal view returns (address) {
        return vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
    }

    function test_GetCampaigns_Paginated() public {
        uint256 deadline = block.timestamp + 3 days;
        address[] memory created = new address[](5);
        for (uint256 i = 0; i < 5; ++i) {
            vm.prank(alice);
            created[i] = factory.createCampaign(GOAL, deadline, DESC);
        }

        address[] memory page = factory.getCampaigns(0, 2);
        assertEq(page.length, 2, "first page length");
        assertEq(page[0], created[0], "first page 0");
        assertEq(page[1], created[1], "first page 1");

        page = factory.getCampaigns(3, 10); // limit runs past the end
        assertEq(page.length, 2, "tail page clamped");
        assertEq(page[0], created[3], "tail 0");
        assertEq(page[1], created[4], "tail 1");

        page = factory.getCampaigns(5, 5); // offset == length
        assertEq(page.length, 0, "empty tail");
    }

    /// A sentinel "give me everything" limit must clamp, not overflow `offset + limit`.
    function test_GetCampaigns_LargeLimitDoesNotOverflow() public {
        uint256 deadline = block.timestamp + 3 days;
        vm.prank(alice);
        address a = factory.createCampaign(GOAL, deadline, DESC);
        vm.prank(alice);
        address b = factory.createCampaign(GOAL, deadline, DESC);

        address[] memory page = factory.getCampaigns(0, type(uint256).max);
        assertEq(page.length, 2, "whole array");
        assertEq(page[0], a, "entry 0");

        // offset > 0 is where the naive `offset + limit` panics with 0x11.
        page = factory.getCampaigns(1, type(uint256).max);
        assertEq(page.length, 1, "clamped to the tail");
        assertEq(page[0], b, "tail entry");
    }

    function test_RevertWhen_PaginationOffsetPastEnd() public {
        // Empty factory: any non-zero offset is past the end.
        vm.expectRevert(CampaignFactory.BadRange.selector);
        factory.getCampaigns(1, 1);

        vm.prank(alice);
        factory.createCampaign(GOAL, block.timestamp + 3 days, DESC);

        // Non-empty: offset == length is the last valid offset and yields an empty page;
        // one past it reverts.
        assertEq(factory.getCampaigns(1, 1).length, 0, "offset == length is empty, not a revert");
        vm.expectRevert(CampaignFactory.BadRange.selector);
        factory.getCampaigns(2, 1);
    }

    function test_FactoryHoldsNoFunds() public {
        uint256 deadline = block.timestamp + 3 days;
        vm.prank(alice);
        Campaign c = Campaign(factory.createCampaign(GOAL, deadline, DESC));

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        c.contribute{value: 1 ether}();

        assertEq(address(factory).balance, 0, "factory never holds MON");
        assertEq(address(c).balance, 1 ether, "campaign holds it");
    }

    function test_CampaignsAreIndependent() public {
        uint256 deadline = block.timestamp + 3 days;
        vm.prank(alice);
        Campaign a = Campaign(factory.createCampaign(GOAL, deadline, DESC));
        vm.prank(bob);
        Campaign b = Campaign(factory.createCampaign(GOAL, deadline, "Second raise"));

        vm.deal(bob, 10 ether);
        vm.prank(bob);
        a.contribute{value: GOAL}();

        assertEq(a.totalRaised(), GOAL, "a funded");
        assertEq(b.totalRaised(), 0, "b untouched");

        // Draining A must not touch B.
        vm.prank(alice);
        a.withdraw();
        assertEq(address(b).balance, 0, "b balance still zero");
    }

    function testFuzz_ArrayStaysConsistent(uint8 n) public {
        n = uint8(bound(n, 1, 20));
        uint256 deadline = block.timestamp + 3 days;

        for (uint256 i = 0; i < n; ++i) {
            vm.prank(alice);
            factory.createCampaign(GOAL, deadline, DESC);
        }

        assertEq(factory.campaignsCount(), n, "count matches");
        address[] memory all = factory.getCampaigns();
        assertEq(all.length, n, "array matches");
        for (uint256 i = 0; i < n; ++i) {
            assertEq(all[i], factory.campaigns(i), "index matches");
            assertTrue(factory.isCampaign(all[i]), "registered");
        }
    }
}
