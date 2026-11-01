// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

interface IUniswapV3PoolLike {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function token0() external view returns (address);
}

interface ISwapRouter02Like {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
}

/// @title One collection account per rental contract.
/// @notice Rent arrives here as a local-currency stablecoin (wARS first). The agent splits it the way the landlord
/// chose: pesos to the landlord, a share swapped to USD₮ and sent to the landlord, a small capped fee.
/// @dev What the agent key can and cannot do, even if it is stolen:
///  - `settle` can only pay `landlord` and `feeRecipient`. There is no parameter for a recipient.
///  - A swap must return at least the floor: the pool's TWAP less `maxSlippageBps`, both checked here, not by the agent.
///  - `sweepBps` belongs to the landlord. The agent can only skip the swap, never raise the share.
///  - The landlord can take every token out at any time and can remove the agent for good.
///  - Signature checks accept one message only: Textile's taker-control text for this contract, signed by the agent.
contract AlDiaLease {
    enum Route {
        None,
        Uniswap,
        Textile
    }

    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 100;
    uint256 public constant MIN_SLIPPAGE_BPS = 10;
    uint256 public constant MAX_SLIPPAGE_BPS = 500;

    // Shared by every clone: they live in the implementation's code.
    IERC20 public immutable peso;
    IERC20 public immutable dollar;
    IUniswapV3PoolLike public immutable pool;
    uint24 public immutable poolFee;
    uint32 public immutable twapWindow;
    address public immutable reactor;
    ISwapRouter02Like public immutable router;
    address public immutable feeRecipient;

    address public landlord;
    address public agent;
    uint16 public sweepBps;
    uint16 public feeBps;
    uint16 public maxSlippageBps;
    bytes32 public termsHash;
    bool private entered;

    mapping(uint64 => bool) public settled;

    event LeaseOpened(address indexed landlord, address indexed agent, bytes32 termsHash, uint16 sweepBps, uint16 feeBps);
    event RentSettled(
        uint64 indexed id,
        uint256 pesoIn,
        uint256 fee,
        uint256 pesoToLandlord,
        uint256 dollarToLandlord,
        Route route,
        bytes32 receiptHash
    );
    event SweepChanged(uint16 sweepBps);
    event AgentRemoved();
    event Withdrawn(address indexed token, uint256 amount);

    error AlreadyInitialized();
    error NotAgent();
    error NotLandlord();
    error BadParam();
    error AlreadySettled();
    error BadAmount();
    error PriceBelowFloor(uint256 got, uint256 floor);
    error OverSpent();
    error TokenCallFailed();
    error Reentered();
    error UnexpectedPool();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier onlyLandlord() {
        if (msg.sender != landlord) revert NotLandlord();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert Reentered();
        entered = true;
        _;
        entered = false;
    }

    constructor(
        IERC20 peso_,
        IERC20 dollar_,
        IUniswapV3PoolLike pool_,
        uint24 poolFee_,
        uint32 twapWindow_,
        address reactor_,
        ISwapRouter02Like router_,
        address feeRecipient_
    ) {
        peso = peso_;
        dollar = dollar_;
        pool = pool_;
        poolFee = poolFee_;
        twapWindow = twapWindow_;
        reactor = reactor_;
        router = router_;
        feeRecipient = feeRecipient_;
        landlord = address(1); // the implementation itself can never be initialized
    }

    /// @notice Called once by the factory, in the same transaction that creates the clone.
    function initialize(
        address landlord_,
        address agent_,
        uint16 sweepBps_,
        uint16 feeBps_,
        uint16 maxSlippageBps_,
        bytes32 termsHash_
    ) external {
        if (landlord != address(0)) revert AlreadyInitialized();
        if (
            landlord_ == address(0) || landlord_ == address(1) || agent_ == address(0) || sweepBps_ > BPS
                || feeBps_ > MAX_FEE_BPS || maxSlippageBps_ < MIN_SLIPPAGE_BPS || maxSlippageBps_ > MAX_SLIPPAGE_BPS
        ) revert BadParam();
        landlord = landlord_;
        agent = agent_;
        sweepBps = sweepBps_;
        feeBps = feeBps_;
        maxSlippageBps = maxSlippageBps_;
        termsHash = termsHash_;
        emit LeaseOpened(landlord_, agent_, termsHash_, sweepBps_, feeBps_);
    }

    /// @notice Splits one received rent.
    /// @param id Unique per payment (yyyymm * 100 + n), so a rent can never be settled twice.
    /// @param amount Pesos to settle; at most what the contract holds.
    /// @param route `None` skips the swap, used when no venue clears the floor: the landlord then gets pesos.
    /// @param minDollarOut The agent's own limit. The contract enforces the higher of this and the TWAP floor.
    /// @param textileCall Textile's `transactions.swap.data` for a firm quote whose taker is this contract.
    /// @param receiptHash keccak256 of the published receipt, so anyone can check the document against this event.
    function settle(
        uint64 id,
        uint256 amount,
        Route route,
        uint256 minDollarOut,
        bytes calldata textileCall,
        bytes32 receiptHash
    ) external onlyAgent nonReentrant {
        if (settled[id]) revert AlreadySettled();
        settled[id] = true;
        uint256 held = peso.balanceOf(address(this));
        if (amount == 0 || amount > held) revert BadAmount();

        uint256 fee = (amount * feeBps) / BPS;
        uint256 net = amount - fee;
        uint256 sweep = route == Route.None ? 0 : (net * sweepBps) / BPS;
        uint256 pesoSpent;
        uint256 dollarOut;

        if (sweep > 0) {
            uint256 floor = quoteFloor(sweep);
            if (minDollarOut > floor) floor = minDollarOut;
            uint256 dollarBefore = dollar.balanceOf(address(this));
            if (route == Route.Uniswap) {
                _approve(address(router), sweep);
                router.exactInputSingle(
                    ISwapRouter02Like.ExactInputSingleParams({
                        tokenIn: address(peso),
                        tokenOut: address(dollar),
                        fee: poolFee,
                        recipient: address(this),
                        amountIn: sweep,
                        amountOutMinimum: floor,
                        sqrtPriceLimitX96: 0
                    })
                );
                _approve(address(router), 0);
            } else {
                _approve(reactor, sweep);
                (bool ok, bytes memory reason) = reactor.call(textileCall);
                if (!ok) {
                    assembly {
                        revert(add(reason, 32), mload(reason))
                    }
                }
                _approve(reactor, 0);
            }
            pesoSpent = held - peso.balanceOf(address(this));
            if (pesoSpent > sweep) revert OverSpent();
            dollarOut = dollar.balanceOf(address(this)) - dollarBefore;
            if (dollarOut < floor) revert PriceBelowFloor(dollarOut, floor);
            _transfer(dollar, landlord, dollarOut);
        }

        uint256 pesoOut = net - pesoSpent;
        if (pesoOut > 0) _transfer(peso, landlord, pesoOut);
        if (fee > 0) _transfer(peso, feeRecipient, fee);
        emit RentSettled(id, amount, fee, pesoOut, dollarOut, route, receiptHash);
    }

    /// @notice The share of each rent to turn into dollars. The landlord's choice alone.
    function setSweep(uint16 bps) external onlyLandlord {
        if (bps > BPS) revert BadParam();
        sweepBps = bps;
        emit SweepChanged(bps);
    }

    /// @notice Removes the agent for good. Funds stay here for `withdraw`.
    function removeAgent() external onlyLandlord {
        agent = address(0);
        emit AgentRemoved();
    }

    /// @notice Takes a whole token balance out. `address(0)` means native CELO.
    function withdraw(address token) external onlyLandlord nonReentrant {
        uint256 amount;
        if (token == address(0)) {
            amount = address(this).balance;
            (bool ok,) = landlord.call{value: amount}("");
            if (!ok) revert TokenCallFailed();
        } else {
            amount = IERC20(token).balanceOf(address(this));
            _transfer(IERC20(token), landlord, amount);
        }
        emit Withdrawn(token, amount);
    }

    /// @notice Least USD₮ acceptable for `pesoIn`: the TWAP price less the landlord's slippage limit.
    function quoteFloor(uint256 pesoIn) public view returns (uint256) {
        return (quoteAtTwap(pesoIn) * (BPS - maxSlippageBps)) / BPS;
    }

    /// @notice USD₮ for `pesoIn` at the pool's time-weighted price over `twapWindow`.
    function quoteAtTwap(uint256 pesoIn) public view returns (uint256) {
        return (pesoIn * priceQ128(twapTick())) >> 128;
    }

    function twapTick() public view returns (int24) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = twapWindow;
        (int56[] memory cum,) = pool.observe(ago);
        int56 delta = cum[1] - cum[0];
        int56 window = int56(uint56(twapWindow));
        int56 tick = delta / window;
        if (delta < 0 && delta % window != 0) tick--; // round toward negative infinity, as Uniswap's oracle does
        return int24(tick);
    }

    /// @notice Raw USD₮ units per raw peso unit in Q128, from a pool tick.
    /// @dev 1.0001^tick by repeated squaring, with (1/1.0001)^(2^k) tables in Q128. Peso tokens have 18 decimals and
    /// USD₮ has 6, so the raw price is always far below one: the exponent is negative for either token order, and
    /// anything else means the pool is not the one this contract expects.
    function priceQ128(int24 tick) public view returns (uint256 r) {
        int256 e = pool.token0() == address(peso) ? int256(tick) : -int256(tick);
        if (e >= 0) revert UnexpectedPool();
        uint256 t = uint256(-e);
        r = 1 << 128;
        if (t & 0x1 != 0) r = (r * 0xfff97272373d413259a46990580e2139) >> 128;
        if (t & 0x2 != 0) r = (r * 0xfff2e50f5f656932ef12357cf3c7fdcb) >> 128;
        if (t & 0x4 != 0) r = (r * 0xffe5caca7e10e4e61c3624eaa0941ccf) >> 128;
        if (t & 0x8 != 0) r = (r * 0xffcb9843d60f6159c9db58835c926643) >> 128;
        if (t & 0x10 != 0) r = (r * 0xff973b41fa98c081472e6896dfb254bf) >> 128;
        if (t & 0x20 != 0) r = (r * 0xff2ea16466c96a3843ec78b326b52860) >> 128;
        if (t & 0x40 != 0) r = (r * 0xfe5dee046a99a2a811c461f1969c3052) >> 128;
        if (t & 0x80 != 0) r = (r * 0xfcbe86c7900a88aedcffc83b479aa3a3) >> 128;
        if (t & 0x100 != 0) r = (r * 0xf987a7253ac413176f2b074cf7815e53) >> 128;
        if (t & 0x200 != 0) r = (r * 0xf3392b0822b70005940c7a398e4b70f2) >> 128;
        if (t & 0x400 != 0) r = (r * 0xe7159475a2c29b7443b29c7fa6e889d8) >> 128;
        if (t & 0x800 != 0) r = (r * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (t & 0x1000 != 0) r = (r * 0xa9f746462d870fdf8a65dc1f90e061e4) >> 128;
        if (t & 0x2000 != 0) r = (r * 0x70d869a156d2a1b890bb3df62baf32f6) >> 128;
        if (t & 0x4000 != 0) r = (r * 0x31be135f97d08fd981231505542fcfa5) >> 128;
        if (t & 0x8000 != 0) r = (r * 0x9aa508b5b7a84e1c677de54f3e99bc8) >> 128;
        if (t & 0x10000 != 0) r = (r * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (t & 0x20000 != 0) r = (r * 0x2216e584f5fa1ea926041bedfe97) >> 128;
        if (t & 0x40000 != 0) r = (r * 0x48a170391f7dc42444e8fa2) >> 128;
        if (t & 0x80000 != 0) r = (r * 0x149b34ee7ac262) >> 128;
    }

    /// @notice ERC-1271, used only so Textile can check the agent controls this taker.
    /// @dev `signature` is the 32-byte nonce, the 32-byte issuedAt (ms), then the agent's 65-byte signature. The digest
    /// is rebuilt from this contract's own address and chain, so a signature can vouch for nothing else: not a token
    /// permit, not a transfer authorization, not a different contract.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signature.length != 129) return 0xffffffff;
        bytes32 nonce = bytes32(signature[:32]);
        uint256 issuedAt = uint256(bytes32(signature[32:64]));
        if (hash != takerControlDigest(nonce, issuedAt)) return 0xffffffff;
        bytes32 r = bytes32(signature[64:96]);
        bytes32 s = bytes32(signature[96:128]);
        uint8 v = uint8(signature[128]);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return 0xffffffff;
        address signer = ecrecover(hash, v, r, s);
        return signer != address(0) && signer == agent ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    /// @notice EIP-712 digest of Textile's TakerControl message with this contract as the taker.
    function takerControlDigest(bytes32 nonce, uint256 issuedAt) public view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId)"),
                keccak256("Textile Taker Control"),
                keccak256("1"),
                block.chainid
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("TakerControl(address taker,uint256 chainId,bytes32 nonce,uint256 issuedAt)"),
                address(this),
                block.chainid,
                nonce,
                issuedAt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    /// @dev The reactor sends any native CELO it holds to the filler at the end of a fill. Refusing it would let anyone
    /// block settlement with one wei.
    receive() external payable {}

    function _approve(address spender, uint256 amount) private {
        (bool ok, bytes memory ret) =
            address(peso).call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }

    function _transfer(IERC20 token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) =
            address(token).call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }
}
