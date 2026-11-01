// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AlDiaFactory} from "../src/AlDiaFactory.sol";
import {AlDiaLease, IERC20, ISwapRouter02Like, IUniswapV3PoolLike} from "../src/AlDiaLease.sol";

interface ISlot0 {
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
}

/// Stands in for Textile's reactor: pulls `pesoIn` from the caller, pays `dollarOut`, and sends leftover CELO like the
/// real reactor does.
contract MockReactor {
    IERC20 immutable peso;
    IERC20 immutable dollar;
    uint256 public dollarOut;
    uint256 public pesoIn;

    constructor(IERC20 p, IERC20 d) {
        peso = p;
        dollar = d;
    }

    function setQuote(uint256 in_, uint256 out_) external {
        pesoIn = in_;
        dollarOut = out_;
    }

    function fill() external payable {
        (bool ok,) = address(peso).call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), pesoIn)
        );
        require(ok, "pull");
        dollar.transfer(msg.sender, dollarOut);
        if (address(this).balance > 0) {
            (bool sent,) = msg.sender.call{value: address(this).balance}("");
            require(sent, "refund");
        }
    }

    receive() external payable {}
}

/// Runs on a Celo mainnet fork: real wARS, real USD₮, the real Uniswap pool and router.
///   forge test --fork-url https://forno.celo.org
contract AlDiaForkTest is Test {
    IERC20 constant WARS = IERC20(0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D);
    IERC20 constant USDT = IERC20(0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e);
    IUniswapV3PoolLike constant POOL = IUniswapV3PoolLike(0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391);
    ISwapRouter02Like constant ROUTER = ISwapRouter02Like(0x5615CDAb10dc425a742d643d949a7F474C01abc4);
    uint24 constant FEE = 100;
    uint32 constant WINDOW = 1800;

    address landlord = makeAddr("landlord");
    address tenant = makeAddr("tenant");
    address treasury = makeAddr("treasury");
    uint256 agentKey = 0xA11CE;
    address agent;

    AlDiaFactory factory;
    AlDiaLease lease;
    MockReactor reactor;

    function setUp() public {
        vm.createSelectFork(vm.envOr("CELO_RPC", string("https://forno.celo.org")));
        agent = vm.addr(agentKey);
        reactor = new MockReactor(WARS, USDT);
        factory = new AlDiaFactory(agent, WARS, USDT, POOL, FEE, WINDOW, address(reactor), ROUTER, treasury);
        lease = _open(5000, 30, 100, bytes32(uint256(1)));
        vm.prank(address(POOL));
        WARS.transfer(tenant, 1_000_000e18);
        vm.prank(address(POOL));
        USDT.transfer(address(reactor), 5_000e6);
    }

    function _open(uint16 sweep, uint16 fee, uint16 slip, bytes32 salt) internal returns (AlDiaLease) {
        return AlDiaLease(payable(factory.createLease(landlord, sweep, fee, slip, keccak256("terms"), salt)));
    }

    function _pay(uint256 amount) internal {
        vm.prank(tenant);
        WARS.transfer(address(lease), amount);
    }

    function test_predictMatchesCreate() public {
        bytes32 salt = bytes32(uint256(7));
        address want = factory.predict(landlord, 1000, 30, 100, keccak256("terms"), salt);
        assertEq(address(_open(1000, 30, 100, salt)), want);
    }

    function test_cannotInitializeTwiceOrUseImplementation() public {
        vm.expectRevert(AlDiaLease.AlreadyInitialized.selector);
        lease.initialize(tenant, tenant, 0, 0, 100, 0);
        AlDiaLease impl = AlDiaLease(payable(factory.implementation()));
        vm.expectRevert(AlDiaLease.AlreadyInitialized.selector);
        impl.initialize(tenant, tenant, 0, 0, 100, 0);
    }

    function test_paramsAreBounded() public {
        vm.expectRevert();
        _open(10_001, 30, 100, bytes32(uint256(2)));
        vm.expectRevert();
        _open(5000, 101, 100, bytes32(uint256(3)));
        vm.expectRevert();
        _open(5000, 30, 501, bytes32(uint256(4)));
        vm.expectRevert();
        _open(5000, 30, 9, bytes32(uint256(5)));
    }

    function test_tickMathMatchesTheLivePool() public view {
        (uint160 sqrtP, int24 tick,,,,,) = ISlot0(address(POOL)).slot0();
        // pool price from sqrtPriceX96, in Q128
        uint256 fromPool = (uint256(sqrtP) * uint256(sqrtP)) >> 64;
        uint256 ours = lease.priceQ128(tick);
        // tick floors the price, so ours is at most one tick (1 bp) below the live price
        assertLe(ours, fromPool);
        assertGt(ours, (fromPool * 9998) / 10000);
    }

    function test_twapFloorIsNearTheLiveQuote() public view {
        uint256 oneMillion = 1_000_000e18;
        uint256 twap = lease.quoteAtTwap(oneMillion);
        uint256 usd = twap / 1e6;
        assertGt(usd, 300); // about $600 of pesos on 2026-11-01; generous bounds so a devaluation doesn't break it
        assertLt(usd, 1500);
        assertEq(lease.quoteFloor(oneMillion), (twap * 9900) / 10000);
    }

    function test_settleThroughUniswapPaysLandlordOnly() public {
        _pay(100_000e18);
        uint256 usdBefore = USDT.balanceOf(landlord);
        vm.prank(agent);
        lease.settle(20261101, 100_000e18, AlDiaLease.Route.Uniswap, 0, "", keccak256("receipt"));
        uint256 fee = (100_000e18 * 30) / 10_000;
        uint256 net = 100_000e18 - fee;
        assertEq(WARS.balanceOf(treasury), fee);
        assertEq(WARS.balanceOf(landlord), net - net / 2);
        assertEq(WARS.balanceOf(address(lease)), 0);
        assertGt(USDT.balanceOf(landlord), usdBefore);
        assertEq(USDT.balanceOf(address(lease)), 0);
        assertEq(WARS.balanceOf(agent), 0);
        assertEq(USDT.balanceOf(agent), 0);
    }

    function test_settleNoneGivesPesosOnly() public {
        _pay(100_000e18);
        vm.prank(agent);
        lease.settle(1, 100_000e18, AlDiaLease.Route.None, 0, "", bytes32(0));
        uint256 fee = (100_000e18 * 30) / 10_000;
        assertEq(WARS.balanceOf(landlord), 100_000e18 - fee);
        assertEq(USDT.balanceOf(landlord), 0);
    }

    function test_onlyAgentSettlesAndOnlyOnce() public {
        _pay(200_000e18);
        vm.expectRevert(AlDiaLease.NotAgent.selector);
        vm.prank(tenant);
        lease.settle(1, 1e18, AlDiaLease.Route.None, 0, "", 0);
        vm.prank(agent);
        lease.settle(1, 1e18, AlDiaLease.Route.None, 0, "", 0);
        vm.expectRevert(AlDiaLease.AlreadySettled.selector);
        vm.prank(agent);
        lease.settle(1, 1e18, AlDiaLease.Route.None, 0, "", 0);
    }

    function test_cannotSettleMoreThanHeld() public {
        _pay(1e18);
        vm.expectRevert(AlDiaLease.BadAmount.selector);
        vm.prank(agent);
        lease.settle(1, 2e18, AlDiaLease.Route.None, 0, "", 0);
    }

    function test_textileRouteHonoursTheFloor() public {
        _pay(100_000e18);
        uint256 net = 100_000e18 - (100_000e18 * 30) / 10_000;
        uint256 sweep = net / 2;
        uint256 floor = lease.quoteFloor(sweep);
        // A bad fill, one unit under the floor, must revert. Positive control: the fair fill below passes.
        reactor.setQuote(sweep, floor - 1);
        bytes memory call_ = abi.encodeCall(MockReactor.fill, ());
        vm.expectRevert(abi.encodeWithSelector(AlDiaLease.PriceBelowFloor.selector, floor - 1, floor));
        vm.prank(agent);
        lease.settle(7, 100_000e18, AlDiaLease.Route.Textile, 0, call_, 0);

        reactor.setQuote(sweep, floor);
        vm.prank(agent);
        lease.settle(7, 100_000e18, AlDiaLease.Route.Textile, 0, call_, 0);
        assertEq(USDT.balanceOf(landlord), floor);
        (, bytes memory ret) = address(WARS).staticcall(
            abi.encodeWithSignature("allowance(address,address)", address(lease), address(reactor))
        );
        assertEq(abi.decode(ret, (uint256)), 0);
    }

    function test_agentMinimumCanOnlyRaiseTheFloor() public {
        _pay(100_000e18);
        uint256 net = 100_000e18 - (100_000e18 * 30) / 10_000;
        uint256 sweep = net / 2;
        uint256 floor = lease.quoteFloor(sweep);
        reactor.setQuote(sweep, floor);
        bytes memory call_ = abi.encodeCall(MockReactor.fill, ());
        vm.expectRevert(abi.encodeWithSelector(AlDiaLease.PriceBelowFloor.selector, floor, floor + 1));
        vm.prank(agent);
        lease.settle(8, 100_000e18, AlDiaLease.Route.Textile, floor + 1, call_, 0);
    }

    function test_textileCannotPullMoreThanTheSweep() public {
        _pay(100_000e18);
        uint256 net = 100_000e18 - (100_000e18 * 30) / 10_000;
        uint256 sweep = net / 2;
        reactor.setQuote(sweep + 1, 10_000e6);
        bytes memory call_ = abi.encodeCall(MockReactor.fill, ());
        vm.expectRevert(); // allowance is exactly the sweep, so the pull itself fails
        vm.prank(agent);
        lease.settle(9, 100_000e18, AlDiaLease.Route.Textile, 0, call_, 0);
    }

    function test_reactorNativeRefundDoesNotBlockSettlement() public {
        _pay(100_000e18);
        vm.deal(address(reactor), 1);
        uint256 net = 100_000e18 - (100_000e18 * 30) / 10_000;
        uint256 sweep = net / 2;
        reactor.setQuote(sweep, lease.quoteFloor(sweep));
        vm.prank(agent);
        lease.settle(10, 100_000e18, AlDiaLease.Route.Textile, 0, abi.encodeCall(MockReactor.fill, ()), 0);
        assertEq(address(lease).balance, 1);
        vm.prank(landlord);
        lease.withdraw(address(0));
        assertEq(landlord.balance, 1);
    }

    function test_landlordKeepsControl() public {
        _pay(10_000e18);
        vm.expectRevert(AlDiaLease.NotLandlord.selector);
        vm.prank(agent);
        lease.setSweep(10_000);
        vm.expectRevert(AlDiaLease.NotLandlord.selector);
        vm.prank(agent);
        lease.withdraw(address(WARS));

        vm.prank(landlord);
        lease.setSweep(0);
        assertEq(lease.sweepBps(), 0);
        vm.prank(landlord);
        lease.withdraw(address(WARS));
        assertEq(WARS.balanceOf(landlord), 10_000e18);

        vm.prank(landlord);
        lease.removeAgent();
        vm.expectRevert(AlDiaLease.NotAgent.selector);
        vm.prank(agent);
        lease.settle(1, 1, AlDiaLease.Route.None, 0, "", 0);
    }

    function _proof(uint256 key, bytes32 nonce, uint256 issuedAt, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(nonce, issuedAt, r, s, v);
    }

    function test_erc1271VouchesOnlyForTakerControl() public view {
        bytes32 nonce = bytes32(uint256(42));
        uint256 issuedAt = 1_793_000_000_000;
        bytes32 digest = lease.takerControlDigest(nonce, issuedAt);
        assertEq(lease.isValidSignature(digest, _proof(agentKey, nonce, issuedAt, digest)), bytes4(0x1626ba7e));
        // wrong signer
        assertEq(lease.isValidSignature(digest, _proof(0xB0B, nonce, issuedAt, digest)), bytes4(0xffffffff));
        // the agent signing anything else, such as a token permit: refused even with a valid agent signature
        bytes32 permit = keccak256("some permit digest");
        assertEq(lease.isValidSignature(permit, _proof(agentKey, nonce, issuedAt, permit)), bytes4(0xffffffff));
        // wrong length
        assertEq(lease.isValidSignature(digest, hex"00"), bytes4(0xffffffff));
    }

    function test_removedAgentCannotVouch() public {
        bytes32 nonce = bytes32(uint256(42));
        uint256 issuedAt = 1_793_000_000_000;
        bytes32 digest = lease.takerControlDigest(nonce, issuedAt);
        vm.prank(landlord);
        lease.removeAgent();
        assertEq(lease.isValidSignature(digest, _proof(agentKey, nonce, issuedAt, digest)), bytes4(0xffffffff));
    }
}
