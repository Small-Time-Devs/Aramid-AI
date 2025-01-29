import axios from 'axios';
import { getWalletDetails, storeTradeInfo } from '../db/dynamo.mjs';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { startPriceMonitoring } from './pnl.mjs';
import { config } from '../config/config.mjs';

export async function executeTradeBuy(tweetData, targetGain, targetLoss) {
  console.log('Starting buy execution with parameters:', {
    token: tweetData.tokenData.tokenName,
    address: tweetData.tokenData.tokenAddress,
    targetGain,
    targetLoss,
    priceInSol: tweetData.tokenData.tokenPriceInSol
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
      mint: tweetData.tokenData.tokenAddress,
      amount: config.cryptoGlobals.investmentAmountInSol, // Default investment amount in SOL
      referralPublicKey: config.cryptoGlobals.referralPublicKey,
      priorityFee: config.cryptoGlobals.priorityFee, // Default priority fee
      slippage: config.cryptoGlobals.buySlippage, // 5% slippage
      useJito: config.cryptoGlobals.useJito,
    };

    // Execute buy order
    const buyResponse = await axios.post('https://api.smalltimedevs.com/solana/raydium-api/aramidBuy', buyRequest);

    if (buyResponse.data.success) {
      // Store trade information
      const tradeId = await storeTradeInfo({
        tokenName: tweetData.tokenData.tokenName,
        tokenAddress: tweetData.tokenData.tokenAddress,
        amountInvested: buyRequest.amount,
        entryPriceSOL: tweetData.tokenData.tokenPriceInSol,
        entryPriceUSD: tweetData.tokenData.tokenPriceInUSD,
        targetPercentageGain: targetGain,
        targetPercentageLoss: targetLoss,
        tokensReceived: buyResponse.data.tokensPurchased, // Store tokens received
      });

      // Start monitoring price for this trade
      startPriceMonitoring(tradeId);
      
      return { 
        success: true, 
        tradeId,
        txId: buyResponse.data.txid // Add transaction ID to response
      };
    }
    
    return { success: false, error: 'Buy order failed' };
  } catch (error) {
    console.error('Error executing buy:', error);
    return { success: false, error: error.message };
  }
}
