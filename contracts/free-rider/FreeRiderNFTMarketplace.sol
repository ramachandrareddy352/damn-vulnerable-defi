// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0; 

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../DamnValuableNFT.sol";

/**
 * @title FreeRiderNFTMarketplace
 * @author Damn Vulnerable DeFi (https://damnvulnerabledefi.xyz)
 */ 
contract FreeRiderNFTMarketplace is ReentrancyGuard {
    using Address for address payable;

    DamnValuableNFT public token;
    uint256 public offersCount;  // slot-1

    // tokenId -> price
    mapping(uint256 => uint256) private offers;

    event NFTOffered(address indexed offerer, uint256 tokenId, uint256 price);
    event NFTBought(address indexed buyer, uint256 tokenId, uint256 price);

    error InvalidPricesAmount();
    error InvalidTokensAmount();
    error InvalidPrice();
    error CallerNotOwner(uint256 tokenId);
    error InvalidApproval();
    error TokenNotOffered(uint256 tokenId);
    error InsufficientPayment();

    constructor(uint256 amount) payable {
        DamnValuableNFT _token = new DamnValuableNFT();   // gas savings
        _token.renounceOwnership();   // no owner for token contract
        for (uint256 i = 0; i < amount; ) {
            _token.safeMint(msg.sender);   // minter role is address(this)
            unchecked { ++i; }   // deployer can mint 'i' no.of tokens
        }
        token = _token;
    }

    function offerMany(uint256[] calldata tokenIds, uint256[] calldata prices) external nonReentrant {
        uint256 amount = tokenIds.length;
        if (amount == 0)
            revert InvalidTokensAmount();
            
        if (amount != prices.length)
            revert InvalidPricesAmount();

        for (uint256 i = 0; i < amount;) {
            unchecked {
                _offerOne(tokenIds[i], prices[i]);
                ++i;
            }
        }
    }

    function _offerOne(uint256 tokenId, uint256 price) private {
        DamnValuableNFT _token = token;   // gas savings

        if (price == 0)
            revert InvalidPrice();

        if (msg.sender != _token.ownerOf(tokenId))
            revert CallerNotOwner(tokenId);

        if (_token.getApproved(tokenId) != address(this) && !_token.isApprovedForAll(msg.sender, address(this)))
            revert InvalidApproval();   // msg.sender have to approve this contract for all NFTs

        offers[tokenId] = price;
        /// @audit-high/medium := what if the owner remove approval for this contract after calling offer function , the offers mapping is not updated
        // here we does not transferfrom the nft to address(this)

        assembly { // gas savings
            sstore(0x02, add(sload(0x02), 0x01))
        }
        emit NFTOffered(msg.sender, tokenId, price);
    }

    function buyMany(uint256[] calldata tokenIds) external payable nonReentrant {
        for (uint256 i = 0; i < tokenIds.length;) {
            unchecked {
                _buyOne(tokenIds[i]);
                ++i;
            } 
        }
    }

    function _buyOne(uint256 tokenId) private {
        uint256 priceToPay = offers[tokenId];
        if (priceToPay == 0)
            revert TokenNotOffered(tokenId);

        if (msg.value < priceToPay)   /// @audit-high := we pay for single nft and get all tokens
            revert InsufficientPayment();

        --offersCount;
 
        // transfer from seller to buyer
        DamnValuableNFT _token = token; // cache for gas savings
        _token.safeTransferFrom(_token.ownerOf(tokenId), msg.sender, tokenId);

        // pay seller using cached token
        /// @audit-high := after transfering token the owner of token is changed, here we are paying money to msg.sender and owner od nft is not getting money 
        payable(_token.ownerOf(tokenId)).sendValue(priceToPay);
        // extra amount is send to this contract

        emit NFTBought(msg.sender, tokenId, priceToPay);
    }

    receive() external payable {}
}
