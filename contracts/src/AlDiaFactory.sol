// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AlDiaLease, IERC20, ISwapRouter02Like, IUniswapV3PoolLike} from "./AlDiaLease.sol";

/// @title Creates one AlDiaLease clone per rental contract.
/// @notice Anyone can open a lease, but a lease is only served when it names this factory's agent, and the clone
/// address is derived from all of its terms, so nobody can squat an address with different terms.
contract AlDiaFactory {
    address public immutable implementation;
    address public immutable agent;

    event LeaseCreated(address indexed lease, address indexed landlord, bytes32 termsHash);

    error CreateFailed();

    constructor(
        address agent_,
        IERC20 peso,
        IERC20 dollar,
        IUniswapV3PoolLike pool,
        uint24 poolFee,
        uint32 twapWindow,
        uint32 twapWindowLong,
        address reactor,
        ISwapRouter02Like router,
        address feeRecipient
    ) {
        agent = agent_;
        implementation =
            address(new AlDiaLease(peso, dollar, pool, poolFee, twapWindow, twapWindowLong, reactor, router, feeRecipient));
    }

    function createLease(
        address landlord,
        uint16 sweepBps,
        uint16 feeBps,
        uint16 maxSlippageBps,
        bytes32 termsHash,
        bytes32 salt
    ) external returns (address lease) {
        bytes memory code = _proxyCode();
        bytes32 s = _salt(landlord, sweepBps, feeBps, maxSlippageBps, termsHash, salt);
        assembly {
            lease := create2(0, add(code, 32), mload(code), s)
        }
        if (lease == address(0)) revert CreateFailed();
        AlDiaLease(payable(lease)).initialize(landlord, agent, sweepBps, feeBps, maxSlippageBps, termsHash);
        emit LeaseCreated(lease, landlord, termsHash);
    }

    function predict(
        address landlord,
        uint16 sweepBps,
        uint16 feeBps,
        uint16 maxSlippageBps,
        bytes32 termsHash,
        bytes32 salt
    ) external view returns (address) {
        bytes32 s = _salt(landlord, sweepBps, feeBps, maxSlippageBps, termsHash, salt);
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), s, keccak256(_proxyCode())));
        return address(uint160(uint256(h)));
    }

    function _salt(
        address landlord,
        uint16 sweepBps,
        uint16 feeBps,
        uint16 maxSlippageBps,
        bytes32 termsHash,
        bytes32 salt
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(landlord, sweepBps, feeBps, maxSlippageBps, termsHash, salt));
    }

    /// @dev EIP-1167 minimal proxy pointing at the implementation.
    function _proxyCode() private view returns (bytes memory) {
        return abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }
}
