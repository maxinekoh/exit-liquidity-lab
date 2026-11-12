// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
interface IERC20 {
    function balanceOf(address) external view returns (uint);
    function transfer(address, uint) external returns (bool);
    function transferFrom(address, address, uint) external returns (bool);
}
/// @notice DEMO ONLY. Unrestricted faucet; never a real stablecoin.
contract DemoToken {
    string public constant name = "Demo Dollar";
    string public constant symbol = "dUSD";
    uint8 public constant decimals = 6;
    mapping(address => uint) public balanceOf;
    mapping(address => mapping(address => uint)) public allowance;
    event Transfer(address indexed from, address indexed to, uint value);
    event Approval(address indexed owner, address indexed spender, uint value);
    function mint(uint a) external {
        require(a <= 1000000e6, "faucet cap");
        balanceOf[msg.sender] += a;
        emit Transfer(address(0), msg.sender, a);
    }
    function approve(address s, uint a) external returns (bool) {
        allowance[msg.sender][s] = a;
        emit Approval(msg.sender, s, a);
        return true;
    }
    function transfer(address t, uint a) external returns (bool) {
        _move(msg.sender, t, a);
        return true;
    }
    function transferFrom(
        address f,
        address t,
        uint a
    ) external returns (bool) {
        require(allowance[f][msg.sender] >= a, "allowance");
        allowance[f][msg.sender] -= a;
        _move(f, t, a);
        return true;
    }
    function _move(address f, address t, uint a) internal {
        require(t != address(0) && balanceOf[f] >= a, "balance");
        balanceOf[f] -= a;
        balanceOf[t] += a;
        emit Transfer(f, t, a);
    }
}
/// @notice Models delayed liquidity. Manager controls return timing, not destination.
contract LiquidityFixture {
    IERC20 public immutable asset;
    address public immutable vault;
    address public immutable manager;
    event Returned(uint amount);
    constructor(IERC20 a, address m) {
        asset = a;
        vault = msg.sender;
        manager = m;
    }
    function release(uint a) external {
        require(msg.sender == manager, "manager");
        require(asset.transfer(vault, a), "transfer");
        emit Returned(a);
    }
}
/// @notice Principal-only experimental vault, NOT ERC-4626/7540 compliant.
contract ExitVault {
    IERC20 public immutable asset;
    LiquidityFixture public immutable strategy;
    address public immutable manager;
    uint public immutable duration;
    uint public currentRound = 1;
    uint public reserved;
    uint public principal;
    // Bound q*F below 10**36, safely below uint256 max.
    uint public constant MAX_PRINCIPAL = 1e18;
    bool private entered;
    mapping(address => uint) public available;
    struct Round {
        uint closesAt;
        uint total;
        uint funded;
        bool closed;
    }
    mapping(uint => Round) public rounds;
    mapping(uint => mapping(address => uint)) public requests;
    mapping(uint => mapping(address => uint)) public paid;
    event Deposited(address indexed user, uint amount);
    event Requested(address indexed user, uint indexed round, uint amount);
    event Closed(uint indexed round, uint requested);
    event Funded(uint indexed round, uint amount, uint cumulative);
    event Claimed(address indexed user, uint indexed round, uint amount);
    event Deployed(uint amount);
    modifier guard() {
        require(!entered, "reentrancy");
        entered = true;
        _;
        entered = false;
    }
    constructor(IERC20 a, uint d) {
        require(address(a) != address(0) && d >= 10 && d <= 30 days, "config");
        asset = a;
        manager = msg.sender;
        duration = d;
        strategy = new LiquidityFixture(a, msg.sender);
        rounds[1].closesAt = block.timestamp + d;
    }
    function deposit(uint a) external guard {
        require(a > 0 && a <= 1e18, "amount");
        require(principal + a <= MAX_PRINCIPAL, "principal cap");
        uint b = asset.balanceOf(address(this));
        require(asset.transferFrom(msg.sender, address(this), a), "transfer");
        require(asset.balanceOf(address(this)) == b + a, "unsupported token");
        available[msg.sender] += a;
        principal += a;
        emit Deposited(msg.sender, a);
    }
    function request(uint a) external guard {
        Round storage r = rounds[currentRound];
        require(!r.closed && block.timestamp < r.closesAt, "window");
        require(a > 0 && available[msg.sender] >= a, "amount");
        available[msg.sender] -= a;
        requests[currentRound][msg.sender] += a;
        r.total += a;
        emit Requested(msg.sender, currentRound, a);
    }
    function deploy(uint a) external guard {
        require(msg.sender == manager, "manager");
        Round storage r = rounds[currentRound];
        require(!r.closed && r.total == 0, "requests pending");
        require(a > 0 && a <= freeLiquidity(), "liquidity");
        require(asset.transfer(address(strategy), a), "transfer");
        emit Deployed(a);
    }
    function freeLiquidity() public view returns (uint) {
        return asset.balanceOf(address(this)) - reserved;
    }
    function close() external guard {
        Round storage r = rounds[currentRound];
        require(!r.closed && block.timestamp >= r.closesAt, "window");
        r.closed = true;
        emit Closed(currentRound, r.total);
        if (r.total == 0) _next();
    }
    function settle() external guard {
        Round storage r = rounds[currentRound];
        require(r.closed, "not closed");
        uint a = freeLiquidity();
        uint remaining = r.total - r.funded;
        if (a > remaining) a = remaining;
        require(a > 0, "no liquidity");
        r.funded += a;
        reserved += a;
        emit Funded(currentRound, a, r.funded);
        if (r.funded == r.total) _next();
    }
    function claimable(uint id, address u) public view returns (uint) {
        Round storage r = rounds[id];
        if (r.total == 0) return 0;
        return (requests[id][u] * r.funded) / r.total - paid[id][u];
    }
    function claim(uint id) external guard {
        uint a = claimable(id, msg.sender);
        require(a > 0, "no claim");
        paid[id][msg.sender] += a;
        reserved -= a;
        principal -= a;
        require(asset.transfer(msg.sender, a), "transfer");
        emit Claimed(msg.sender, id, a);
    }
    function _next() private {
        currentRound++;
        rounds[currentRound].closesAt = block.timestamp + duration;
    }
}
