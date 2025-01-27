import axios from 'axios';
import { config } from '../config/config.mjs';

export async function fetchCryptoData(cryptoName) {
    try {
        const response = await axios.get(`${config.apis.crypto.coinGecko}${cryptoName}`);
        if (!response.data[cryptoName]) {
            throw new Error(`No data found for ${cryptoName}`);
        }
        return response.data;
    } catch (error) {
        console.error('Error fetching crypto data:', error);
        console.error(`Failed to fetch data for ${cryptoName}.`);
    }
}

export async function fetchWeatherData() {
    try {
        const response = await axios.get(config.apis.weather.openWeatherMap);
        return response.data;
    } catch (error) {
        console.error('Error fetching weather data:', error);
        throw new Error('Failed to fetch weather data.');
    }
}

export async function fetchCryptoMarketData() {
    try {
        const response = await axios.get(`${config.apis.crypto.coinGecko}/coins/markets`, {
            params: {
                vs_currency: 'usd',
                order: 'market_cap_desc',
                per_page: 10,
                page: 1,
                sparkline: false,
            },
        });

        if (response.data && response.data.length > 0) {
            return response.data;
        }
        return [];
    } catch (error) {
        console.error('Error fetching crypto market data:', error);
        return [];
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

export async function fetchTokenName(contractAddress) {
    try {
        const response = await axios.get(`${config.apis.crypto.raydiumTokenNameUrl}${contractAddress}`);
        if (response.data && response.data.success && response.data.data.length > 0) {
            return response.data.data[0].name;
        }
    } catch (error) {
        console.error(`Error fetching token name for contract address ${contractAddress}`);
    }
}

export async function fetchTokenPrice(contractAddress) {
    try {
        const response = await axios.get(`${config.apis.crypto.raydiumTokenPriceUrl}${contractAddress}`);
        if (response.data && response.data.success && response.data.data[contractAddress]) {
            return response.data.data[contractAddress];
        }
    } catch (error) {
        console.error(`Error fetching token price for contract address ${contractAddress}`);
    }
}

export async function fetchTokenPairs(chainId, tokenAddress) {
  try {
    const response = await axios.get(`https://api.dexscreener.com/token-pairs/v1/${chainId}/${tokenAddress}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching token pairs for ${tokenAddress} on ${chainId}:`, error);
    throw new Error(`Failed to fetch token pairs for ${tokenAddress} on ${chainId}.`);
  }
}

export async function fetchTokenOrders(chainId, tokenAddress) {
  try {
    const response = await axios.get(`https://api.dexscreener.com/orders/v1/${chainId}/${tokenAddress}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching token orders for ${tokenAddress} on ${chainId}:`, error);
    throw new Error(`Failed to fetch token orders for ${tokenAddress} on ${chainId}.`);
  }
}
