// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * MapSocial LicenseStake
 * ----------------------
 * Stake the platform meme token to self-activate a permission "license":
 *   tier 1 = event organizer (one active position = one concurrent event slot)
 *   tier 2 = bot operator   (one active position = one bot API key)
 *
 * Economics (decided in product design):
 *   - Entry fee is charged once at stake time. Default 5% of the staked
 *     amount, split 3% treasury / 1% referrer / 1% rebate back to the staker.
 *     Without a referrer the whole fee goes to the treasury (95/5).
 *   - The remaining 95% is recorded as the position principal and is
 *     refunded in full on unstake. No exit fee, no double charging.
 *   - Referral is single-level only; kickback (2%) < fee (5%), so
 *     stake/unstake cycling is always net-negative and cannot be farmed.
 *   - Tier prices are owner-adjustable ("generations"): changing a price
 *     bumps the generation counter; existing positions are untouched because
 *     every position remembers its own principal.
 *   - stakeFor(): promo positions funded by the platform for partner
 *     organizers. The beneficiary gets the permission, never the tokens;
 *     refunds always return to the funder. No fee (it would be a self-payment).
 *
 * Trust-score floors, per-license quotas and bot rate limits are enforced
 * off-chain by the platform, which reads hasActiveposition()/positionsOf().
 *
 * NOTE: self-contained by design (no external imports) so it can be compiled
 * and reviewed as a single file. Before mainnet deployment with real funds:
 *   - swap inline guards for OpenZeppelin equivalents if preferred,
 *   - get an independent security review,
 *   - deploy behind a small cap and test on a testnet first.
 * The staking token MUST be a standard ERC-20 (no fee-on-transfer, no rebase).
 */

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract LicenseStake {
    // ---------------------------------------------------------------- types

    struct Position {
        uint8 tier;
        bool active;
        uint16 generation; // price generation at stake time (informational)
        uint40 createdAt;
        address funder;    // who paid and who gets the refund
        uint128 principal; // exact amount refunded on unstake
    }

    // ---------------------------------------------------------------- state

    IERC20 public immutable token;
    address public owner;
    address public pendingOwner;
    address public treasury;
    bool public paused; // pauses new stakes only; unstake always works

    uint8 public constant TIER_ORGANIZER = 1;
    uint8 public constant TIER_BOT = 2;

    /// Hard cap on the total entry fee: 5% (immutable promise to users).
    uint16 public constant MAX_TOTAL_FEE_BPS = 500;

    uint16 public treasuryFeeBps = 300; // 3%
    uint16 public referrerFeeBps = 100; // 1%
    uint16 public rebateFeeBps = 100;   // 1%

    /// tier => tokens required for a new position (generation pricing).
    mapping(uint8 => uint256) public stakePrice;
    uint16 public generation = 1;

    /// beneficiary => positions (permission holder; funder may differ).
    mapping(address => Position[]) private _positions;
    /// beneficiary => tier => number of active positions.
    mapping(address => mapping(uint8 => uint256)) public activeCount;

    uint256 private _entered = 1; // reentrancy guard

    // --------------------------------------------------------------- events

    event Staked(
        address indexed beneficiary,
        address indexed funder,
        uint8 indexed tier,
        uint256 index,
        uint256 principal,
        address referrer,
        uint16 generation
    );
    event Unstaked(address indexed beneficiary, uint256 index, uint256 refund, address funder);
    event PriceSet(uint8 indexed tier, uint256 price, uint16 generation);
    event FeesSet(uint16 treasuryBps, uint16 referrerBps, uint16 rebateBps);
    event TreasurySet(address treasury);
    event PausedSet(bool paused);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ------------------------------------------------------------ modifiers

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(_entered == 1, "reentrant");
        _entered = 2;
        _;
        _entered = 1;
    }

    // ----------------------------------------------------------- construction

    constructor(
        address token_,
        address treasury_,
        uint256 organizerPrice,
        uint256 botPrice
    ) {
        require(token_ != address(0) && treasury_ != address(0), "zero addr");
        require(organizerPrice > 0 && botPrice > 0, "zero price");
        token = IERC20(token_);
        owner = msg.sender;
        treasury = treasury_;
        stakePrice[TIER_ORGANIZER] = organizerPrice;
        stakePrice[TIER_BOT] = botPrice;
        emit PriceSet(TIER_ORGANIZER, organizerPrice, 1);
        emit PriceSet(TIER_BOT, botPrice, 1);
    }

    // ---------------------------------------------------------------- stake

    /**
     * Self-service stake. Pass referrer = address(0) for no referral.
     * Fee split: treasury + referrer share + rebate back to msg.sender.
     * Self-referral is neutralized (treated as no referrer).
     */
    function stake(uint8 tier, address referrer) external nonReentrant returns (uint256 index) {
        require(!paused, "paused");
        uint256 price = stakePrice[tier];
        require(price > 0, "bad tier");

        if (referrer == msg.sender) referrer = address(0);

        uint256 treasuryFee = (price * treasuryFeeBps) / 10_000;
        uint256 referrerFee = (price * referrerFeeBps) / 10_000;
        uint256 rebate = (price * rebateFeeBps) / 10_000;
        if (referrer == address(0)) {
            // no referral: entire fee to treasury, no rebate
            treasuryFee += referrerFee + rebate;
            referrerFee = 0;
            rebate = 0;
        }
        uint256 principal = price - treasuryFee - referrerFee - rebate;

        index = _open(msg.sender, msg.sender, tier, principal);
        emit Staked(msg.sender, msg.sender, tier, index, principal, referrer, generation);

        // interactions last (CEI)
        require(token.transferFrom(msg.sender, address(this), price), "transferFrom failed");
        if (treasuryFee > 0) require(token.transfer(treasury, treasuryFee), "fee transfer failed");
        if (referrerFee > 0) require(token.transfer(referrer, referrerFee), "ref transfer failed");
        if (rebate > 0) require(token.transfer(msg.sender, rebate), "rebate failed");
    }

    /**
     * Promo stake funded by the platform (owner) for a partner. No fee.
     * The beneficiary gets the permission; the refund always returns to the
     * funder, so promo tokens are never claimable by the beneficiary.
     */
    function stakeFor(address beneficiary, uint8 tier)
        external
        onlyOwner
        nonReentrant
        returns (uint256 index)
    {
        require(!paused, "paused");
        require(beneficiary != address(0), "zero addr");
        uint256 price = stakePrice[tier];
        require(price > 0, "bad tier");

        index = _open(beneficiary, msg.sender, tier, price);
        emit Staked(beneficiary, msg.sender, tier, index, price, address(0), generation);

        require(token.transferFrom(msg.sender, address(this), price), "transferFrom failed");
    }

    function _open(
        address beneficiary,
        address funder,
        uint8 tier,
        uint256 principal
    ) private returns (uint256 index) {
        index = _positions[beneficiary].length;
        _positions[beneficiary].push(
            Position({
                tier: tier,
                active: true,
                generation: generation,
                createdAt: uint40(block.timestamp),
                funder: funder,
                principal: uint128(principal)
            })
        );
        activeCount[beneficiary][tier] += 1;
    }

    // -------------------------------------------------------------- unstake

    /**
     * Close a position; the full principal returns to the funder.
     * Only the funder can close (for self-stakes funder == beneficiary;
     * for promo stakes this is the platform's revoke switch).
     * Never pausable: user funds must always be withdrawable.
     */
    function unstake(address beneficiary, uint256 index) external nonReentrant {
        Position storage p = _positions[beneficiary][index];
        require(p.active, "inactive");
        require(msg.sender == p.funder, "not funder");

        p.active = false;
        activeCount[beneficiary][p.tier] -= 1;
        uint256 refund = p.principal;
        emit Unstaked(beneficiary, index, refund, p.funder);

        require(token.transfer(p.funder, refund), "refund failed");
    }

    // ---------------------------------------------------------------- views

    function hasActivePosition(address beneficiary, uint8 tier) external view returns (bool) {
        return activeCount[beneficiary][tier] > 0;
    }

    function positionsOf(address beneficiary) external view returns (Position[] memory) {
        return _positions[beneficiary];
    }

    function positionCount(address beneficiary) external view returns (uint256) {
        return _positions[beneficiary].length;
    }

    // ---------------------------------------------------------------- admin

    /// Adjust a tier price; bumps the generation. Existing positions unaffected.
    function setPrice(uint8 tier, uint256 price) external onlyOwner {
        require(tier == TIER_ORGANIZER || tier == TIER_BOT, "bad tier");
        require(price > 0, "zero price");
        generation += 1;
        stakePrice[tier] = price;
        emit PriceSet(tier, price, generation);
    }

    /// Adjust the fee split. Total is hard-capped at 5% forever.
    function setFees(uint16 treasuryBps, uint16 referrerBps, uint16 rebateBps) external onlyOwner {
        require(treasuryBps + referrerBps + rebateBps <= MAX_TOTAL_FEE_BPS, "fee > cap");
        treasuryFeeBps = treasuryBps;
        referrerFeeBps = referrerBps;
        rebateFeeBps = rebateBps;
        emit FeesSet(treasuryBps, referrerBps, rebateBps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "zero addr");
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    // Two-step ownership transfer (use a multisig as owner in production).
    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
