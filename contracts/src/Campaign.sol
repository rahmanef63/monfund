// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Campaign
/// @notice A single all-or-nothing fundraising campaign denominated in native MON.
///         Anyone may contribute before the deadline. If the goal is reached the
///         creator may withdraw once. If the deadline passes without the goal being
///         reached, each contributor may pull back exactly what they put in, once.
/// @dev    Testnet demo contract. NOT AUDITED. Do not use with real funds.
///         Every state-changing function that moves value is `nonReentrant` and
///         follows checks-effects-interactions.
contract Campaign is ReentrancyGuard {
    /// @notice Lifecycle state of the campaign, derived from storage — never stored.
    /// Open      : before the deadline, goal not yet reached — contributions accepted
    /// GoalMet   : goal reached, funds not yet withdrawn — creator may withdraw
    /// Withdrawn : creator has withdrawn the raised funds — terminal
    /// Expired   : deadline passed with the goal unmet — contributors may refund
    enum State {
        Open,
        GoalMet,
        Withdrawn,
        Expired
    }

    /// @notice Everything the UI needs about one campaign, in a single call.
    struct Summary {
        address campaign;
        address creator;
        uint256 goal;
        uint256 deadline;
        uint256 totalRaised;
        bool withdrawn;
        State state;
        uint256 timeRemaining;
        uint256 progressBps;
        string description;
        uint256 accountContribution;
        bool accountRefunded;
    }

    /// @notice Maximum length of the campaign description, in bytes.
    uint256 public constant MAX_DESCRIPTION_BYTES = 280;

    /// @notice Maximum distance between deployment and the deadline, in seconds.
    /// @dev Bounds the window in which an unmet goal keeps contributions locked:
    ///      `withdraw()` is blocked by `GoalNotMet` and `refund()` by
    ///      `DeadlineNotPassed` until the deadline arrives, and there is no admin escape.
    uint256 public constant MAX_DURATION = 365 days;

    /// @notice Address allowed to withdraw once the goal is met.
    address public immutable creator;

    /// @notice Funding goal in wei of native MON.
    uint256 public immutable goal;

    /// @notice Unix timestamp after which contributions are rejected.
    uint256 public immutable deadline;

    /// @notice Short human-readable description of the campaign.
    string public description;

    /// @notice Total MON contributed so far, in wei.
    uint256 public totalRaised;

    /// @notice True once the creator has withdrawn. Blocks any second withdrawal.
    bool public withdrawn;

    /// @notice Amount each address has contributed and not yet refunded, in wei.
    mapping(address contributor => uint256 amount) public contributions;

    /// @notice True once an address has taken its refund. Blocks any second refund.
    mapping(address contributor => bool didRefund) public refunded;

    event Contributed(address indexed contributor, uint256 amount, uint256 totalRaised);
    /// @dev `recipient` is the address the MON actually landed on: `creator` for
    ///      `withdraw()`, the caller-chosen address for `withdrawTo()`. Without it the
    ///      log would name `creator` for a payout `creator` never received.
    event Withdrawn(address indexed creator, uint256 amount, address indexed recipient);
    event Refunded(address indexed contributor, uint256 amount);

    error InvalidCreator();
    error InvalidRecipient();
    error InvalidGoal();
    error DeadlineInPast();
    error DeadlineTooFar();
    error DescriptionEmpty();
    error DescriptionTooLong();
    error DeadlinePassed();
    error ZeroContribution();
    error NotCreator();
    error GoalNotMet();
    error AlreadyWithdrawn();
    error DeadlineNotPassed();
    error GoalWasMet();
    error NothingToRefund();
    error AlreadyRefunded();
    error TransferFailed();

    /// @param _creator     Address that will be allowed to withdraw on success.
    /// @param _goal        Funding goal in wei. Must be greater than zero.
    /// @param _deadline    Unix timestamp, strictly in the future and at most
    ///                     `MAX_DURATION` seconds away.
    /// @param _description Short description, 1..280 bytes.
    constructor(address _creator, uint256 _goal, uint256 _deadline, string memory _description) {
        if (_creator == address(0)) revert InvalidCreator();
        if (_goal == 0) revert InvalidGoal();
        if (_deadline <= block.timestamp) revert DeadlineInPast();
        if (_deadline > block.timestamp + MAX_DURATION) revert DeadlineTooFar();

        uint256 len = bytes(_description).length;
        if (len == 0) revert DescriptionEmpty();
        if (len > MAX_DESCRIPTION_BYTES) revert DescriptionTooLong();

        creator = _creator;
        goal = _goal;
        deadline = _deadline;
        description = _description;
    }

    /// @notice Contribute native MON to this campaign.
    /// @dev Rejected once the creator has withdrawn, and at or after the deadline —
    ///      both enforced onchain, not just in the UI. The goal being reached does NOT
    ///      close the campaign; over-funding is allowed until the creator withdraws or
    ///      the deadline passes, whichever comes first. The `withdrawn` check must stay
    ///      first: `withdraw()` has no deadline check, so it can land while the campaign
    ///      is still open, and MON arriving after it could never be withdrawn (one-shot)
    ///      nor refunded (`totalRaised` is monotonic and already at or above the goal).
    function contribute() external payable nonReentrant {
        if (withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp >= deadline) revert DeadlinePassed();
        if (msg.value == 0) revert ZeroContribution();

        contributions[msg.sender] += msg.value;
        uint256 raised = totalRaised + msg.value;
        totalRaised = raised;

        emit Contributed(msg.sender, msg.value, raised);
    }

    /// @notice Creator pulls the full contract balance to the creator address itself,
    ///         only once, only if the goal was met.
    /// @dev Thin wrapper over `withdrawTo` so there is exactly one implementation of the
    ///      checks and the payout. Not `nonReentrant` itself — the guard is non-reentrant,
    ///      so taking it twice in one call would revert.
    function withdraw() external {
        withdrawTo(payable(creator));
    }

    /// @notice Creator pulls the full contract balance to an address of their choosing,
    ///         only once, only if the goal was met.
    /// @dev The deadline is irrelevant here: once the goal is met the raise has succeeded.
    ///      `creator` is immutable, so without this escape hatch a contract creator with
    ///      no payable `receive` would fail `withdraw()` with `TransferFailed` forever and
    ///      every contributor's MON would be locked in here permanently (refunds are
    ///      closed by `totalRaised >= goal`). It grants an EOA creator nothing new:
    ///      whoever holds the key can already move the funds anywhere after `withdraw()`.
    /// @param to Recipient of the raise. Must not be the zero address.
    function withdrawTo(address payable to) public nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (to == address(0)) revert InvalidRecipient();
        if (totalRaised < goal) revert GoalNotMet();
        if (withdrawn) revert AlreadyWithdrawn();

        // Effects before interaction — a second withdraw can never pass the check above,
        // through either entry point.
        withdrawn = true;

        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(creator, amount, to);
    }

    /// @notice Contributor pulls back exactly their own contribution, only once,
    ///         and only if the deadline passed with the goal unmet.
    /// @dev Pull-based: funds are never pushed to contributors automatically.
    function refund() external nonReentrant {
        if (block.timestamp < deadline) revert DeadlineNotPassed();
        if (totalRaised >= goal) revert GoalWasMet();
        if (refunded[msg.sender]) revert AlreadyRefunded();

        uint256 amount = contributions[msg.sender];
        if (amount == 0) revert NothingToRefund();

        // Effects before interaction — both guards below are set before any call out.
        refunded[msg.sender] = true;
        contributions[msg.sender] = 0;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Refunded(msg.sender, amount);
    }

    /// @notice Current lifecycle state, derived from storage and block time.
    function state() public view returns (State) {
        if (withdrawn) return State.Withdrawn;
        if (totalRaised >= goal) return State.GoalMet;
        if (block.timestamp >= deadline) return State.Expired;
        return State.Open;
    }

    /// @notice Seconds remaining until the deadline, or 0 once it has passed.
    function timeRemaining() public view returns (uint256) {
        if (block.timestamp >= deadline) return 0;
        return deadline - block.timestamp;
    }

    /// @notice Progress toward the goal in basis points (10000 = 100%). Uncapped.
    function progressBps() public view returns (uint256) {
        return (totalRaised * 10_000) / goal;
    }

    /// @notice Everything the UI needs for one campaign in a single call.
    /// @param account Address to report per-user figures for; pass address(0) to skip.
    function summary(address account) external view returns (Summary memory s) {
        s.campaign = address(this);
        s.creator = creator;
        s.goal = goal;
        s.deadline = deadline;
        s.totalRaised = totalRaised;
        s.withdrawn = withdrawn;
        s.state = state();
        s.timeRemaining = timeRemaining();
        s.progressBps = progressBps();
        s.description = description;
        s.accountContribution = contributions[account];
        s.accountRefunded = refunded[account];
    }
}
