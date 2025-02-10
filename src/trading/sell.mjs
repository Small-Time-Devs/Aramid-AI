import axios from 'axios';
import { getWalletDetails, updateTradeWithSellInfo } from '../db/dynamo.mjs';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { fetchTokenPairs } from '../utils/apiUtils.mjs';
import { config } from '../config/config.mjs';
import { checkTokenBalance, closeTokenAccount } from '../utils/solanaUtils.mjs';

const MAX_SELL_ATTEMPTS = 3;
const CONFIRMATION_WAIT_TIME = 15000; // 15 seconds
const DUST_THRESHOLD = 1; // Minimum tokens to consider as dust

async function retryOperation(operation, maxRetries = 5) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`Attempt ${attempt} failed:`, error.message);
      if (attempt < maxRetries) {
        // Wait for 5 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  throw new Error(`Operation failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
}

async function verifyAndCleanupSale(trade, tokenAddress, ownerPublicKey, privateKeyString) {
  try {
    // Wait for transaction to land
    await new Promise(resolve => setTimeout(resolve, CONFIRMATION_WAIT_TIME));
    
    // Check remaining balance
    const remainingBalance = await checkTokenBalance(tokenAddress, ownerPublicKey);
    
    if (remainingBalance > DUST_THRESHOLD) {
      console.log(`Detected ${remainingBalance} tokens remaining after sale, attempting cleanup...`);
      
      // Try to sell remaining tokens
      for (let attempt = 1; attempt <= MAX_SELL_ATTEMPTS; attempt++) {
        console.log(`Attempt ${attempt} to sell remaining tokens...`);
        
        const sellResult = await executeTradeSell(trade, null, true); // true flag for cleanup
        if (sellResult.success) {
          await new Promise(resolve => setTimeout(resolve, CONFIRMATION_WAIT_TIME));
          const finalBalance = await checkTokenBalance(tokenAddress, ownerPublicKey);
          
          if (finalBalance <= DUST_THRESHOLD) {
            break;
          }
        }
        
        if (attempt === MAX_SELL_ATTEMPTS) {
          console.log('Failed to sell remaining tokens, will proceed to burn them');
        }
      }
    }

    // Add debug logging for private key
    console.log('Attempting cleanup with key info:', {
      keyLength: privateKeyString?.length || 0,
      ownerPublicKey,
      tokenAddress
    });

    // Close token account with error handling
    console.log('Attempting to close token account...');
    try {
      const closed = await closeTokenAccount(
        tokenAddress, 
        ownerPublicKey, 
        privateKeyString
      );
      
      if (closed) {
        console.log('Successfully closed token account and reclaimed rent');
      } else {
        console.log('Failed to close token account');
      }
    } catch (error) {
      console.error('Error during token account closure:', error);
    }
    
    return true;
  } catch (error) {
    console.error('Error in verification and cleanup:', error);
    return false;
  }
}

export async function executeTradeSell(trade, currentPrice, isCleanup = false) {
  try {
    // Get wallet details from DynamoDB
    const walletDetails = await getWalletDetails(config.twitter.botUserId);
    
    if (!walletDetails || !walletDetails.solPrivateKey) {
      throw new Error('Wallet details not found or private key missing');
    }

    // Check if we still own the tokens before attempting to sell
    const tokenBalance = await checkTokenBalance(
      trade.tokenAddress,
      config.cryptoGlobals.publicKey
    );

    if (tokenBalance <= 0) {
      console.log('No tokens found in wallet, removing trade from monitoring');
      return { success: false, error: 'No tokens found in wallet' };
    }

    // Always sell entire balance
    const sellAmount = tokenBalance;
    
    // Log the token balance before attempting sell
    console.log('Attempting to sell:', {
      tokenAddress: trade.tokenAddress,
      sellAmount,
      currentPrice,
      tradeType: trade.tradeType,
      actualBalance: tokenBalance
    });

    const sellRequest = {
      private_key: decryptPrivateKey(walletDetails.solPrivateKey),
      inputMint: trade.tokenAddress,
      amount: sellAmount,
    };

    try {
      // Implement retry logic for the sell operation
      const sellResponse = await retryOperation(async () => {
        const response = await axios.post(
          'https://api.smalltimedevs.com/solana/raydium-api/jupiterSell', 
          sellRequest,
          { timeout: 30000 }
        );
        if (!response.data.success) {
          throw new Error('Sell order failed or no transaction ID received');
        }
        return response;
      });

      // Log successful response
      console.log('Sell response:', {
        success: sellResponse.data.success,
        txId: sellResponse.data.txid,
      });

      if (sellResponse.data.success) {
        // Only proceed with cleanup if not already in cleanup mode
        if (!isCleanup) {
          await verifyAndCleanupSale(
            trade,
            trade.tokenAddress,
            config.cryptoGlobals.publicKey,
            decryptPrivateKey(walletDetails.solPrivateKey)
          );
        }

        const priceChangePercent = ((currentPrice - trade.entryPriceSOL) / trade.entryPriceSOL) * 100;
        
        // Get current token data for USD price
        const tokenData = await fetchTokenPairs(trade.tokenAddress);
        const currentTokenName = tokenData.tokenName;
        const currentPriceInSol = tokenData.priceNative;
        const currentPriceInUSD = tokenData.priceUsd;
        if (!tokenData) {
          throw new Error('Failed to fetch token price data');
        }

        // Prepare sell info
        const sellInfo = {
          exitPriceSOL: currentPriceInSol,
          exitPriceUSD: currentPriceInUSD,
          sellPercentageGain: priceChangePercent > 0 ? priceChangePercent : 0,
          sellPercentageLoss: priceChangePercent < 0 ? Math.abs(priceChangePercent) : 0
        };

        // Update trade info and move to past trades
        await updateTradeWithSellInfo(trade.tradeId, sellInfo);

        console.log('Trade completed and archived:', {
          tradeId: trade.tradeId,
          tokenAddress: trade.tokenAddress,
          priceChangePercent,
          exitPrice: currentPriceInSol
        });

        return { success: true, priceChangePercent };
      }

      return { success: false, error: 'Sell order failed' };
    } catch (apiError) {
      // Detailed API error logging
      console.error('Sell API error:', {
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        data: apiError.response?.data,
        error: apiError.message
      });
      throw new Error(`Sell API error: ${apiError.message}`);
    }
  } catch (error) {
    console.error('Error executing sell:', {
      error: error.message,
      stack: error.stack,
      trade: {
        id: trade.tradeId,
        token: trade.tokenAddress
      }
    });
    return { success: false, error: error.message };
  }
}
