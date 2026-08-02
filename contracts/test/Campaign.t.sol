// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Campaign} from "../src/Campaign.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {
    ReentrantCreator,
    ReentrantContributor,
    WithdrawToContributeReentrant,
    RejectingReceiver
} from "./helpers/Attackers.sol";

contract CampaignTest is Test {
    CampaignFactory internal factory;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant GOAL = 10 ether;
    uint256 internal constant DURATION = 7 days;
    string internal constant DESC = "Fund the community garden";

    function setUp() public {
        // Start well past the epoch so `block.timestamp - x` never underflows.
        vm.warp(1_700_000_000);
        factory = new CampaignFactory();

        vm.deal(creator, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _newCampaign() internal returns (Campaign) {
        vm.prank(creator);
        return Campaign(factory.createCampaign(GOAL, block.timestamp + DURATION, DESC));
    }

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    function test_CreateCampaign_StoresParameters() public {
        Campaign c = _newCampaign();

        assertEq(c.creator(), creator, "creator");
        assertEq(c.goal(), GOAL, "goal");
        assertEq(c.deadline(), block.timestamp + DURATION, "deadline");
        assertEq(c.description(), DESC, "description");
        assertEq(c.totalRaised(), 0, "totalRaised");
        assertFalse(c.withdrawn(), "withdrawn");
        assertEq(uint256(c.state()), uint256(Campaign.State.Open), "state");
    }

    /// The factory always passes `msg.sender`, so `InvalidCreator` is only reachable by
    /// constructing a Campaign directly — which is exactly what a third-party integrator
    /// deploying one without the factory would do.
    function test_RevertWhen_CreatorIsZero() public {
        vm.expectRevert(Campaign.InvalidCreator.selector);
        new Campaign(address(0), GOAL, block.timestamp + DURATION, DESC);
    }

    function test_RevertWhen_GoalIsZero() public {
        vm.prank(creator);
        vm.expectRevert(Campaign.InvalidGoal.selector);
        factory.createCampaign(0, block.timestamp + DURATION, DESC);
    }

    function test_RevertWhen_DeadlineIsNow() public {
        vm.prank(creator);
        vm.expectRevert(Campaign.DeadlineInPast.selector);
        factory.createCampaign(GOAL, block.timestamp, DESC);
    }

    function test_RevertWhen_DeadlineIsInThePast() public {
        vm.prank(creator);
        vm.expectRevert(Campaign.DeadlineInPast.selector);
        factory.createCampaign(GOAL, block.timestamp - 1, DESC);
    }

    function test_RevertWhen_DescriptionEmpty() public {
        vm.prank(creator);
        vm.expectRevert(Campaign.DescriptionEmpty.selector);
        factory.createCampaign(GOAL, block.timestamp + DURATION, "");
    }

    function test_RevertWhen_DescriptionTooLong() public {
        string memory tooLong = new string(281);
        vm.prank(creator);
        vm.expectRevert(Campaign.DescriptionTooLong.selector);
        factory.createCampaign(GOAL, block.timestamp + DURATION, tooLong);
    }

    /// The cap is inclusive: exactly MAX_DESCRIPTION_BYTES must still be accepted.
    function test_CreateCampaign_DescriptionAtExactlyMaxBytes() public {
        string memory exact = new string(280);
        vm.prank(creator);
        Campaign c = Campaign(factory.createCampaign(GOAL, block.timestamp + DURATION, exact));
        assertEq(bytes(c.description()).length, c.MAX_DESCRIPTION_BYTES(), "280 bytes accepted");
    }

    /// An unbounded deadline freezes contributions forever: below the goal, `withdraw()`
    /// is blocked by GoalNotMet and `refund()` by DeadlineNotPassed, with no admin escape.
    function test_RevertWhen_DeadlineTooFar() public {
        vm.prank(creator);
        vm.expectRevert(Campaign.DeadlineTooFar.selector);
        factory.createCampaign(GOAL, block.timestamp + 365 days + 1, DESC);

        vm.prank(creator);
        vm.expectRevert(Campaign.DeadlineTooFar.selector);
        factory.createCampaign(GOAL, type(uint256).max, DESC);
    }

    function test_CreateCampaign_DeadlineAtExactlyMaxDuration() public {
        uint256 deadline = block.timestamp + 365 days;
        vm.prank(creator);
        Campaign c = Campaign(factory.createCampaign(GOAL, deadline, DESC));

        assertEq(c.MAX_DURATION(), 365 days, "one year bound");
        assertEq(c.deadline(), deadline, "exactly one year out is accepted");
    }

    /*//////////////////////////////////////////////////////////////
                             CONTRIBUTING
    //////////////////////////////////////////////////////////////*/

    function test_Contribute_AccumulatesPerContributor() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: 1 ether}();
        vm.prank(alice);
        c.contribute{value: 2 ether}();
        vm.prank(bob);
        c.contribute{value: 3 ether}();

        assertEq(c.contributions(alice), 3 ether, "alice total");
        assertEq(c.contributions(bob), 3 ether, "bob total");
        assertEq(c.totalRaised(), 6 ether, "totalRaised");
        assertEq(address(c).balance, 6 ether, "balance");
        assertEq(uint256(c.state()), uint256(Campaign.State.Open), "still open");
    }

    /// REQUIRED CASE: contribution after the deadline must revert onchain.
    function test_RevertWhen_ContributeAfterDeadline() public {
        Campaign c = _newCampaign();
        uint256 deadline = c.deadline();

        // Exactly at the deadline is already too late.
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert(Campaign.DeadlinePassed.selector);
        c.contribute{value: 1 ether}();

        // And any time after.
        vm.warp(deadline + 1 days);
        vm.prank(alice);
        vm.expectRevert(Campaign.DeadlinePassed.selector);
        c.contribute{value: 1 ether}();

        assertEq(c.totalRaised(), 0, "nothing raised");
        assertEq(address(c).balance, 0, "no funds accepted");
    }

    function test_Contribute_OneSecondBeforeDeadlineSucceeds() public {
        Campaign c = _newCampaign();
        vm.warp(c.deadline() - 1);

        vm.prank(alice);
        c.contribute{value: 1 ether}();

        assertEq(c.totalRaised(), 1 ether, "accepted at deadline - 1");
    }

    function test_RevertWhen_ContributeZero() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        vm.expectRevert(Campaign.ZeroContribution.selector);
        c.contribute{value: 0}();
    }

    function test_Contribute_OverfundingAllowedBeforeDeadline() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: GOAL}();
        assertEq(uint256(c.state()), uint256(Campaign.State.GoalMet), "goal met");

        // Goal met does not close the campaign; more can still come in.
        vm.prank(bob);
        c.contribute{value: 5 ether}();

        assertEq(c.totalRaised(), GOAL + 5 ether, "overfunded");
        assertEq(c.progressBps(), 15_000, "150%");
    }

    function test_Contribute_EmitsContributed() public {
        Campaign c = _newCampaign();

        vm.expectEmit(true, true, true, true, address(c));
        emit Campaign.Contributed(alice, 1 ether, 1 ether);
        vm.prank(alice);
        c.contribute{value: 1 ether}();

        // The third field is the running total after this contribution, not the increment.
        vm.expectEmit(true, true, true, true, address(c));
        emit Campaign.Contributed(alice, 2 ether, 3 ether);
        vm.prank(alice);
        c.contribute{value: 2 ether}();
    }

    /// REQUIRED CASE: contributions must stop once the creator has withdrawn.
    /// `withdraw()` has no deadline check, so it can land while the campaign is still
    /// open. MON arriving afterwards could never be recovered — `withdraw()` is one-shot
    /// and `refund()` is permanently closed by `totalRaised >= goal`.
    function test_RevertWhen_ContributeAfterWithdrawal() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: GOAL}();
        vm.prank(creator);
        c.withdraw();

        // Still well before the deadline, so only the `withdrawn` guard can stop this.
        assertGt(c.timeRemaining(), 0, "campaign still open on the clock");
        vm.prank(bob);
        vm.expectRevert(Campaign.AlreadyWithdrawn.selector);
        c.contribute{value: 1 ether}();

        assertEq(c.totalRaised(), GOAL, "nothing added after the withdrawal");
        assertEq(address(c).balance, 0, "no stranded MON");
    }

    function test_RevertWhen_PlainTransferToCampaign() public {
        Campaign c = _newCampaign();
        // No receive()/fallback: funds can only enter through contribute().
        vm.prank(alice);
        (bool ok,) = address(c).call{value: 1 ether}("");
        assertFalse(ok, "bare transfer must fail");
        assertEq(address(c).balance, 0, "balance untouched");
    }

    /*//////////////////////////////////////////////////////////////
                     GOAL MET EXACTLY AT LAST CONTRIBUTION
    //////////////////////////////////////////////////////////////*/

    /// REQUIRED CASE: the final contribution lands the total exactly on the goal.
    function test_GoalMetExactlyAtLastContribution() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: 4 ether}();
        vm.prank(bob);
        c.contribute{value: 5 ether}();

        // One wei short: still Open, refunds still blocked, withdraw still blocked.
        vm.prank(carol);
        c.contribute{value: 1 ether - 1}();
        assertEq(c.totalRaised(), GOAL - 1, "one wei short");
        assertEq(uint256(c.state()), uint256(Campaign.State.Open), "not yet met");
        assertEq(c.progressBps(), 9_999, "99.99%");

        vm.prank(creator);
        vm.expectRevert(Campaign.GoalNotMet.selector);
        c.withdraw();

        // The exact final wei flips it to GoalMet.
        vm.prank(carol);
        c.contribute{value: 1}();

        assertEq(c.totalRaised(), GOAL, "exactly on goal");
        assertEq(uint256(c.state()), uint256(Campaign.State.GoalMet), "goal met exactly");
        assertEq(c.progressBps(), 10_000, "100%");

        // Withdrawal now works, for exactly the raised amount.
        uint256 before = creator.balance;
        vm.prank(creator);
        c.withdraw();
        assertEq(creator.balance - before, GOAL, "creator received the raise");
        assertEq(address(c).balance, 0, "campaign drained");
    }

    /// Goal met exactly at the last contribution AND at the last possible second.
    function test_GoalMetExactlyAtDeadlineMinusOne() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: GOAL - 1}();

        vm.warp(c.deadline() - 1);
        vm.prank(bob);
        c.contribute{value: 1}();

        assertEq(uint256(c.state()), uint256(Campaign.State.GoalMet), "met at the wire");

        // Deadline passes, but the goal was met — no refunds, creator can still withdraw.
        vm.warp(c.deadline() + 1);
        assertEq(uint256(c.state()), uint256(Campaign.State.GoalMet), "still GoalMet past deadline");

        vm.prank(alice);
        vm.expectRevert(Campaign.GoalWasMet.selector);
        c.refund();

        vm.prank(creator);
        c.withdraw();
        assertEq(uint256(c.state()), uint256(Campaign.State.Withdrawn), "withdrawn");
    }

    /*//////////////////////////////////////////////////////////////
                              WITHDRAWING
    //////////////////////////////////////////////////////////////*/

    /// REQUIRED CASE: the creator cannot withdraw twice.
    function test_RevertWhen_WithdrawTwice() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: GOAL}();

        uint256 before = creator.balance;
        vm.prank(creator);
        c.withdraw();
        assertEq(creator.balance - before, GOAL, "first withdrawal paid out");

        vm.prank(creator);
        vm.expectRevert(Campaign.AlreadyWithdrawn.selector);
        c.withdraw();

        // Even if fresh MON is force-fed into the contract afterwards.
        vm.deal(address(c), 5 ether);
        vm.prank(creator);
        vm.expectRevert(Campaign.AlreadyWithdrawn.selector);
        c.withdraw();
    }

    function test_RevertWhen_WithdrawByNonCreator() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: GOAL}();

        vm.prank(alice);
        vm.expectRevert(Campaign.NotCreator.selector);
        c.withdraw();

        vm.prank(bob);
        vm.expectRevert(Campaign.NotCreator.selector);
        c.withdraw();
    }

    function test_RevertWhen_WithdrawGoalNotMet() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: GOAL - 1}();

        vm.prank(creator);
        vm.expectRevert(Campaign.GoalNotMet.selector);
        c.withdraw();

        // Still blocked after the deadline — an underfunded raise never pays the creator.
        vm.warp(c.deadline() + 1);
        vm.prank(creator);
        vm.expectRevert(Campaign.GoalNotMet.selector);
        c.withdraw();
    }

    /// `withdraw()` pays out `address(this).balance`, not `totalRaised`. Force-fed MON
    /// (selfdestruct or a coinbase credit — there is no receive/fallback) leaves the two
    /// apart, and the creator must get all of it rather than stranding the difference.
    function test_Withdraw_SweepsForceFedBalance() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: GOAL}();
        vm.deal(address(c), GOAL + 3 ether);

        uint256 before = creator.balance;
        vm.prank(creator);
        c.withdraw();

        assertEq(creator.balance - before, GOAL + 3 ether, "creator received the whole balance");
        assertEq(c.totalRaised(), GOAL, "totalRaised unchanged by the force-feed");
        assertEq(address(c).balance, 0, "campaign drained");
    }

    function test_Withdraw_SurfacesFailedTransfer() public {
        RejectingReceiver rc = new RejectingReceiver();
        vm.deal(address(rc), 20 ether);

        vm.prank(address(rc));
        Campaign c = Campaign(factory.createCampaign(GOAL, block.timestamp + DURATION, DESC));
        rc.setCampaign(c);

        vm.prank(alice);
        c.contribute{value: GOAL}();

        vm.expectRevert(Campaign.TransferFailed.selector);
        rc.doWithdraw();

        // The reverted withdrawal left no state behind.
        assertFalse(c.withdrawn(), "withdrawn flag rolled back");
        assertEq(address(c).balance, GOAL, "funds still in campaign");
    }

    /*//////////////////////////////////////////////////////////////
                              WITHDRAW TO
    //////////////////////////////////////////////////////////////*/

    function test_WithdrawTo_PaysNamedRecipient() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: GOAL}();

        uint256 carolBefore = carol.balance;
        uint256 creatorBefore = creator.balance;

        vm.expectEmit(true, true, true, true, address(c));
        emit Campaign.Withdrawn(creator, GOAL, carol);
        vm.prank(creator);
        c.withdrawTo(payable(carol));

        assertEq(carol.balance - carolBefore, GOAL, "recipient received the raise");
        assertEq(creator.balance, creatorBefore, "creator received nothing");
        assertEq(address(c).balance, 0, "campaign drained");
        assertEq(uint256(c.state()), uint256(Campaign.State.Withdrawn), "terminal");
    }

    function test_RevertWhen_WithdrawToByNonCreator() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: GOAL}();

        // Not even to the creator's own address — only the creator may release funds.
        vm.prank(alice);
        vm.expectRevert(Campaign.NotCreator.selector);
        c.withdrawTo(payable(creator));

        assertEq(address(c).balance, GOAL, "funds untouched");
    }

    function test_RevertWhen_WithdrawToZeroAddress() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: GOAL}();

        // address(0).call{value:} succeeds, so without the guard the raise would burn.
        vm.prank(creator);
        vm.expectRevert(Campaign.InvalidRecipient.selector);
        c.withdrawTo(payable(address(0)));

        assertEq(address(c).balance, GOAL, "funds untouched");
    }

    function test_RevertWhen_WithdrawToGoalNotMet() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: GOAL - 1}();

        vm.prank(creator);
        vm.expectRevert(Campaign.GoalNotMet.selector);
        c.withdrawTo(payable(carol));
    }

    /// The one-shot guard is on shared state, so it does not matter which entry point
    /// spent it — neither can run again afterwards.
    function test_RevertWhen_SecondWithdrawalThroughEitherEntryPoint() public {
        Campaign a = _newCampaign();
        vm.prank(alice);
        a.contribute{value: GOAL}();
        vm.prank(creator);
        a.withdraw();

        vm.prank(creator);
        vm.expectRevert(Campaign.AlreadyWithdrawn.selector);
        a.withdrawTo(payable(carol));

        // And the other way round.
        Campaign b = _newCampaign();
        vm.prank(alice);
        b.contribute{value: GOAL}();
        vm.prank(creator);
        b.withdrawTo(payable(carol));

        vm.prank(creator);
        vm.expectRevert(Campaign.AlreadyWithdrawn.selector);
        b.withdraw();

        assertEq(address(a).balance, 0, "a paid out exactly once");
        assertEq(address(b).balance, 0, "b paid out exactly once");
    }

    /// The reason `withdrawTo` exists: `creator` is immutable, so a contract creator that
    /// cannot receive MON would otherwise lock every contributor's funds forever.
    function test_WithdrawTo_EscapesCreatorThatCannotReceive() public {
        RejectingReceiver rc = new RejectingReceiver();

        vm.prank(address(rc));
        Campaign c = Campaign(factory.createCampaign(GOAL, block.timestamp + DURATION, DESC));
        rc.setCampaign(c);

        vm.prank(alice);
        c.contribute{value: GOAL}();

        // Plain withdraw() is permanently impossible for this creator.
        vm.expectRevert(Campaign.TransferFailed.selector);
        rc.doWithdraw();

        // Naming a payable recipient is the only way out, and it works.
        uint256 before = carol.balance;
        rc.doWithdrawTo(payable(carol));

        assertEq(carol.balance - before, GOAL, "funds escaped to a payable address");
        assertEq(address(c).balance, 0, "campaign drained");
        assertTrue(c.withdrawn(), "withdrawn flag set");
    }

    /// A reverting recipient must roll the whole thing back, not consume the one shot.
    function test_WithdrawTo_SurfacesFailedTransferAndKeepsTheShot() public {
        Campaign c = _newCampaign();
        RejectingReceiver rc = new RejectingReceiver();

        vm.prank(alice);
        c.contribute{value: GOAL}();

        vm.prank(creator);
        vm.expectRevert(Campaign.TransferFailed.selector);
        c.withdrawTo(payable(address(rc)));

        // Still one shot left — pointing it somewhere payable still pays out.
        uint256 before = carol.balance;
        vm.prank(creator);
        c.withdrawTo(payable(carol));
        assertEq(carol.balance - before, GOAL, "retry to a good address succeeds");
    }

    /*//////////////////////////////////////////////////////////////
                               REFUNDING
    //////////////////////////////////////////////////////////////*/

    function test_Refund_ReturnsExactContribution() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: 2 ether}();
        vm.prank(bob);
        c.contribute{value: 3 ether}();

        vm.warp(c.deadline());
        assertEq(uint256(c.state()), uint256(Campaign.State.Expired), "expired");

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        c.refund();
        assertEq(alice.balance - aliceBefore, 2 ether, "alice got exactly hers");
        assertEq(c.contributions(alice), 0, "alice zeroed");
        assertTrue(c.refunded(alice), "alice flagged");

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        c.refund();
        assertEq(bob.balance - bobBefore, 3 ether, "bob got exactly his");
        assertEq(address(c).balance, 0, "campaign fully drained");
    }

    /// REQUIRED CASE: a contributor cannot refund twice.
    function test_RevertWhen_RefundTwice() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: 2 ether}();
        vm.prank(bob);
        c.contribute{value: 3 ether}();

        vm.warp(c.deadline());

        uint256 before = alice.balance;
        vm.prank(alice);
        c.refund();
        assertEq(alice.balance - before, 2 ether, "first refund paid");

        vm.prank(alice);
        vm.expectRevert(Campaign.AlreadyRefunded.selector);
        c.refund();

        // Alice's successful first refund took hers and only hers — bob is still owed
        // his 3 ether and can still collect it.
        assertEq(address(c).balance, 3 ether, "bob's funds intact");
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        c.refund();
        assertEq(bob.balance - bobBefore, 3 ether, "bob still made whole");
    }

    /// REQUIRED CASE: refund attempted before the deadline must revert.
    function test_RevertWhen_RefundBeforeDeadline() public {
        Campaign c = _newCampaign();

        vm.prank(alice);
        c.contribute{value: 2 ether}();

        vm.prank(alice);
        vm.expectRevert(Campaign.DeadlineNotPassed.selector);
        c.refund();

        // One second before the deadline is still too early.
        vm.warp(c.deadline() - 1);
        vm.prank(alice);
        vm.expectRevert(Campaign.DeadlineNotPassed.selector);
        c.refund();

        assertEq(c.contributions(alice), 2 ether, "contribution untouched");
        assertEq(address(c).balance, 2 ether, "balance untouched");

        // Exactly at the deadline it opens up.
        vm.warp(c.deadline());
        vm.prank(alice);
        c.refund();
        assertEq(c.contributions(alice), 0, "refunded at deadline");
    }

    function test_RevertWhen_RefundWithNoContribution() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: 1 ether}();

        vm.warp(c.deadline());
        vm.prank(carol);
        vm.expectRevert(Campaign.NothingToRefund.selector);
        c.refund();
    }

    function test_Refund_ReturnsAccumulatedContributions() public {
        Campaign c = _newCampaign();

        vm.startPrank(alice);
        c.contribute{value: 1 ether}();
        c.contribute{value: 2 ether}();
        c.contribute{value: 0.5 ether}();
        vm.stopPrank();

        vm.warp(c.deadline());

        uint256 before = alice.balance;
        vm.prank(alice);
        c.refund();

        // One call returns the accumulated balance, not just the last contribution.
        assertEq(alice.balance - before, 3.5 ether, "whole accumulated balance returned");
        assertEq(c.contributions(alice), 0, "alice zeroed");
        assertEq(address(c).balance, 0, "campaign drained");
    }

    function test_RevertWhen_RefundAfterGoalMet() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: GOAL}();

        vm.warp(c.deadline() + 30 days);
        vm.prank(alice);
        vm.expectRevert(Campaign.GoalWasMet.selector);
        c.refund();
    }

    /// The money is already gone: a refund after the creator withdrew must not find
    /// anything to pay out, and must say why.
    function test_RevertWhen_RefundAfterWithdrawal() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: GOAL}();

        vm.prank(creator);
        c.withdraw();

        vm.warp(c.deadline() + 1);
        assertTrue(c.withdrawn(), "withdrawn");
        vm.prank(alice);
        vm.expectRevert(Campaign.GoalWasMet.selector);
        c.refund();

        assertEq(c.contributions(alice), GOAL, "contribution row untouched");
    }

    function test_Refund_SurfacesFailedTransfer() public {
        Campaign c = _newCampaign();
        RejectingReceiver rc = new RejectingReceiver();
        rc.setCampaign(c);
        vm.deal(address(rc), 5 ether);

        rc.contribute{value: 1 ether}(1 ether);
        vm.warp(c.deadline());

        vm.expectRevert(Campaign.TransferFailed.selector);
        rc.doRefund();

        assertEq(c.contributions(address(rc)), 1 ether, "state rolled back");
        assertFalse(c.refunded(address(rc)), "refund flag rolled back");
    }

    /*//////////////////////////////////////////////////////////////
                              REENTRANCY
    //////////////////////////////////////////////////////////////*/

    /// REQUIRED CASE: reentrancy into withdraw() from the creator's receive().
    function test_Reentrancy_WithdrawIsBlocked() public {
        ReentrantCreator attacker = new ReentrantCreator();
        address c = attacker.createVia(address(factory), GOAL, block.timestamp + DURATION, DESC);
        Campaign campaign = Campaign(c);

        vm.prank(alice);
        campaign.contribute{value: GOAL}();

        attacker.attackWithdraw();

        assertGt(attacker.reentryAttempts(), 0, "attacker did try to re-enter");
        assertFalse(attacker.reentrySucceeded(), "reentrant withdraw must fail");
        // It must be the guard that stopped it, not CEI: `withdrawn` is already true by
        // this point, so a missing `nonReentrant` would still revert — with AlreadyWithdrawn.
        assertEq(attacker.lastError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "guard fired");
        assertEq(address(attacker).balance, GOAL, "attacker got the raise exactly once");
        assertEq(address(campaign).balance, 0, "campaign drained exactly once");
        assertTrue(campaign.withdrawn(), "withdrawn flag set");
    }

    /// REQUIRED CASE: reentrancy into refund() from a contributor's receive().
    function test_Reentrancy_RefundIsBlocked() public {
        Campaign c = _newCampaign();

        ReentrantContributor attacker = new ReentrantContributor();
        attacker.setCampaign(c);
        vm.deal(address(attacker), 5 ether);

        attacker.contribute{value: 1 ether}(1 ether);
        // Honest money the attacker would love to steal.
        vm.prank(alice);
        c.contribute{value: 4 ether}();

        vm.warp(c.deadline());

        uint256 attackerBefore = address(attacker).balance;
        attacker.attackRefund();

        assertGt(attacker.reentryAttempts(), 0, "attacker did try to re-enter");
        assertFalse(attacker.reentrySucceeded(), "reentrant refund must fail");
        // Same as above: `refunded[]` is already set, so only the selector distinguishes
        // the guard from CEI.
        assertEq(attacker.lastError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "guard fired");
        assertEq(address(attacker).balance - attackerBefore, 1 ether, "got back exactly its own");
        assertEq(address(c).balance, 4 ether, "alice's money untouched");

        // Alice can still take hers afterwards.
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        c.refund();
        assertEq(alice.balance - aliceBefore, 4 ether, "alice made whole");
    }

    /// Cross-function reentrancy: withdraw() -> contribute(). The only such path that is
    /// reachable in time — `withdraw()` has no deadline check, so it runs while the
    /// campaign is still open. (refund() -> contribute() is not: the two are mutually
    /// exclusive in time, so the re-entrant call can only ever hit DeadlinePassed.)
    function test_Reentrancy_WithdrawIntoContributeIsBlocked() public {
        WithdrawToContributeReentrant attacker = new WithdrawToContributeReentrant();
        address c = attacker.createVia(address(factory), GOAL, block.timestamp + DURATION, DESC);
        Campaign campaign = Campaign(c);

        vm.prank(alice);
        campaign.contribute{value: GOAL}();

        // Deliberately still before the deadline: DeadlinePassed cannot be what stops this.
        assertGt(campaign.timeRemaining(), 0, "campaign still open on the clock");
        attacker.attackWithdraw();

        assertGt(attacker.reentryAttempts(), 0, "attacker did try to re-enter");
        assertFalse(attacker.reentrySucceeded(), "reentrant contribute must fail");
        // The guard is a modifier, so it runs before the `withdrawn` check in the body —
        // this selector is what proves `nonReentrant` on contribute() is load-bearing.
        assertEq(attacker.lastError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "guard fired");
        assertEq(campaign.totalRaised(), GOAL, "totalRaised not inflated");
        assertEq(address(campaign).balance, 0, "no wei stranded in the campaign");
        assertEq(address(attacker).balance, GOAL, "attacker got the raise exactly once");
    }

    /*//////////////////////////////////////////////////////////////
                          STATE / VIEW HELPERS
    //////////////////////////////////////////////////////////////*/

    function test_State_TransitionsAcrossLifecycle() public {
        Campaign c = _newCampaign();
        assertEq(uint256(c.state()), uint256(Campaign.State.Open), "open");

        vm.prank(alice);
        c.contribute{value: 1 ether}();
        assertEq(uint256(c.state()), uint256(Campaign.State.Open), "still open");

        vm.warp(c.deadline());
        assertEq(uint256(c.state()), uint256(Campaign.State.Expired), "expired");
    }

    function test_TimeRemaining_CountsDownAndFloorsAtZero() public {
        Campaign c = _newCampaign();
        assertEq(c.timeRemaining(), DURATION, "full duration");

        vm.warp(block.timestamp + 1 days);
        assertEq(c.timeRemaining(), DURATION - 1 days, "one day gone");

        vm.warp(c.deadline());
        assertEq(c.timeRemaining(), 0, "floors at zero");

        vm.warp(c.deadline() + 365 days);
        assertEq(c.timeRemaining(), 0, "stays at zero");
    }

    function test_Summary_MatchesIndividualGetters() public {
        Campaign c = _newCampaign();
        vm.prank(alice);
        c.contribute{value: 2.5 ether}();

        Campaign.Summary memory s = c.summary(alice);

        assertEq(s.campaign, address(c), "address");
        assertEq(s.creator, creator, "creator");
        assertEq(s.goal, GOAL, "goal");
        assertEq(s.deadline, c.deadline(), "deadline");
        assertEq(s.totalRaised, 2.5 ether, "raised");
        assertFalse(s.withdrawn, "withdrawn");
        assertEq(uint256(s.state), uint256(Campaign.State.Open), "state");
        assertEq(s.timeRemaining, c.timeRemaining(), "time remaining");
        assertEq(s.progressBps, 2_500, "25%");
        assertEq(s.description, DESC, "description");
        assertEq(s.accountContribution, 2.5 ether, "account contribution");
        assertFalse(s.accountRefunded, "account refunded");
    }

    /// `summary()` is the frontend's only state read, so every field has to be right in
    /// every state — not just in a fresh Open campaign.
    function test_Summary_AcrossLifecycleStates() public {
        Campaign c = _newCampaign();
        // A second campaign, created now so it shares a deadline, left underfunded.
        Campaign e = _newCampaign();
        vm.prank(bob);
        e.contribute{value: 1 ether}();

        vm.prank(alice);
        c.contribute{value: GOAL}();

        // GoalMet: funded, not yet withdrawn, still before the deadline.
        Campaign.Summary memory s = c.summary(alice);
        assertEq(uint256(s.state), uint256(Campaign.State.GoalMet), "GoalMet state");
        assertFalse(s.withdrawn, "not withdrawn yet");
        assertEq(s.totalRaised, GOAL, "raised");
        assertEq(s.progressBps, 10_000, "100%");
        assertEq(s.timeRemaining, DURATION, "full duration left");
        assertEq(s.accountContribution, GOAL, "alice contribution");
        assertFalse(s.accountRefunded, "alice not refunded");

        // The path every disconnected page load takes: account == address(0) zeroes the
        // two per-user rows and nothing else.
        Campaign.Summary memory anon = c.summary(address(0));
        assertEq(uint256(anon.state), uint256(Campaign.State.GoalMet), "same state for address(0)");
        assertEq(anon.totalRaised, GOAL, "same raised for address(0)");
        assertEq(anon.description, DESC, "same description for address(0)");
        assertEq(anon.accountContribution, 0, "no account contribution");
        assertFalse(anon.accountRefunded, "no account refund");

        // Withdrawn: terminal, and it outranks the deadline having passed.
        vm.prank(creator);
        c.withdraw();
        vm.warp(c.deadline() + 1);
        s = c.summary(alice);
        assertEq(uint256(s.state), uint256(Campaign.State.Withdrawn), "Withdrawn state");
        assertTrue(s.withdrawn, "withdrawn flag");
        assertEq(s.totalRaised, GOAL, "raised unchanged by the payout");
        assertEq(s.timeRemaining, 0, "no time left");

        // Expired: the underfunded campaign, before and after its refund.
        s = e.summary(bob);
        assertEq(uint256(s.state), uint256(Campaign.State.Expired), "Expired state");
        assertFalse(s.withdrawn, "never withdrawn");
        assertEq(s.progressBps, 1_000, "10%");
        assertEq(s.timeRemaining, 0, "no time left");
        assertEq(s.accountContribution, 1 ether, "bob still owed");
        assertFalse(s.accountRefunded, "bob not refunded yet");

        vm.prank(bob);
        e.refund();
        s = e.summary(bob);
        assertEq(uint256(s.state), uint256(Campaign.State.Expired), "still Expired after the refund");
        assertEq(s.accountContribution, 0, "bob zeroed");
        assertTrue(s.accountRefunded, "bob flagged as refunded");
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    function testFuzz_RefundReturnsExactlyWhatWasContributed(uint96 a, uint96 b) public {
        a = uint96(bound(a, 1, 1 ether));
        b = uint96(bound(b, 1, 1 ether));

        Campaign c = _newCampaign(); // goal is 10 ether, so a + b can never reach it
        vm.deal(alice, uint256(a));
        vm.deal(bob, uint256(b));

        vm.prank(alice);
        c.contribute{value: a}();
        vm.prank(bob);
        c.contribute{value: b}();

        vm.warp(c.deadline());

        vm.prank(alice);
        c.refund();
        vm.prank(bob);
        c.refund();

        assertEq(alice.balance, a, "alice whole");
        assertEq(bob.balance, b, "bob whole");
        assertEq(address(c).balance, 0, "campaign empty");
    }

    function testFuzz_NoWithdrawBelowGoal(uint256 amount) public {
        amount = bound(amount, 1, GOAL - 1);
        Campaign c = _newCampaign();

        vm.deal(alice, amount);
        vm.prank(alice);
        c.contribute{value: amount}();

        vm.prank(creator);
        vm.expectRevert(Campaign.GoalNotMet.selector);
        c.withdraw();
    }

    /// The two fuzz tests above are bounded below the goal and reuse the fixed GOAL /
    /// DURATION, so the fuzzer never reaches `withdraw()` and never varies the two
    /// constructor numbers. This one fuzzes both over their whole valid range and drives
    /// the campaign all the way to a completed withdrawal.
    function testFuzz_GoalMetThenWithdraw(uint256 fuzzGoal, uint256 fuzzDeadline, uint256 overshoot) public {
        fuzzGoal = bound(fuzzGoal, 1, 1_000_000 ether);
        fuzzDeadline = bound(fuzzDeadline, block.timestamp + 1, block.timestamp + 365 days);
        // Over-funding is allowed, so the success condition is `>= goal`, not `== goal`.
        overshoot = bound(overshoot, 0, 1_000 ether);
        uint256 amount = fuzzGoal + overshoot;

        vm.prank(creator);
        Campaign c = Campaign(factory.createCampaign(fuzzGoal, fuzzDeadline, DESC));
        assertEq(c.deadline(), fuzzDeadline, "deadline accepted anywhere in range");

        vm.deal(alice, amount);
        vm.prank(alice);
        c.contribute{value: amount}();
        assertEq(uint256(c.state()), uint256(Campaign.State.GoalMet), "goal met");

        uint256 before = creator.balance;
        vm.prank(creator);
        c.withdraw();

        assertEq(creator.balance - before, amount, "creator got the whole raise");
        assertEq(address(c).balance, 0, "campaign drained");
        assertEq(uint256(c.state()), uint256(Campaign.State.Withdrawn), "terminal");

        // One-shot no matter how much of the funding window is left.
        vm.prank(creator);
        vm.expectRevert(Campaign.AlreadyWithdrawn.selector);
        c.withdraw();
    }
}

