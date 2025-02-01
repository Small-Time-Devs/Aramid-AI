import axios from 'axios';
import { config } from '../config/config.mjs';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

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
    const filteredPair = tokenPairs.find(pair => pair.dexId == 'raydium' && pair.quoteToken.symbol == 'SOL');

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