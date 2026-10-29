// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BigTradePayout — signed-claim USDT payout vault
/// @notice Users claim USDT by presenting a voucher signed by the platform's
///         off-chain signer key. The server never sends on-chain transactions;
///         it only produces signatures. All payouts are bounded by on-chain caps.
///
/// Deploy targets: BSC (BEP20) and Tron (TRC20 via TVM — same code compiles).
///
/// Voucher digest signed off-chain:
///   keccak256(abi.encodePacked(address(this), to, amount, nonce, expiry))
/// wrapped as an Ethereum-signed message ("\x19Ethereum Signed Message:\n32").
/// The contract address inside the digest makes vouchers non-replayable across
/// deployments and chains.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract BigTradePayout {
    IERC20 public immutable usdt;

    address public owner;
    address public signer;

    bool public paused;

    uint256 public maxPerClaim;   // max USDT (raw units) per single claim
    uint256 public dailyLimit;    // max USDT (raw units) paid per UTC day

    // day (unix timestamp / 1 days) => total paid that day
    mapping(uint256 => uint256) public spentByDay;

    // voucher hash => used. One signature can never be spent twice.
    mapping(bytes32 => bool) public usedVoucher;

    event Claimed(address indexed to, uint256 amount, uint256 nonce);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event LimitsUpdated(uint256 maxPerClaim, uint256 dailyLimit);
    event Paused(bool paused);
    event EmergencyWithdraw(address indexed to, uint256 amount);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(
        address _usdt,
        address _signer,
        uint256 _maxPerClaim,
        uint256 _dailyLimit
    ) {
        require(_usdt != address(0) && _signer != address(0), "zero address");
        usdt = IERC20(_usdt);
        owner = msg.sender;
        signer = _signer;
        maxPerClaim = _maxPerClaim;
        dailyLimit = _dailyLimit;
    }

    /// @notice Claim USDT with a platform-signed voucher.
    /// @param to       recipient (must equal the address in the signed voucher)
    /// @param amount   raw USDT units (decimals depend on the token contract)
    /// @param nonce    unique nonce chosen by the backend
    /// @param expiry   unix timestamp after which the voucher is void
    /// @param signature 65-byte ECDSA signature over the voucher digest
    function claim(
        address to,
        uint256 amount,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external {
        require(!paused, "paused");
        require(to == msg.sender, "recipient must claim");
        require(block.timestamp <= expiry, "voucher expired");
        require(amount > 0, "zero amount");
        require(amount <= maxPerClaim, "exceeds per-claim cap");

        uint256 day = block.timestamp / 1 days;
        require(spentByDay[day] + amount <= dailyLimit, "daily limit reached");

        bytes32 digest = voucherDigest(to, amount, nonce, expiry);
        require(!usedVoucher[digest], "voucher already used");
        require(_recoverSigner(digest, signature) == signer, "bad signature");

        // Effects before interaction (reentrancy-safe by construction; USDT is
        // a trusted token, but ordering still follows checks-effects).
        usedVoucher[digest] = true;
        spentByDay[day] += amount;

        require(usdt.transfer(to, amount), "transfer failed");
        emit Claimed(to, amount, nonce);
    }

    /// @dev Digest the backend signs (ethers.js signMessage over these bytes).
    function voucherDigest(
        address to,
        uint256 amount,
        uint256 nonce,
        uint256 expiry
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), to, amount, nonce, expiry));
    }

    // ---- admin ----

    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "zero address");
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    function setLimits(uint256 _maxPerClaim, uint256 _dailyLimit) external onlyOwner {
        maxPerClaim = _maxPerClaim;
        dailyLimit = _dailyLimit;
        emit LimitsUpdated(_maxPerClaim, _dailyLimit);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Pull USDT out of the vault (rotate vault, excess float, emergency).
    /// @dev For mainnet, put `owner` behind a multisig or timelock.
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero address");
        require(usdt.transfer(to, amount), "transfer failed");
        emit EmergencyWithdraw(to, amount);
    }

    function vaultBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    // ---- internal ----

    function _recoverSigner(bytes32 digest, bytes calldata signature)
        internal
        pure
        returns (address)
    {
        require(signature.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );
        return ecrecover(ethHash, v, r, s);
    }
}