/*//////////////////////////////////////////////////////////////
                             INVARIANTS
//////////////////////////////////////////////////////////////*/

/// @notice Drives one campaign with randomly ordered contributions, refunds, withdrawals
///         and time jumps, double-entry booking every wei that actually moved so the
///         invariants can compare the campaign's balance against its own history.
/// @dev    Calls are wrapped in try/catch because most orderings are legitimately
///         rejected (wrong state, wrong caller); only the ones that land are booked.
contract CampaignHandler is Test {
    Campaign public campaign;
    uint256 public totalContributed;
    uint256 public totalPaidOut;

    address[] internal actors;

    constructor(Campaign c, address[] memory _actors) {
        campaign = c;
        actors = _actors;
    }

    function contribute(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 5 ether);

        vm.deal(actor, amount);
        vm.prank(actor);
        try campaign.contribute{value: amount}() {
            totalContributed += amount;
        } catch {}
    }

    function refund(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        // Read before the call: refund() zeroes the row it pays out.
        uint256 owed = campaign.contributions(actor);

        vm.prank(actor);
        try campaign.refund() {
            totalPaidOut += owed;
        } catch {}
    }

    function withdraw() external {
        // withdraw() sweeps the whole balance, not just totalRaised.
        uint256 sweep = address(campaign).balance;

        vm.prank(campaign.creator());
        try campaign.withdraw() {
            totalPaidOut += sweep;
        } catch {}
    }

    function warp(uint256 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 3 days));
    }
}

