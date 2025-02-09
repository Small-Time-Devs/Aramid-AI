import axios from 'axios';
import { getWalletDetails, updateTradeWithSellInfo } from '../db/dynamo.mjs';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { fetchTokenPairs } from '../utils/apiUtils.mjs';
import { config } from '../config/config.mjs';
import { checkTokenBalance } from '../utils/solanaUtils.mjs';

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

export async function executeTradeSell(trade, currentPrice) {
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

    // Calculate sell amount based on actual token balance
    const sellAmount = Math.min(trade.tokensReceived, tokenBalance);
    
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
