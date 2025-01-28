import axios from 'axios';
import { getWalletDetails, updateTradeWithSellInfo } from '../db/dynamo.mjs';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { fetchTokenPairs } from '../utils/apiUtils.mjs';

export async function executeTradeSell(trade, currentPrice) {
  try {
    // Get wallet details from DynamoDB
    const walletDetails = await getWalletDetails(config.twitter.botUserId);
    
    if (!walletDetails || !walletDetails.solPrivateKey) {
      throw new Error('Wallet details not found or private key missing');
    }

    // Decrypt the private key before using it
    const decryptedPrivateKey = decryptPrivateKey(walletDetails.solPrivateKey);
    console.log('Private key decrypted successfully');

    const sellRequest = {
      private_key: decryptedPrivateKey, // Using decrypted private key
      public_key: walletDetails.solPublicKey,
      mint: trade.tokenAddress,
      priorityFee: 5000,
      slippage: 100,
      useJito: true
    };

    const sellResponse = await axios.post('https://api.smalltimedevs.com/solana/raydium-api/aramidSell', sellRequest);

    if (sellResponse.data.success) {
      const priceChangePercent = ((currentPrice - trade.entryPriceSOL) / trade.entryPriceSOL) * 100;
      
      // Get current token data for USD price
      const tokenData = await fetchTokenPairs('solana', trade.tokenAddress);
      if (!tokenData) {
        throw new Error('Failed to fetch token price data');
      }

      await updateTradeWithSellInfo(trade.tradeId, {
        exitPriceSOL: currentPrice,
        exitPriceUSD: tokenData.priceUsd, // Use price from fetchTokenPairs
        sellPercentageGain: priceChangePercent > 0 ? priceChangePercent : 0,
        sellPercentageLoss: priceChangePercent < 0 ? Math.abs(priceChangePercent) : 0
      });

      return { success: true, priceChangePercent };
    }

    return { success: false, error: 'Sell order failed' };
  } catch (error) {
    console.error('Error executing sell:', error);
    return { success: false, error: error.message };
  }
}
