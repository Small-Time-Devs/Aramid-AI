import { TwitterApi } from 'twitter-api-v2';
import { fetchLatestTokenProfiles, fetchLatestBoostedTokens, fetchTokenPairs, fetchNewJupTokens } from './apiUtils.mjs';
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

export async function fetchLatestTokenData() {
  try {
    let tokenProfiles = null;
    let validTokens = [];  // Changed from const to let
    
    if (config.cryptoGlobals.useDexScreenerTopBoosted || config.cryptoGlobals.useDexScreenerLatestTokens) {
      tokenProfiles = await fetchLatestTokenProfiles();
      validTokens = tokenProfiles.filter(token => 
        token.tokenAddress && 
        token.chainId === "solana"
      );
    } else if (config.cryptoGlobals.useDexScreenerTopBoosted || config.cryptoGlobals.useDexScreenerTopBoosted) {
      tokenProfiles = await fetchLatestBoostedTokens();
      validTokens = tokenProfiles.filter(token => 
        token.tokenAddress && 
        token.chainId === "solana"
      );
    } else if (config.cryptoGlobals.useJupNewTokens) {
      tokenProfiles = await fetchNewJupTokens();
      const currentTime = Math.floor(Date.now() / 1000); // Current Unix timestamp
      const maxTime = currentTime - config.cryptoGlobals.maxPumpFunTime;
      const minTime = currentTime - config.cryptoGlobals.minPumpFunTime;
      
      validTokens = tokenProfiles.filter(token => 
        token.mint && 
        token.metadata_updated_at && 
        parseInt(token.metadata_updated_at) <= minTime &&
        parseInt(token.metadata_updated_at) >= maxTime
      );

      if (config.cryptoGlobals.tradeTokenDevMode) {
        console.log('-----------------------------------------------------------------');
        console.log('Current time:', new Date(currentTime * 1000).toLocaleString());
        console.log('30 minutes ago:', new Date(maxTime * 1000).toLocaleString());
        console.log('10 minutes ago:', new Date(minTime * 1000).toLocaleString());
        console.log('Number of tokens within time window:', validTokens.length);
        if (validTokens.length > 0) {
          console.log('Sample token time:', new Date(parseInt(validTokens[0].metadata_updated_at) * 1000).toLocaleString());
        }
        console.log('-----------------------------------------------------------------');
      }
    }

    if (validTokens.length === 0) {
      console.error('No valid Solana tokens found in response going to call fetTokenData again to check if its a fluke!');
    }

    const randomToken = validTokens[Math.floor(Math.random() * validTokens.length)];
    if (config.twitter.settings.devMode || config.cryptoGlobals.tradeTokenDevMode) {
      console.log('Random Solana token picked information:', randomToken);
    }
    
    let tokenAddress = null;
    let chainId = null;
    
    if (config.cryptoGlobals.useDexScreenerLatestTokens || config.cryptoGlobals.useDexScreenerTopBoosted) {
      tokenAddress = randomToken.tokenAddress;
      chainId = randomToken.chainId;
    } else if (config.cryptoGlobals.useJupNewTokens) {
      tokenAddress = randomToken.mint;
      chainId = "solana";
    }
    
    const tokenTradeInfo = await fetchTokenPairs(tokenAddress);
    const TokenName = tokenTradeInfo.tokenName;
    const TokenSymbol = tokenTradeInfo.tokenSymbol;
    const TokenPriceUSD = tokenTradeInfo.priceUsd;
    const TokenPriceSOL = tokenTradeInfo.priceNative;

    try {
      
      if (config.twitter.settings.devMode || config.cryptoGlobals.tradeTokenDevMode){
          console.log('-----------------------------------------------------------------');
          console.log('---------------------------DEV DEBUG LOG-------------------------');
          console.log('Token Name:', TokenName);
          console.log('Token Symbol:', TokenSymbol);
          console.log('Chain ID:', chainId);
          console.log('Token Address:', tokenAddress);
          console.log('Token Price USD:', TokenPriceUSD);
          console.log('Token Price SOL:', TokenPriceSOL);
          console.log('-----------------------------------------------------------------');
      }

      return {
        tokenAddress,
        chainId,
        TokenName,
        TokenSymbol,
        TokenPriceUSD,
        TokenPriceSOL
      };

    } catch (error) {
      console.error(`Error processing token name, symbol or price data, going to try fetching again`, error);
      sleep(1000);
      await fetchLatestTokenData();
    }
  } catch (error) {
    console.error(`Error processing token data from dexscreener, going to try fetching again`, error);
    sleep(1000);
    await fetchLatestTokenData();
  }
}

export async function fetchBoostedTokenData() {
  try {
    const tokenProfiles = await fetchLatestBoostedTokens();
    
    // Filter for Solana tokens only
    const validTokens = tokenProfiles.filter(token => 
      token.tokenAddress && 
      token.chainId === "solana"
    );

    if (validTokens.length === 0) {
      console.error('No valid Solana tokens found in response going to call fetTokenData again to check if its a fluke!');
    }

    // Select a random Solana token
    const randomToken = validTokens[Math.floor(Math.random() * validTokens.length)];
    if (config.twitter.settings.devMode || config.cryptoGlobals.tradeTokenDevMode) {
      console.log('Random Solana token picked information:', randomToken);
    }
    const tokenAddress = randomToken.tokenAddress;
    const chainId = randomToken.chainId;

    // Move on to gather more information about the token like the name
    try {
      
      if (config.twitter.settings.devMode) {
        console.log('-----------------------------------------------------------------');
        console.log('---------------------------DEV DEBUG LOG-------------------------');
        console.log('Token Address:', tokenAddress);
        console.log('Chain ID:', chainId);
        console.log('-----------------------------------------------------------------');
      }

      return {
        tokenAddress,
        chainId
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