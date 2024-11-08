const { ethers } = require('ethers');

// Minimal ERC20 ABI to get token information
const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function getERC721Address() view returns (address)"
];

// Initial contract ABI to get token list
const INITIAL_ABI = [
    "function getTokensList() view returns (address[])"
];

// Token contract ABI to check dispensers
const TOKEN_CONTRACT_ABI = [
    "function getDispensers() view returns (address[])"
];

class TokenFetcher {
    constructor(provider, dispenserAddress) {
        this.provider = provider;
        this.dispenserAddress = dispenserAddress;
    }

    async findNFTForToken(tokenAddress) {
        console.log('\n=== Analyzing Token ===');
        console.log('Initial Token Address:', tokenAddress);
        console.log('Expected Dispenser Address:', this.dispenserAddress);

        try {
            // Get contract code
            const code = await this.provider.getCode(tokenAddress);
            console.log('Contract Code Length:', code.length);
            console.log('Is Contract:', code !== '0x');

            if (code === '0x') {
                console.log('Not a contract, skipping...');
                return null;
            }

            // First try to get token information directly
            try {
                const erc20Contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
                const [name, symbol, erc721Address] = await Promise.all([
                    erc20Contract.name(),
                    erc20Contract.symbol(),
                    erc20Contract.getERC721Address()
                ]);

                // If we can get the ERC721 address, this is a valid datatoken
                if (erc721Address && erc721Address !== ethers.constants.AddressZero) {
                    console.log('Found valid datatoken with NFT address:', erc721Address);
                    return {
                        address: tokenAddress,
                        name,
                        symbol,
                        erc721Address
                    };
                }
            } catch (error) {
                console.log('Not a direct datatoken, checking token list...');
            }

            // If direct check fails, try to get the tokens list
            const initialContract = new ethers.Contract(tokenAddress, INITIAL_ABI, this.provider);
            
            try {
                console.log('Checking getTokensList()...');
                const tokensList = await initialContract.getTokensList();
                console.log('Tokens List:', tokensList);

                // For each token in the list, check if it's a valid datatoken
                for (const nftAddress of tokensList) {
                    console.log('\nChecking token contract:', nftAddress);
                    
                    try {
                        const erc20Contract = new ethers.Contract(nftAddress, ERC20_ABI, this.provider);
                        const [name, symbol, erc721Address] = await Promise.all([
                            erc20Contract.name(),
                            erc20Contract.symbol(),
                            erc20Contract.getERC721Address()
                        ]);

                        // If we can get the ERC721 address, this is a valid datatoken
                        if (erc721Address && erc721Address !== ethers.constants.AddressZero) {
                            console.log('Found valid datatoken in list with NFT address:', erc721Address);
                            
                            // Check for dispenser (optional)
                            try {
                                const nftContract = new ethers.Contract(
                                    nftAddress,
                                    TOKEN_CONTRACT_ABI,
                                    this.provider
                                );
                                const dispensers = await nftContract.getDispensers();
                                const hasOceanDispenser = dispensers.some(dispenser => 
                                    dispenser.toLowerCase() === this.dispenserAddress.toLowerCase()
                                );
                                console.log('Has Ocean Dispenser:', hasOceanDispenser);
                            } catch (error) {
                                console.log('Error checking dispensers (non-critical):', error.message);
                            }

                            return {
                                address: nftAddress,
                                name,
                                symbol,
                                initialTokenAddress: tokenAddress,
                                erc721Address
                            };
                        }
                    } catch (error) {
                        console.log('Error checking token:', error.message);
                    }
                }
            } catch (error) {
                console.log('Error getting tokens list:', error.message);
            }

            return null;
        } catch (error) {
            console.error(`Error analyzing token ${tokenAddress}:`, error);
            return null;
        }
    }

