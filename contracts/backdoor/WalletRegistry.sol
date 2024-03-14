// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "solady/src/auth/Ownable.sol";
import "solady/src/utils/SafeTransferLib.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/IProxyCreationCallback.sol";

/**
 * @title WalletRegistry
 * @notice A registry for Gnosis Safe wallets.
 *            When known beneficiaries deploy and register their wallets, the registry sends some Damn Valuable Tokens to the wallet.
 * @dev The registry has embedded verifications to ensure only legitimate Gnosis Safe wallets are stored.
 * @author Damn Vulnerable DeFi (https://damnvulnerabledefi.xyz)
 */
contract WalletRegistry is IProxyCreationCallback, Ownable {
    uint256 private constant EXPECTED_OWNERS_COUNT = 1;
    uint256 private constant EXPECTED_THRESHOLD = 1;
    uint256 private constant PAYMENT_AMOUNT = 10 ether;

    address public immutable masterCopy;
    address public immutable walletFactory;
    IERC20 public immutable token;

    mapping(address => bool) public beneficiaries;
    mapping(address => address) public wallets;     // owner => wallet

    constructor(
        address masterCopyAddress,
        address walletFactoryAddress,
        address tokenAddress,
        address[] memory initialBeneficiaries  /// @info := may be zero also
    ) {
        _initializeOwner(msg.sender);

        masterCopy = masterCopyAddress;
        walletFactory = walletFactoryAddress;
        token = IERC20(tokenAddress);

        for (uint256 i = 0; i < initialBeneficiaries.length;) {
            unchecked {
                beneficiaries[initialBeneficiaries[i]] = true;
                ++i;
            }
        }
    }

    function addBeneficiary(address beneficiary) external onlyOwner {
        beneficiaries[beneficiary] = true;  /// @info := beneficiary may be zero address
    }

    /**
     * @notice Function executed when user creates a Gnosis Safe wallet via GnosisSafeProxyFactory::createProxyWithCallback
     *          setting the registry's address as the callback.
     */
    // after calling proxyCreated by any one of the user, he creates a multisig wallet using GnosisSafeFactory and the DVD tokens are send to that user, so we create a attack contract and we call the proxyCreated for the user by the attacker.
    function proxyCreated(GnosisSafeProxy proxy, address singleton, bytes calldata initializer, uint256)
        external
        override
    {
        require(token.balanceOf(address(this)) >= PAYMENT_AMOUNT, "Balance should be greater than 10 ethers");

        address payable walletAddress = payable(proxy);

        // Ensure correct factory and master copy
        // only walletfactory can call the function
        require(msg.sender == walletFactory, "Only walletFactory can call");

        require(singleton == masterCopy,"Invalid master copy");

        // Ensure initial calldata was a call to `GnosisSafe::setup`
        require(bytes4(initializer[:4]) == GnosisSafe.setup.selector, "Invalid setup function selctor");

        // Ensure wallet initialization is the expected
        uint256 threshold = GnosisSafe(walletAddress).getThreshold();
        require(threshold == EXPECTED_THRESHOLD,"Invaldi threshold");

        address[] memory owners = GnosisSafe(walletAddress).getOwners();
        require(owners.length == EXPECTED_OWNERS_COUNT, "Invalid owners count");

        // Ensure the owner is a registered beneficiary
        address walletOwner;
        unchecked {
            walletOwner = owners[0];
        }
        require(beneficiaries[walletOwner], "Invalid beneficiary");

        address fallbackManager = _getFallbackManager(walletAddress);
        require(fallbackManager == address(0), "InvalidFallbackManager");

        // Remove owner as beneficiary
        beneficiaries[walletOwner] = false;

        // Register the wallet under the owner's address
        wallets[walletOwner] = walletAddress;

        // Pay tokens to the newly created wallet
        SafeTransferLib.safeTransfer(address(token), walletAddress, PAYMENT_AMOUNT);
    }

    function _getFallbackManager(address payable wallet) private view returns (address) {
        return abi.decode(
            GnosisSafe(wallet).getStorageAt(
                uint256(keccak256("fallback_manager.handler.address")),
                0x20
            ),
            (address)
        );
    }
}
