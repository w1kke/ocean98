// Asset display and sharing module
let assetsUpdateInterval = null;
let selectedNFTForSharing = null;

async function fetchAndDisplayAssets() {
    if (!window.userAddress) return;
    
    try {
        // Get current chain ID
        const chainId = await window.web3.eth.getChainId();
        
        const response = await fetch(`/api/user-assets/${window.userAddress}/${chainId}`);
        const data = await response.json();
        
        if (data.success && data.assets.length > 0) {
            const assetsContainer = document.getElementById('userAssets');
            assetsContainer.innerHTML = '';
            
            data.assets.forEach(asset => {
                const assetData = asset._source;
                const did = `${assetData.id || assetData.nft.address}`;
                const marketUrl = `https://market.oceanprotocol.com/asset/${did}`;
                const card = document.createElement('div');
                card.className = 'asset-card window';
                
                // Format the date nicely
                const createdDate = new Date(assetData.metadata.created).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                card.innerHTML = `
                    <div class="title-bar">
                        <div class="title-bar-text">${assetData.metadata.name}</div>
                        <div class="title-bar-controls">
                            <button aria-label="Minimize"></button>
                            <button aria-label="Maximize"></button>
                            <button aria-label="Close"></button>
                        </div>
                    </div>
                    <div class="window-body">
                        <div class="asset-preview">
                            <img src="${assetData.metadata.previewImageUrl || '/images/icq-flower.png'}" alt="NFT Preview" class="asset-image">
                        </div>
                        <p><strong>Description:</strong> ${assetData.metadata.description}</p>
                        <p><strong>Author:</strong> ${assetData.metadata.author}</p>
                        <p><strong>Created:</strong> ${createdDate}</p>
                        <p><strong>NFT Address:</strong> ${assetData.nft.address}</p>
                        <p><strong>Datatoken:</strong> ${assetData.datatokens[0].symbol}</p>
                        <div class="button-bar">
                            <button onclick="window.showShareDialog('${assetData.nft.address}', '${assetData.datatokens[0].address}')" class="share-btn">
                                Share Access
                            </button>
                            <button onclick="window.open('${marketUrl}', '_blank')" class="market-btn">
                                View in Ocean Market
                            </button>
                        </div>
                    </div>
                `;
                
                assetsContainer.appendChild(card);
            });
        } else {
            const assetsContainer = document.getElementById('userAssets');
            assetsContainer.innerHTML = `
                <div class="no-assets-message">
                    No NFTs found for this wallet on the current network. Create your first NFT above!
                </div>
            `;
        }
    } catch (error) {
        console.error('Error fetching assets:', error);
    }
}

function showShareDialog(nftAddress, datatokenAddress) {
    selectedNFTForSharing = { nftAddress, datatokenAddress };
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.body.appendChild(overlay);

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'share-dialog window';
    dialog.innerHTML = `
        <div class="title-bar">
            <div class="title-bar-text">Share NFT Access</div>
            <div class="title-bar-controls">
                <button aria-label="Close" onclick="window.closeShareDialog()"></button>
            </div>
        </div>
        <div class="window-body">
            <p>Select a friend to share access with:</p>
            <div class="share-dialog-content" id="shareFriendsList">
                ${window.friends && window.friends.length > 0 ? 
                    window.friends.map(friend => `
                        <div class="share-friend-item" onclick="window.toggleFriendSelection(this, '${friend}')">
                            ${friend.slice(0, 6)}...${friend.slice(-4)}
                            <input type="hidden" value="${friend}">
                        </div>
                    `).join('') : 
                    '<p>No friends added yet. Add friends to share your NFT access.</p>'
                }
            </div>
            <div class="dialog-buttons">
                <button class="btn" onclick="window.closeShareDialog()">Cancel</button>
                <button class="btn" onclick="window.shareAccess()" id="shareButton" ${!window.friends || window.friends.length === 0 ? 'disabled' : ''}>Share</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
}

function closeShareDialog() {
    const dialog = document.querySelector('.share-dialog');
    const overlay = document.querySelector('.overlay');
    if (dialog) dialog.remove();
    if (overlay) overlay.remove();
    selectedNFTForSharing = null;
}

function toggleFriendSelection(element, friendAddress) {
    const allItems = document.querySelectorAll('.share-friend-item');
    allItems.forEach(item => item.classList.remove('selected'));
    element.classList.add('selected');
}

async function shareAccess() {
    const selectedFriend = document.querySelector('.share-friend-item.selected');
    if (!selectedFriend || !selectedNFTForSharing) return;

    // Get the full address from the hidden input
    const friendAddress = selectedFriend.querySelector('input[type="hidden"]').value;
    
    try {
        // Show status in the UI
        const statusDiv = document.createElement('div');
        statusDiv.className = 'transaction-status';
        statusDiv.innerHTML = `
            <div id="mintStatus" class="tx-status">
                <span class="tx-label">Sharing Access:</span>
                <span class="tx-state waiting">Waiting for approval...</span>
            </div>
        `;
        document.querySelector('.share-dialog .window-body').appendChild(statusDiv);

        // Get the datatoken contract ABI
        const datatokenAbi = [
            {
                "inputs": [
                    { "internalType": "address", "name": "account", "type": "address" },
                    { "internalType": "uint256", "name": "amount", "type": "uint256" }
                ],
                "name": "mint",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            }
        ];

        // Create contract instance for the datatoken
        const datatokenContract = new window.web3.eth.Contract(
            datatokenAbi,
            selectedNFTForSharing.datatokenAddress
        );

        // Mint 1 datatoken (using 18 decimals, so 1 = 1000000000000000000)
        const amount = '1000000000000000000';
        const mintTx = await datatokenContract.methods.mint(friendAddress, amount).send({
            from: window.userAddress
        });

        // Update status
        window.updateTransactionStatus('mintStatus', 'success', 'Access shared successfully!');

        // Wait for 2 seconds to show success status before closing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Close the dialog
        closeShareDialog();

    } catch (error) {
        console.error('Error sharing NFT access:', error);
        // Show error in the status
        const statusElement = document.querySelector('.tx-state.pending');
        if (statusElement) {
            statusElement.className = 'tx-state error';
            statusElement.textContent = 'Error: ' + error.message;
        }
    }
}

// Export functions and variables
window.assetsUpdateInterval = assetsUpdateInterval;
window.selectedNFTForSharing = selectedNFTForSharing;
window.fetchAndDisplayAssets = fetchAndDisplayAssets;
window.showShareDialog = showShareDialog;
window.closeShareDialog = closeShareDialog;
window.toggleFriendSelection = toggleFriendSelection;
window.shareAccess = shareAccess;