    async getTokenBalance(tokenAddress, walletAddress) {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
        try {
            const [balance, name, symbol, decimals, erc721Address] = await Promise.all([
                contract.balanceOf(walletAddress),
                contract.name(),
                contract.symbol(),
                contract.decimals(),
                contract.getERC721Address()
            ]);

            return {
                address: tokenAddress,
                name,
                symbol,
                balance: balance.toString(),
                decimals: decimals,
                erc721Address
            };
        } catch (error) {
            console.error(`Error getting token info for ${tokenAddress}:`, error);
            return null;
        }
    }

    async getTokensAndTransfers(walletAddress) {
        try {
            // Get token transfer events both to and from this wallet
            const incomingFilter = {
                topics: [
                    ethers.utils.id("Transfer(address,address,uint256)"),
                    null,  // from address (any)
                    ethers.utils.hexZeroPad(walletAddress, 32)  // to address (our wallet)
                ]
            };

            const outgoingFilter = {
                topics: [
                    ethers.utils.id("Transfer(address,address,uint256)"),
                    ethers.utils.hexZeroPad(walletAddress, 32),  // from address (our wallet)
                    null  // to address (any)
                ]
            };

            // Query the last 10000 blocks for transfer events
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 10000);

            // Get both incoming and outgoing transfers
            const [incomingEvents, outgoingEvents] = await Promise.all([
                this.provider.getLogs({
                    ...incomingFilter,
                    fromBlock
                }),
                this.provider.getLogs({
                    ...outgoingFilter,
                    fromBlock
                })
            ]);

            // Combine all events and get unique token addresses
            const allEvents = [...incomingEvents, ...outgoingEvents];
            const tokenAddresses = new Set(allEvents.map(event => event.address));
            console.log('\nFound', tokenAddresses.size, 'unique token addresses from transfers');

            // Find tokens from transfer events
            const tokensFromTransfers = await Promise.all(
                Array.from(tokenAddresses).map(tokenAddress => 
                    this.findNFTForToken(tokenAddress)
                )
            );

            // Also check current token balances for the wallet
            const balanceFilter = {
                topics: [
                    ethers.utils.id("Transfer(address,address,uint256)"),
                    null,
                    ethers.utils.hexZeroPad(walletAddress, 32)  // to address (our wallet)
                ],
                fromBlock: 0  // Check from genesis to find all possible tokens
            };

            const balanceEvents = await this.provider.getLogs(balanceFilter);
            const balanceTokenAddresses = new Set(balanceEvents.map(event => event.address));
            console.log('\nFound', balanceTokenAddresses.size, 'unique token addresses from balance check');

            // Find tokens from balance check
            const tokensFromBalances = await Promise.all(
                Array.from(balanceTokenAddresses).map(tokenAddress => 
                    this.findNFTForToken(tokenAddress)
                )
            );

            // Combine and deduplicate tokens
            const allTokens = [...tokensFromTransfers, ...tokensFromBalances]
                .filter(token => token !== null)
                .reduce((unique, token) => {
                    const exists = unique.find(t => t.address.toLowerCase() === token.address.toLowerCase());
                    if (!exists) {
                        unique.push(token);
                    }
                    return unique;
                }, []);

            // Get balances and transfers for all tokens
            const tokensWithBalances = await Promise.all(
                allTokens.map(async (token) => {
                    const balance = await this.getTokenBalance(token.address, walletAddress);
                    
                    // Get all transfers for this token
                    const tokenTransfers = allEvents.filter(event => 
                        event.address.toLowerCase() === token.address.toLowerCase()
                    );

                    return {
                        ...token,
                        balance: balance ? balance.balance : '0',
                        decimals: balance ? balance.decimals : 18,
                        erc721Address: balance ? balance.erc721Address : token.erc721Address,
                        transfers: tokenTransfers
                    };
                })
            );

            return {
                tokens: tokensWithBalances,
                message: tokensWithBalances.length > 0 
                    ? `Found ${tokensWithBalances.length} tokens`
                    : 'No tokens found'
            };
        } catch (error) {
            console.error('Error in getTokensAndTransfers:', error);
            throw error;
        }
    }
}

module.exports = TokenFetcher;
