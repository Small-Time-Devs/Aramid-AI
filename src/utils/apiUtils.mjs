import axios from 'axios';
import { config } from '../config/config.mjs';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

export async function fetchNewJupTokens() {
  try {
    const response = await axios.get(config.apis.crypto.latestJupTokens);
    return response.data;
  } catch (error) {
    console.error('Error fetching new Jupiter tokens:', error);
    throw new Error('Failed to fetch new Jupiter tokens.');
  }
}

export async function fetchLatestTokenProfiles() {
  try {
    const response = await axios.get(config.apis.crypto.dexscreenerTokneProfilesUrl);
    return response.data;
  } catch (error) {
    console.error('Error fetching latest token profiles:', error);
    throw new Error('Failed to fetch latest token profiles.');
  }
}

export async function fetchLatestBoostedTokens() {
  try {
    const response = await axios.get(config.apis.crypto.dexscreenerTopBoostedUrl);
    return response.data;
  } catch (error) {
    console.error('Error fetching latest boosted tokens:', error);
    throw new Error('Failed to fetch latest boosted tokens.');
  }
}

export async function fetchLatestJupTokens() {
  try {
    const response = await axios.get(config.apis.crypto.latestJupTokens);
    return response.data;
  } catch (error) {
    console.error('Error fetching latest boosted tokens:', error);
    throw new Error('Failed to fetch latest boosted tokens.');
  }
}

// Step 1 - Fetch Token Name and Symbol
export async function fetchTokenNameAndSymbol(contractAddress) {
  try {
      const response = await axios.get(`${config.apis.crypto.raydiumMintIds}${contractAddress}`);
      if (response.data && response.data.success && response.data.data.length > 0) {
          return {
              tokenName: response.data.data[0].name,
              tokenSymbol: response.data.data[0].symbol,
              decimals: response.data.data[0].decimals,
          };
      }
  } catch (error) {
      console.error(`Error fetching token name for contract address ${contractAddress}`);
  }
}

export async function fetchTokenPriceUSD(contractAddress) {
  try {
      const response = await axios.get(`${config.apis.crypto.raydiumMintPrice}${contractAddress}`);
      if (response.data && response.data.success && response.data.data[contractAddress]) {
          return response.data.data[contractAddress];
      }
  } catch (error) {
      console.error(`Error fetching token price for contract address ${contractAddress}`);
  }
}

export async function fetchTokenPairs(tokenAddress) {
  try {
    const response = await axios.get(`https://api.dexscreener.com/token-pairs/v1/solana/${tokenAddress}`);
    const tokenPairs = response.data;

    // Filter to exclude the dexID passed and the quote token symbol
    let filteredPair = null;
    if (config.cryptoGlobals.useDexScreenerLatestTokens || config.cryptoGlobals.useDexScreenerTopBoosted) {
      filteredPair = tokenPairs.find(pair => pair.dexId == 'raydium' && pair.quoteToken.symbol == 'SOL');
    }else if (config.cryptoGlobals.useJupNewTokens) {
      filteredPair = tokenPairs.find(pair => pair.dexId == 'raydium' || pair.dexId == 'pumpfun' && pair.quoteToken.symbol == 'SOL');
    }

    if (!filteredPair) {
      throw new Error("No valid token pairs found");
    }

    // Extract required values
    const result = {
      tokenName: filteredPair.baseToken.name,
      tokenSymbol: filteredPair.baseToken.symbol,

      priceNative: filteredPair.priceNative, // SOL price
      priceUsd: filteredPair.priceUsd, // USD price

    };

    return result;
  } catch (error) {
    console.error(`Error fetching token pairs for ${tokenAddress}`, error);
    throw new Error(`Failed to fetch token pairs for ${tokenAddress}`);
  }
}
//chainID, tokenAddress, entryPrice, targetGain, targetLoss
export async function autoTradingAdvice(chainId, tokenAddress, entryPrice, targetGain, targetLoss) {
  try {
    const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/autoTrading-agent-advice', { chain: chainId, contractAddress: tokenAddress, entryPriceSOL: entryPrice, targetPercentageGain: targetGain, targetPercentageLoss: targetLoss });
    if (config.cryptoGlobals.tradeTokenDevMode) {
      console.log("Received response from external API:", response.data);
    }
    return response.data.agents;
  } catch (error) {
    console.error("Error connecting to external API:", error.response ? error.response.data : error.message);
    throw new Error("Failed to connect to external API.");
  }
}