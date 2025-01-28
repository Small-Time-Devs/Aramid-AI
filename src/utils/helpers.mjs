import { TwitterApi } from 'twitter-api-v2';
import { fetchLatestTokenProfiles, fetchTokenNameAndSymbol, fetchTokenPrice, fetchTokenPairs, fetchTokenOrders, fetchPoolInfo } from './apiUtils.mjs';
import { config } from '../config/config.mjs';

let rateLimitRemaining = null;
let rateLimitResetTime = null;
let userLimitResetTime = null;

export async function checkRateLimit(client) {
  try {
    const currentTime = Math.floor(Date.now() / 1000); // Current time in Unix timestamp

    if (rateLimitRemaining !== null && rateLimitResetTime !== null && userLimitResetTime !== null) {
      if (rateLimitRemaining > 0 && currentTime >= rateLimitResetTime && currentTime >= userLimitResetTime) {
        return true;
      } else {
        const waitTime = Math.max(rateLimitResetTime, userLimitResetTime) - currentTime;
        console.log(`Rate limit reached. Waiting for ${waitTime} seconds.`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        return false;
      }
    }

    const rateLimitStatus = await client.v2.get('application/rate_limit_status', { resources: 'statuses' });
    const rateLimit = rateLimitStatus.resources.statuses['/statuses/update'];
    rateLimitRemaining = rateLimit?.remaining ?? 1; // Default to 1 if undefined
    rateLimitResetTime = rateLimit?.reset ? rateLimit.reset : currentTime + 15 * 60; // Default to 15 minutes from now

    return rateLimitRemaining > 0;
  } catch (error) {
    if (error.code === 404) {
      console.warn('Rate limit data not found, assuming rate limit is not reached.');
      return true;
    } else {
      console.error('Error checking rate limit:', error);
      throw new Error('Failed to check rate limit.');
    }
  }
}

export function updateRateLimitInfo(headers) {
  if (!headers) {
    console.warn('No headers provided to update rate limit info. Assuming no active rate limit.');
    rateLimitRemaining = null;
    rateLimitResetTime = null;
    userLimitResetTime = null;
    return;
  }
  console.log('Rate limit headers:', headers); // Log headers for debugging
  if (headers['x-rate-limit-remaining'] !== undefined) {
    rateLimitRemaining = parseInt(headers['x-rate-limit-remaining'], 10);
  }
  if (headers['x-rate-limit-reset'] !== undefined) {
    rateLimitResetTime = parseInt(headers['x-rate-limit-reset'], 10);
  }
  if (headers['x-user-limit-24hour-reset'] !== undefined) {
    userLimitResetTime = parseInt(headers['x-user-limit-24hour-reset'], 10);
  }
}

export async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 10000 } = options; // Set default timeout to 10 seconds
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
        ...options,
        signal: controller.signal,
    });
    clearTimeout(id);
    return response;
}

