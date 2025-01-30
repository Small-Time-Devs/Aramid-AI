import axios from 'axios';
import { getWalletDetails, updateTradeWithSellInfo } from '../db/dynamo.mjs';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { fetchTokenPairs } from '../utils/apiUtils.mjs';
import { config } from '../config/config.mjs';

export async function executeTradeSell(trade, currentPrice) {
  try {
    // Get wallet details from DynamoDB
    const walletDetails = await getWalletDetails(config.twitter.botUserId);
    
    if (!walletDetails || !walletDetails.solPrivateKey) {
      throw new Error('Wallet details not found or private key missing');
    }

    // Calculate sell amount (slightly less than total to ensure success)
    const sellAmount = Math.max(0, trade.tokensReceived - 0.001);
    
    // Log the token balance before attempting sell
    console.log('Attempting to sell:', {
      tokenAddress: trade.tokenAddress,
      amount: sellAmount,
      currentPrice,
      tradeType: trade.tradeType
    });

    const sellRequest = {
      private_key: decryptPrivateKey(walletDetails.solPrivateKey),
      public_key: walletDetails.solPublicKey,
      mint: trade.tokenAddress,
      amount: sellAmount,
      referralPublicKey: config.cryptoGlobals.referralPublicKey,
      priorityFee: config.cryptoGlobals.priorityFee,
      slippage: config.cryptoGlobals.sellSlippage,
      useJito: config.cryptoGlobals.useJito
    };

    try {
      const sellResponse = await axios.post(
        'https://api.smalltimedevs.com/solana/raydium-api/aramidSell', 
        sellRequest,
        { timeout: 30000 } // Add 30s timeout
      );

      // Log successful response
      console.log('Sell response:', {
        success: sellResponse.data.success,
        txId: sellResponse.data.txid,
      });

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
