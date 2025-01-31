import { TwitterApi } from 'twitter-api-v2';
import { fetchLatestTokenProfiles, fetchLatestBoostedTokens, fetchTokenNameAndSymbol, fetchTokenPrice, fetchTokenPairs, fetchTokenOrders, fetchPoolInfo, checkTokenAuthority, fetchMeteoraPairs } from './apiUtils.mjs';
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
    if (config.twitter.settings.devMode || config.cryptoGlobals.tradeTokenDevMode) {
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
      const checkIfSafe = await checkTokenAuthority(tokenAddress);
      if (config.twitter.settings.devMode || config.cryptoGlobals.tradeTokenDevMode) {
        console.log('Check if token is safe:', checkIfSafe); 
      }
 

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
      const tokenSafe = checkIfSafe.safe;
      const tokenFreezeAuthority = checkIfSafe.freezeAuthority;
      const tokenMintAuthority = checkIfSafe.mintAuthority;

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

export async function fetchMeteoraTokenData() {
  try {
    const pairs = await fetchMeteoraPairs();
    
    // Filter pairs where mint_y is SOL
    const solPairs = pairs.filter(pair => 
      pair.mint_y === 'So11111111111111111111111111111111111111112'
    );

    if (solPairs.length === 0) {
      throw new Error('No SOL pairs found');
    }

    // Select random SOL pair and log it for debugging
    const randomPair = solPairs[Math.floor(Math.random() * solPairs.length)];
    const tokenPairData = await fetchTokenPairs('solana', randomPair.mint_x);
    const checkIfSafe = await checkTokenAuthority(randomPair.mint_x);
    if (config.twitter.settings.devMode || config.cryptoGlobals.tradeTokenDevMode) {
      console.log('Random SOL pair:', randomPair);
      console.log('Token pair data:', tokenPairData);
      console.log('Check if token is safe:', checkIfSafe);
    }

    if (!tokenPairData) {
      throw new Error('Failed to fetch token pair data from DexScreener');
    }

    // Extract social links and website from token pair info
    const websiteUrl = tokenPairData.info?.websites?.[0]?.url || "No Website URL found";
    const twitterUrl = tokenPairData.info?.socials?.find(s => s.type === 'twitter')?.url || "No Twitter URL found";

    // Format the data combining both Meteora and token pair data
    const meteoraData = {
      dateCreated: new Date(tokenPairData.timeCreated).toUTCString(),
      tokenName: tokenPairData.tokenName,  // Use DexScreener token name
      tokenSymbol: tokenPairData.tokenSymbol, // Use DexScreener token symbol
      tokenDescription: `${tokenPairData.tokenName} (${tokenPairData.tokenSymbol}) Meteora liquidity pool pair`, 
      tokenAddress: randomPair.mint_x,
      tokenTwitterURL: twitterUrl,
      tokenWebsiteURL: websiteUrl,
      tokenPriceInSol: randomPair.current_price,
      tokenPriceInUSD: tokenPairData.priceUsd,
      tokenVolume24h: randomPair.trade_volume_24h,
      tokenPriceChange5m: tokenPairData.priceChange5m || 0,
      tokenPriceChange1h: tokenPairData.priceChange1h || 0,
      tokenPriceChange6h: tokenPairData.priceChange6h || 0,
      tokenPriceChange24h: tokenPairData.priceChange24h || 0,
      tokenLiquidityUSD: parseFloat(randomPair.liquidity),
      tokenLiquidityBase: randomPair.reserve_x_amount,
      tokenLiquidityQuote: randomPair.reserve_y_amount,
      tokenFDV: tokenPairData.fdv || 0,
      tokenMarketCap: tokenPairData.marketCap || 0,
      tokenSafe: checkIfSafe.safe,
      tokenFreezeAuthority: checkIfSafe.hasFreeze,
      tokenMintAuthority: checkIfSafe.hasMint,
      
      // Additional Meteora-specific data
      meteoraSpecific: {
        pairAddress: randomPair.address,
        binStep: randomPair.bin_step,
        baseFeePercent: randomPair.base_fee_percentage,
        maxFeePercent: randomPair.max_fee_percentage,
        protocolFeePercent: randomPair.protocol_fee_percentage,
        fees24h: randomPair.fees_24h,
        todayFees: randomPair.today_fees,
        apr: randomPair.apr,
        apy: randomPair.apy,
        farmApr: randomPair.farm_apr,
        farmApy: randomPair.farm_apy
      }
    };

    return meteoraData;

  } catch (error) {
    console.error('Error fetching Meteora token data:', error);
    throw new Error('Failed to fetch Meteora token information');
  }
}

export async function fetchBoostedTokenData() {
  try {
    const tokenProfiles = await fetchLatestBoostedTokens();
    
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
    if (config.twitter.settings.devMode || config.cryptoGlobals.tradeTokenDevMode) {
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
      const checkIfSafe = await checkTokenAuthority(tokenAddress);
      if (config.twitter.settings.devMode || config.cryptoGlobals.tradeTokenDevMode) {
        console.log('Check if token is safe:', checkIfSafe); 
      }
 

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
      const tokenSafe = checkIfSafe.safe;
      const tokenFreezeAuthority = checkIfSafe.freezeAuthority;
      const tokenMintAuthority = checkIfSafe.mintAuthority;

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