/// @notice The core money invariants, over every reachable interleaving of the three
///         value-moving functions.
contract CampaignInvariantTest is Test {
    uint256 internal constant GOAL = 10 ether;
    uint256 internal constant DURATION = 7 days;

    Campaign internal campaign;
    CampaignHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        CampaignFactory factory = new CampaignFactory();

        vm.prank(makeAddr("creator"));
        campaign = Campaign(factory.createCampaign(GOAL, block.timestamp + DURATION, "Fund the community garden"));

        address[] memory actors = new address[](3);
        actors[0] = makeAddr("alice");
        actors[1] = makeAddr("bob");
        actors[2] = makeAddr("carol");

        handler = new CampaignHandler(campaign, actors);
        targetContract(address(handler));
    }

    /// All-or-nothing means the campaign is a pass-through: it can never pay out more
    /// than it took in, no matter how refunds and the withdrawal interleave.
    function invariant_PayoutsNeverExceedContributions() public view {
        assertLe(handler.totalPaidOut(), handler.totalContributed(), "paid out more than came in");
    }

    /// And it holds exactly the difference — no wei stranded, no wei conjured.
    function invariant_BalanceEqualsContributedMinusPaidOut() public view {
        assertEq(
            address(campaign).balance,
            handler.totalContributed() - handler.totalPaidOut(),
            "balance drifted from the books"
        );
    }
}
