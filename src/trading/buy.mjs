import axios from 'axios';
import { Connection } from "@solana/web3.js";
import { getWalletDetails, storeTradeInfo, findActiveTradeByToken, updateTradeAmounts } from '../db/dynamo.mjs';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { startPriceMonitoring } from './pnl.mjs';
import { config } from '../config/config.mjs';
import { fetchTokenPairs, fetchTokenNameAndSymbol } from '../utils/apiUtils.mjs';
import { checkSolanaBalance } from '../utils/solanaUtils.mjs';
import { sendTradeNotification } from '../utils/discord.mjs';

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

      // Prepare notification data
      const buyNotificationData = {
        tokenName: tweetData.tokenData.tokenName,
        tokenAddress: tweetData.tokenData.tokenAddress,
        tradeType: tradeType,
        amountInvested: buyResult.amountInvested,
        entryPriceSOL: parseFloat(buyResult.currentPrice),
        tokensReceived: buyResult.tokensReceived,
        targetPercentageGain: targetGain,
        targetPercentageLoss: targetLoss,
        txId: buyResult.txId
      };

      // Send buy notification
      await sendTradeNotification(buyNotificationData, 'BUY');

      return {
        success: true,
        tradeId: existingTrade.tradeId,
        txId: buyResult.txId,
        isUpdate: true
      };
    }

    // No existing trade found, proceed with new trade
    const buyResult = await executeBuyOrder(tweetData, targetGain, targetLoss, tradeType);

    if (buyResult.success) {
      // Prepare notification data
      const buyNotificationData = {
        tokenName: tweetData.tokenData.tokenName,
        tokenAddress: tweetData.tokenData.tokenAddress,
        tradeType: tradeType,
        amountInvested: buyResult.amountInvested,
        entryPriceSOL: parseFloat(buyResult.currentPrice),
        tokensReceived: buyResult.tokensReceived,
        targetPercentageGain: targetGain,
        targetPercentageLoss: targetLoss,
        txId: buyResult.txId
      };

      // Send buy notification
      await sendTradeNotification(buyNotificationData, 'BUY');
    }

    return buyResult;
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

      // Prepare notification data
      const buyNotificationData = {
        tokenName: investmentChoice.tokenData.tokenName,
        tokenAddress: investmentChoice.tokenData.tokenAddress,
        tradeType: tradeType,
        amountInvested: buyResult.amountInvested,
        entryPriceSOL: parseFloat(buyResult.currentPrice),
        tokensReceived: buyResult.tokensReceived,
        targetPercentageGain: targetGain,
        targetPercentageLoss: targetLoss,
        txId: buyResult.txId
      };

      // Send buy notification
      await sendTradeNotification(buyNotificationData, 'BUY');

      return {
        success: true,
        tradeId: existingTrade.tradeId,
        txId: buyResult.txId,
        isUpdate: true
      };
    }

    // No existing trade found, proceed with new trade
    const buyResult = await executeBuyOrder(investmentChoice, targetGain, targetLoss, tradeType);

    if (buyResult.success) {
      // Prepare notification data
      const buyNotificationData = {
        tokenName: investmentChoice.tokenData.tokenName,
        tokenAddress: investmentChoice.tokenData.tokenAddress,
        tradeType: tradeType,
        amountInvested: buyResult.amountInvested,
        entryPriceSOL: parseFloat(buyResult.currentPrice),
        tokensReceived: buyResult.tokensReceived,
        targetPercentageGain: targetGain,
        targetPercentageLoss: targetLoss,
        txId: buyResult.txId
      };

      // Send buy notification
      await sendTradeNotification(buyNotificationData, 'BUY');
    }

    return buyResult;
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

