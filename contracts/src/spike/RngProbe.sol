// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title RngProbe
/// @notice Spike Phase 0: verifikasi perilaku blockhash di Monad untuk pola commit → future blockhash
///         (ARCHITECTURE §4.4). Bukan bagian dari game; jangan dipakai untuk uang.
contract RngProbe {
    error TooEarly(uint64 targetBlock, uint256 current);
    error NoCommit();

    mapping(address => uint64) public targetOf;

    event Committed(address indexed who, uint64 targetBlock, uint256 blockNumber);
    event Revealed(
        address indexed who,
        uint64 targetBlock,
        uint256 blockNumber,
        bytes32 targetHash,
        bytes32 hash256Ago,
        bytes32 hash300Ago,
        uint256 prevrandao
    );

    /// @notice Simpan `targetBlock = block.number + 1`, sama seperti Depths.
    function commit() external {
        uint64 t = uint64(block.number + 1);
        targetOf[msg.sender] = t;
        emit Committed(msg.sender, t, block.number);
    }

    /// @notice Baca `blockhash(targetBlock)` plus hash 256 dan 300 blok lalu (cek window/EIP-2935).
    function reveal() external returns (bytes32 targetHash) {
        uint64 t = targetOf[msg.sender];
        if (t == 0) revert NoCommit();
        if (block.number <= t) revert TooEarly(t, block.number);
        delete targetOf[msg.sender];
        targetHash = blockhash(t);
        bytes32 h256 = block.number >= 256 ? blockhash(block.number - 256) : bytes32(0);
        bytes32 h300 = block.number >= 300 ? blockhash(block.number - 300) : bytes32(0);
        emit Revealed(msg.sender, t, block.number, targetHash, h256, h300, block.prevrandao);
    }

    /// @notice `blockhash(n)` lewat eth_call, untuk memetakan window tanpa tx.
    function peek(uint256 n) external view returns (bytes32 h, uint256 current) {
        return (blockhash(n), block.number);
    }
}
