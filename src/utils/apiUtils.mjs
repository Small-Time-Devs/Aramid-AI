import axios from 'axios';
import { config } from '../config/config.mjs';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

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

export async function fetchTokenNameAndSymbol(contractAddress) {
    try {
        const response = await axios.get(`${config.apis.crypto.raydiumMintIds}${contractAddress}`);
        if (response.data && response.data.success && response.data.data.length > 0) {
            return {
                tokenName: response.data.data[0].name,
                tokenSymbol: response.data.data[0].symbol,
            };
        }
    } catch (error) {
        console.error(`Error fetching token name for contract address ${contractAddress}`);
    }
}

export async function fetchTokenPrice(contractAddress) {
    try {
        const response = await axios.get(`${config.apis.crypto.raydiumMintPrice}${contractAddress}`);
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
    const tokenPairs = response.data;

    // Filter to exclude the "pumpfun" dexId and take the first valid pair
    const filteredPair = tokenPairs.find(pair => pair.dexId !== "pumpfun");

    if (!filteredPair) {
      throw new Error("No valid token pairs found");
    }

    // Extract required values
    const result = {
      tokenName: filteredPair.baseToken.name,
      tokenSymbol: filteredPair.baseToken.symbol,
      priceNative: filteredPair.priceNative,
      priceUsd: filteredPair.priceUsd,
      txns24h: filteredPair.txns.h24,
      volume24h: filteredPair.volume.h24,
      priceChange5m: filteredPair.priceChange.m5,
      priceChange1h: filteredPair.priceChange.h1,
      priceChange6h: filteredPair.priceChange.h6,
      priceChange24h: filteredPair.priceChange.h24,
      liquidityUsd: filteredPair.liquidity.usd,
      liquidityBase: filteredPair.liquidity.base,
      liquidityQuote: filteredPair.liquidity.quote,
      fdv: filteredPair.fdv,
      marketCap: filteredPair.marketCap,
      timeCreated: filteredPair.pairCreatedAt,
    };

    return result;
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

export async function fetchPoolInfo(contractAddress) {
  try {
    const mint1 = 'So11111111111111111111111111111111111111112'; // Default SOL mint address
    const url = `${globalURLS.raydiumMintAPI}?mint1=${mint1}&mint2=${contractAddress}&poolType=all&poolSortField=default&sortType=desc&pageSize=1&page=1`;

    console.log(`Fetching token details from: ${url}`);

    const response = await axios.get(url);
    if (config.twitter.settings.devMode) {
      console.log('Full response from Raydium API:', JSON.stringify(response.data, null, 2));
    }

    if (response.status === 200 && response.data?.data?.data?.length > 0) {
      return response.data.data.data[0]; // Adjusted to match nested data structure
    }

    console.error(`Token details not found for mint address: ${contractAddress}`);
    return null;
  } catch (error) {
    console.error(`Error fetching token details for ${contractAddress}:`, error.message);
    return null;
  }
}

export async function checkTokenAuthority(mintAddress) {
  try {
    const connection = new Connection(config.cryptoGlobals.rpcNode);
    const mintPublicKey = new PublicKey(mintAddress);
    
    const mintInfo = await getMint(connection, mintPublicKey);
    
    const hasFreeze = mintInfo.freezeAuthority !== null;
    const hasMint = mintInfo.mintAuthority !== null;
    
    return {
      safe: !hasFreeze && !hasMint,
      hasFreeze,
      hasMint,
      decimals: mintInfo.decimals,
    };
  } catch (error) {
    console.error('Error checking token authority:', error);
    throw error;
  }
}

export async function fetchMeteoraPoolInfo() {
  try {
    const response = await axios.get('https://dlmm-api.meteora.ag/pair/all_with_pagination?limit=200&order_by=desc&hide_low_tvl=300000');
    
    if (!response.data || !response.data.pairs) {
      throw new Error('Invalid response from Meteora API');
    }

    return response.data.pairs.map(pair => ({
      poolAddress: pair.address,
      poolName: pair.name,
      tokenXMint: pair.mint_x,
      tokenYMint: pair.mint_y,
      tokenXReserveAddress: pair.reserve_x,
      tokenYReserveAddress: pair.reserve_y,
      tokenXReserveAmount: pair.reserve_x_amount,
      tokenYReserveAmount: pair.reserve_y_amount,
      binStep: pair.bin_step,
      baseFeePercent: pair.base_fee_percentage,
      maxFeePercent: pair.max_fee_percentage,
      protocolFeePercent: pair.protocol_fee_percentage,
      liquidity: pair.liquidity,
      rewardTokenXMint: pair.reward_mint_x,
      rewardTokenYMint: pair.reward_mint_y,
      fees24h: pair.fees_24h,
      todayFees: pair.today_fees,
      volume24h: pair.trade_volume_24h, 
      cumulativeVolume: pair.cumulative_trade_volume,
      cumulativeFees: pair.cumulative_fee_volume,
      currentPrice: pair.current_price,
      apr: pair.apr,
      apy: pair.apy,
      farmApr: pair.farm_apr,
      farmApy: pair.farm_apy,
      isHidden: pair.hide
    }));

  } catch (error) {
    console.error('Error fetching Meteora pool info:', error);
    throw new Error('Failed to fetch Meteora pool information');
  }
}

// Add helper function to get specific pool info
export async function getMeteoraPoolByAddress(poolAddress) {
  try {
    const pools = await fetchMeteoraPoolInfo();
    return pools.find(pool => pool.poolAddress === poolAddress);
  } catch (error) {
    console.error(`Error getting Meteora pool ${poolAddress}:`, error);
    throw error;
  }
}