// Add new helper function
async function checkWalletBalanceForTrading(publicKey) {
  try {
    const currentBalance = await checkSolanaBalance(publicKey);
    const investmentAmount = config.cryptoGlobals.investmentAmountInSol;
    const minThreshold = config.cryptoGlobals.walletThreshold;
    
    if (currentBalance < minThreshold) {
      console.log(`Insufficient wallet balance (${currentBalance} SOL) is below minimum threshold of ${minThreshold} SOL`);
      return false;
    }
    
    if ((currentBalance - investmentAmount) < minThreshold) {
      console.log(`Investment of ${investmentAmount} SOL would put wallet balance (${currentBalance} SOL) below threshold (${minThreshold} SOL`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking wallet balance:', error);
    return false;
  }
}

// Renamed to be more generic since it's used by both tweet and background trades
async function executeBuyOrder(data, targetGain, targetLoss, tradeType) {
  try {
    const currentTokenData = await fetchTokenNameAndSymbol(data.tokenData.tokenAddress);
    const currentTokenDataPrices = await fetchTokenPairs(data.tokenData.tokenAddress);
    const currentTokenName = currentTokenData?.tokenName || data.tokenData.tokenName || 'Unknown Token';
    const currentTokenDecimals = currentTokenData?.decimals || 9;
    const currentPriceInSol = currentTokenDataPrices.priceNative;
    const currentPriceInUSD = currentTokenDataPrices.priceUsd;

    console.log('Starting buy execution with parameters:', {
      token: currentTokenName,
      decimals: currentTokenDecimals,
      address: data.tokenData.tokenAddress,
      targetGain,
      targetLoss,
      priceInSol: currentPriceInSol
    });

    // Check for existing active trade first
    const existingTrade = await findActiveTradeByToken(data.tokenData.tokenAddress);
    
    // Get wallet details first
    const walletDetails = await getWalletDetails();
    if (!walletDetails || !walletDetails.solPrivateKey || !walletDetails.solPublicKey) {
      throw new Error('Wallet details not found or keys missing');
    }

    // Add balance check with retry loop
    let hasBalance = false;
    while (!hasBalance) {
      hasBalance = await checkWalletBalanceForTrading(walletDetails.solPublicKey);
      if (!hasBalance) {
        console.log('Insufficient balance, waiting 5 minutes before retrying...');
        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
        continue;
      }
      break;
    }

    // Execute buy first before updating any DB records
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
    const actualPurchaseAmount = parseFloat(tokensPurchased) / Math.pow(10, currentTokenDecimals);

    if (existingTrade) {
      const updatedTrade = await updateTradeAmounts(
        existingTrade.tradeId,
        amountInvested,
        actualPurchaseAmount
      );

      // Ensure token name is included in notification data
      const notificationData = {
        tokenName: currentTokenName,
        tokenAddress: data.tokenData.tokenAddress,
        tradeType: tradeType,
        amountInvested: amountInvested,
        entryPriceSOL: currentPriceInSol,
        tokensReceived: actualPurchaseAmount,
        targetPercentageGain: targetGain,
        targetPercentageLoss: targetLoss,
        txId: buyResponse.data.txid
      };

      await sendTradeNotification(notificationData, 'BUY');

      return {
        success: true,
        tradeId: existingTrade.tradeId,
        txId: buyResponse.data.txid,
        amountInvested: updatedTrade.amountInvested,
        tokensReceived: updatedTrade.tokensReceived,
        currentPrice: currentPriceInSol,
        tokenName: currentTokenName,
        isUpdate: true
      };
    }

    // Create new trade record
    const tradeId = await storeTradeInfo({
      tokenName: currentTokenName,
      tokenAddress: data.tokenData.tokenAddress,
      amountInvested,
      entryPriceSOL: currentPriceInSol,
      entryPriceUSD: currentPriceInUSD,
      targetPercentageGain: targetGain,
      targetPercentageLoss: targetLoss,
      tradeType: tradeType,
      tokensReceived: actualPurchaseAmount,
    });

    // Start monitoring
    startPriceMonitoring(tradeId);

    // Ensure token name is included in notification data for new trades
    const notificationData = {
      tokenName: currentTokenName,
      tokenAddress: data.tokenData.tokenAddress,
      tradeType: tradeType,
      amountInvested: amountInvested,
      entryPriceSOL: currentPriceInSol,
      tokensReceived: actualPurchaseAmount,
      targetPercentageGain: targetGain,
      targetPercentageLoss: targetLoss,
      txId: buyResponse.data.txid
    };

    await sendTradeNotification(notificationData, 'BUY');

    return { 
      success: true, 
      tradeId,
      txId: buyResponse.data.txid,
      amountInvested,
      tokensReceived: actualPurchaseAmount,
      currentPrice: currentPriceInSol,
      tokenName: currentTokenName,
      isUpdate: false
    };
    
  } catch (error) {
    console.error('Error executing buy:', error);
    return { success: false, error: error.message };
  }
}