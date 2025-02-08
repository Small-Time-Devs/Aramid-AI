import axios from 'axios';
import { getWalletDetails, storeTradeInfo, findActiveTradeByToken, updateTradeAmounts } from '../db/dynamo.mjs';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { startPriceMonitoring } from './pnl.mjs';
import { config } from '../config/config.mjs';
import { fetchTokenPairs } from '../utils/apiUtils.mjs';

export async function executeTradeBuy(tweetData, targetGain, targetLoss, tradeType) {
  try {
    // Check for existing active trade with same token
    const existingTrade = await findActiveTradeByToken(tweetData.tokenData.tokenAddress);
    
    if (existingTrade) {
      console.log('Found existing active trade for token:', {
        tradeId: existingTrade.tradeId,
        token: existingTrade.tokenName,
        currentAmount: existingTrade.amountInvested
      });

      // Execute new buy order with tweet data
      const buyResult = await executeBuyOrder(tweetData, targetGain, targetLoss, tradeType);
      if (!buyResult.success) {
        return buyResult;
      }

      // Update existing trade with additional amounts
      const updatedTrade = await updateTradeAmounts(
        existingTrade.tradeId, 
        buyResult.amountInvested,
        buyResult.tokensReceived
      );

      console.log('Updated existing trade:', {
        tradeId: existingTrade.tradeId,
        newTotalAmount: updatedTrade.amountInvested,
        newTotalTokens: updatedTrade.tokensReceived
      });

      return {
        success: true,
        tradeId: existingTrade.tradeId,
        txId: buyResult.txId,
        isUpdate: true
      };
    }

    // No existing trade found, proceed with new trade
    return await executeBuyOrder(tweetData, targetGain, targetLoss, tradeType);
  } catch (error) {
    console.error('Error executing buy:', error);
    return { success: false, error: error.message };
  }
}

export async function executeBackgroundTradeBuy(investmentChoice, targetGain, targetLoss, tradeType) {
  try {
    // Check for existing active trade with same token
    const existingTrade = await findActiveTradeByToken(investmentChoice.tokenData.tokenAddress);
    
    if (existingTrade) {
      console.log('Found existing active trade for token:', {
        tradeId: existingTrade.tradeId,
        token: existingTrade.tokenName,
        currentAmount: existingTrade.amountInvested
      });

      // Execute new background buy order
      const buyResult = await executeBuyOrder(investmentChoice, targetGain, targetLoss, tradeType);
      if (!buyResult.success) {
        return buyResult;
      }

      // Update existing trade with additional amounts
      const updatedTrade = await updateTradeAmounts(
        existingTrade.tradeId, 
        buyResult.amountInvested,
        buyResult.tokensReceived
      );

      console.log('Updated existing trade:', {
        tradeId: existingTrade.tradeId,
        newTotalAmount: updatedTrade.amountInvested,
        newTotalTokens: updatedTrade.tokensReceived
      });

      return {
        success: true,
        tradeId: existingTrade.tradeId,
        txId: buyResult.txId,
        isUpdate: true
      };
    }

    // No existing trade found, proceed with new trade
    return await executeBuyOrder(investmentChoice, targetGain, targetLoss, tradeType);
  } catch (error) {
    console.error('Error executing background buy:', error);
    return { success: false, error: error.message };
  }
}

async function retryOperation(operation, maxRetries = 5) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`Attempt ${attempt} failed:`, error.message);
      if (attempt < maxRetries) {
        // Wait for 2 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  throw new Error(`Operation failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
}

// Renamed to be more generic since it's used by both tweet and background trades
async function executeBuyOrder(data, targetGain, targetLoss, tradeType) {
  const currentTokenData = await fetchTokenPairs(data.tokenData.tokenAddress);
  const currentTokenName = currentTokenData.tokenName;
  const currentPriceInSol = currentTokenData.priceNative;
  const currentPriceInUSD = currentTokenData.priceUsd;
  console.log('Starting buy execution with parameters:', {
    token: currentTokenData,
    address: data.tokenData.tokenAddress,
    targetGain,
    targetLoss,
    priceInSol: currentPriceInSol
  });

  try {
    // Check for existing active trade first
    const existingTrade = await findActiveTradeByToken(data.tokenData.tokenAddress);
    
    // Execute buy first before updating any DB records
    const walletDetails = await getWalletDetails();
    if (!walletDetails || !walletDetails.solPrivateKey) {
      throw new Error('Wallet details not found or private key missing');
    }

    const buyRequest = {
      private_key: decryptPrivateKey(walletDetails.solPrivateKey),
      outputMint: data.tokenData.tokenAddress,
      amount: config.cryptoGlobals.investmentAmountInSol,
    };

    // Implement retry logic for the buy operation
    const buyResponse = await retryOperation(async () => {
      const response = await axios.post('https://api.smalltimedevs.com/solana/raydium-api/jupiterBuy', buyRequest);
      if (!response.data.success || !response.data.txid) {
        throw new Error('Buy order failed or no transaction ID received');
      }
      return response;
    });

    const tokensPurchased = parseFloat(buyResponse.data.tokensPurchased);
    const amountInvested = parseFloat(buyRequest.amount);

    // Only proceed with DB updates if we have a successful transaction
    if (existingTrade) {
      console.log('Updating existing trade after successful purchase:', {
        success: true,
        tradeId: existingTrade.tradeId,
        txId: buyResponse.data.txid,
        addingAmount: amountInvested,
        addingTokens: tokensPurchased
      });

      const updatedTrade = await updateTradeAmounts(
        existingTrade.tradeId,
        amountInvested,
        tokensPurchased
      );

      return {
        success: true,
        tradeId: existingTrade.tradeId,
        txId: buyResponse.data.txid,
        amountInvested: updatedTrade.amountInvested,
        tokensReceived: updatedTrade.tokensReceived,
        isUpdate: true
      };
    }

    // Create new trade record only after successful purchase
    const tradeId = await storeTradeInfo({
      tokenName: currentTokenName,
      tokenAddress: data.tokenData.tokenAddress,
      amountInvested,
      entryPriceSOL: currentPriceInSol,
      entryPriceUSD: currentPriceInUSD,
      targetPercentageGain: targetGain,
      targetPercentageLoss: targetLoss,
      tradeType: tradeType,
      tokensReceived: tokensPurchased,
    });

    startPriceMonitoring(tradeId);
    
    return { 
      success: true, 
      tradeId,
      txId: buyResponse.data.txid,
      amountInvested,
      tokensReceived: tokensPurchased,
      isUpdate: false
    };
    
  } catch (error) {
    console.error('Error executing buy:', error);
    return { success: false, error: error.message };
  }
}