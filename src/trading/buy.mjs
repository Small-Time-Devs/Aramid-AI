import axios from 'axios';
import { getWalletDetails, storeTradeInfo, findActiveTradeByToken, updateTradeAmounts } from '../db/dynamo.mjs';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { startPriceMonitoring } from './pnl.mjs';
import { config } from '../config/config.mjs';

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

// Renamed to be more generic since it's used by both tweet and background trades
async function executeBuyOrder(data, targetGain, targetLoss, tradeType) {
  console.log('Starting buy execution with parameters:', {
    token: data.tokenData.tokenName,
    address: data.tokenData.tokenAddress,
    targetGain,
    targetLoss,
    priceInSol: data.tokenData.tokenPriceInSol
  });

  try {
    // Get wallet details from DynamoDB
    const walletDetails = await getWalletDetails();
    
    if (!walletDetails || !walletDetails.solPrivateKey) {
      throw new Error('Wallet details not found or private key missing');
    }

    // Decrypt the private key before using it
    const decryptedPrivateKey = decryptPrivateKey(walletDetails.solPrivateKey);
    console.log('Private key decrypted successfully');

    // Prepare buy request with decrypted private key
    const buyRequest = {
      private_key: decryptedPrivateKey, // Using decrypted private key
      public_key: walletDetails.solPublicKey,
      mint: data.tokenData.tokenAddress,
      amount: config.cryptoGlobals.investmentAmountInSol, // Default investment amount in SOL
      referralPublicKey: config.cryptoGlobals.referralPublicKey,
      priorityFee: config.cryptoGlobals.priorityFee, // Default priority fee
      slippage: config.cryptoGlobals.buySlippage, // 5% slippage
      useJito: config.cryptoGlobals.useJito,
    };

    // Execute buy order
    const buyResponse = await axios.post('https://api.smalltimedevs.com/solana/raydium-api/aramidBuy', buyRequest);

    if (buyResponse.data.success) {
      const tokensPurchased = parseFloat(buyResponse.data.tokensPurchased);
      const amountInvested = parseFloat(buyRequest.amount);

      // For existing trades
      if (data.existingTradeId) {
        const updatedTrade = await updateTradeAmounts(
          data.existingTradeId,
          amountInvested,
          tokensPurchased
        );

        return {
          success: true,
          tradeId: data.existingTradeId,
          txId: buyResponse.data.txid,
          amountInvested,
          tokensReceived: tokensPurchased
        };
      }

      // For new trades
      const tradeId = await storeTradeInfo({
        tokenName: data.tokenData.tokenName,
        tokenAddress: data.tokenData.tokenAddress,
        amountInvested,
        entryPriceSOL: data.tokenData.tokenPriceInSol,
        entryPriceUSD: data.tokenData.tokenPriceInUSD,
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
        tokensReceived: tokensPurchased
      };
    }
    
    return { success: false, error: 'Buy order failed' };
  } catch (error) {
    console.error('Error executing buy:', error);
    return { success: false, error: error.message };
  }
}