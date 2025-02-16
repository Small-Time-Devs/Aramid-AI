import axios from 'axios';
import { getWalletDetails, updateTradeWithSellInfo, moveTradeToPastTrades } from '../db/dynamo.mjs';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { fetchTokenPairs } from '../utils/apiUtils.mjs';
import { config } from '../config/config.mjs';
import { checkTokenBalance, closeTokenAccount } from '../utils/solanaUtils.mjs';
import { sendTradeNotification } from '../utils/discord.mjs';

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
      try {
        const sellResult = await executeTradeSell(trade, null, true); // true flag for cleanup
        if (sellResult.success) {
          console.log('Successfully sold remaining tokens in cleanup');
        }
      } catch (cleanupError) {
        console.log('Error selling remaining tokens:', cleanupError.message);
      }
    }

    // Close token account
    console.log('Attempting to close token account...');
    try {
      await closeTokenAccount(tokenAddress, ownerPublicKey, privateKeyString);
      console.log('Successfully closed token account and reclaimed rent');
    } catch (closeError) {
      console.error('Error closing token account:', closeError.message);
    }
    
    return true;
  } catch (error) {
    console.error('Error in verification and cleanup:', error);
    return false;
  }
}

export async function executeTradeSell(trade, currentPrice, isCleanup = false) {
  try {
    // Get latest token data for pricing
    const tokenData = await fetchTokenPairs(trade.tokenAddress);
    const exitPriceSOL = currentPrice || tokenData?.priceNative;
    const exitPriceUSD = tokenData?.priceUsd;

    // Get actual token balance
    const actualBalance = await checkTokenBalance(trade.tokenAddress, config.cryptoGlobals.publicKey);
    if (!actualBalance || actualBalance < 1) {
      throw new Error('No tokens available to sell');
    }

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
      amount: actualBalance,
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
        const priceChangePercent = ((exitPriceSOL - trade.entryPriceSOL) / trade.entryPriceSOL) * 100;

        // Only perform notifications and cleanup if this is not a cleanup attempt
        if (!isCleanup) {
          // Prepare notification data with all required fields
          const notificationData = {
            tokenName: trade.tokenName,
            tokenAddress: trade.tokenAddress,
            tradeType: trade.tradeType,
            exitPriceSOL: exitPriceSOL,
            exitPriceUSD: exitPriceUSD,
            sellPercentageGain: priceChangePercent > 0 ? priceChangePercent : null,
            sellPercentageLoss: priceChangePercent <= 0 ? Math.abs(priceChangePercent) : null,
            reason: trade.reason || 'Manual Exit',
            txId: sellResponse.data.txid
          };

          // Send notification before cleanup
          await sendTradeNotification(notificationData, 'SELL');

          // Perform cleanup and archive
          await verifyAndCleanupSale(
            trade,
            trade.tokenAddress, 
            config.cryptoGlobals.publicKey,
            decryptPrivateKey(walletDetails.solPrivateKey)
          );

          await moveTradeToPastTrades(trade, {
            exitPriceSOL,
            exitPriceUSD,
            sellPercentageGain: priceChangePercent > 0 ? priceChangePercent : null,
            sellPercentageLoss: priceChangePercent <= 0 ? Math.abs(priceChangePercent) : null,
            status: 'COMPLETED',
            reason: 'Manual Exit'
          });
        }

        return {
          success: true,
          txId: sellResponse.data.txId,
          exitPriceSOL,
          exitPriceUSD,
          priceChangePercent
        };
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