export async function fetchTokenData() {
  try {
    const tokenProfiles = await fetchLatestTokenProfiles();
    
    // Filter for Solana tokens only
    const validTokens = tokenProfiles.filter(token => 
      token.tokenAddress && 
      token.chainId === "solana" && // Only Solana tokens
      token.description &&
      token.links
    );

    if (validTokens.length === 0) {
      console.error('No valid Solana tokens found in response going to call fetTokenData again to check if its a fluke!');
    }

    // Select a random Solana token
    const randomToken = validTokens[Math.floor(Math.random() * validTokens.length)];
    if (config.twitter.settings.devMode) {
      console.log('Random Solana token picked information:', randomToken);
    }

    // Improve social link checks
    const tokenTwitterURL = randomToken.links?.find(link => 
      link.type === 'twitter' || 
      (link.url && link.url.toLowerCase().includes('twitter'))
    )?.url || "No Twitter Account On DexScreener Token Profile";

    const tokenWebsiteURL = randomToken.links?.find(link => 
      link.label === 'Website' || 
      (link.url && link.url.toLowerCase().includes('website'))
    )?.url || "No Website On DexScreener Token Profile";

    const tokenDescription = randomToken.description;
    const tokenAddress = randomToken.tokenAddress;

    // Move on to gather more information about the token like the name
    try {
      const tokenPairInfo = await fetchTokenPairs('solana', tokenAddress) || "Raydium API Cant Find Token Volume";
      /*
      Example returned value
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
      marketCap: filteredPair.marketCap
    };

    return result;
      */

      const tokenName = tokenPairInfo.tokenName;
      const tokenSymbol = tokenPairInfo.tokenSymbol;
      const tokenPriceInSol = tokenPairInfo.priceNative;
      const tokenPriceInUSD = tokenPairInfo.priceUsd;
      const tokenVolume24h = tokenPairInfo.volume24h;
      const tokenPriceChange5m = tokenPairInfo.priceChange5m;
      const tokenPriceChange1h = tokenPairInfo.priceChange1h;
      const tokenPriceChange6h = tokenPairInfo.priceChange6h;
      const tokenPriceChange24h = tokenPairInfo.priceChange24h;
      const tokenLiquidityUSD = tokenPairInfo.liquidityUsd;
      const tokenLiquidityBase = tokenPairInfo.liquidityBase;
      const tokenLiquidityQuote = tokenPairInfo.liquidityQuote;
      const tokenFDV = tokenPairInfo.fdv;
      const tokenMarketCap = tokenPairInfo.marketCap;
      const unixTimeCreated = tokenPairInfo.timeCreated;

      // Convert Unix timestamp to human-readable date
      const dateCreated = new Date(unixTimeCreated * 1000).toUTCString();
      
      if (config.twitter.settings.devMode) {
        console.log('-----------------------------------------------------------------');
        console.log('---------------------------DEV DEBUG LOG-------------------------');
        console.log('Date Created:', dateCreated);
        console.log('Token Name:', tokenName);
        console.log('Token Symbol:', tokenSymbol);
        console.log('Token Description:', tokenDescription);
        console.log('Token Address:', tokenAddress);
        console.log('Token Twitter URL:', tokenTwitterURL);
        console.log('Token Website URL:', tokenWebsiteURL);
        console.log('-----------------------------------------------------------------');
        console.log('Token Price In Sol:', tokenPriceInSol);
        console.log('Token Price In USD:', tokenPriceInUSD);
        console.log('Token Volume 24h:', tokenVolume24h);
        console.log('Token Price Change 5m:', tokenPriceChange5m);
        console.log('Token Price Change 1h:', tokenPriceChange1h);
        console.log('Token Price Change 6h:', tokenPriceChange6h);
        console.log('Token Price Change 24h:', tokenPriceChange24h);
        console.log('Token Liquidity USD:', tokenLiquidityUSD);
        console.log('Token Liquidity Base:', tokenLiquidityBase);
        console.log('Token Liquidity Quote:', tokenLiquidityQuote);
        console.log('Token FDV:', tokenFDV);
        console.log('Token Market Cap:', tokenMarketCap);
        console.log('-----------------------------------------------------------------');
      }

      return {
        dateCreated,
        tokenName: tokenName || "Unnamed Token", // Provide default value
        tokenSymbol: tokenSymbol || "NO_SYMBOL", // Provide default value
        tokenDescription,
        tokenAddress,
        tokenTwitterURL: String(tokenTwitterURL), // Ensure string
        tokenWebsiteURL: String(tokenWebsiteURL), // Ensure string
        tokenPriceInSol: tokenPriceInSol || "No price returned",
        tokenPriceInUSD: tokenPriceInUSD || "No price returned",
        tokenVolume24h: tokenVolume24h || "No volume data",
        tokenPriceChange5m: tokenPriceChange5m || "No data",
        tokenPriceChange1h: tokenPriceChange1h || "No data", 
        tokenPriceChange6h: tokenPriceChange6h || "No data",
        tokenPriceChange24h: tokenPriceChange24h || "No data",
        tokenLiquidityUSD: tokenLiquidityUSD || "No liquidity data",
        tokenLiquidityBase: tokenLiquidityBase || "No data",
        tokenLiquidityQuote: tokenLiquidityQuote || "No data", 
        tokenFDV: tokenFDV || "No FDV data",
        tokenMarketCap: tokenMarketCap || "No market cap data"
      };

    } catch (error) {
      console.error(`Error processing token name, symbol or price data, going to try fetching again`, error);
      await fetchTokenData();
    }
  } catch (error) {
    console.error(`Error processing token data from dexscreener, going to try fetching again`, error);
    await fetchTokenData();
  }
}

export async function getUserIdByUsername(username) {
  const client = new TwitterApi({
    appKey: `${config.twitter.keys.appKey}`,
    appSecret: `${config.twitter.keys.appSecret}`,
    accessToken: `${config.twitter.keys.accessToken}`,
    accessSecret: `${config.twitter.keys.accessSecret}`,
  });

  try {
    // Fetch the user by username
    const user = await client.v2.userByUsername(username);

    if (user && user.data && user.data.id) {
      console.log(`User ID for @${username}:`, user.data.id);
      return user.data.id;
    } else {
      console.log(`No user found with username: @${username}`);
      return null;
    }
  } catch (error) {
    console.error("Error fetching user ID:", error);
    return null;
  }
}