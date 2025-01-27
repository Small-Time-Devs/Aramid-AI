import { TwitterApi } from 'twitter-api-v2';
import { fetchLatestTokenProfiles, fetchTokenName, fetchTokenPrice, fetchTokenPairs, fetchTokenOrders } from './apiUtils.mjs';
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
    const tokenProfiles = await fetchLatestTokenProfiles();
    const contractAddresses = config.twitter.solanaProjectsToReveiw?.contractAddresses ? Object.values(config.twitter.solanaProjectsToReveiw.contractAddresses) : [];
    const useConfigAddress = Math.random() < (config.twitter.solanaProjectsToReveiw.percentageToTalkAbout.chance / 100); // Use percentage chance
  
    if (useConfigAddress && contractAddresses.length > 0) {
      const randomAddress = contractAddresses[Math.floor(Math.random() * contractAddresses.length)];
      console.log("Fetching token data for:", randomAddress);
  
      try {
        const tokenName = await fetchTokenName(randomAddress) || "Unnamed Token";
        const tokenPrice = await fetchTokenPrice(randomAddress);
        const tokenPairs = await fetchTokenPairs('solana', randomAddress);
        const tokenOrders = await fetchTokenOrders('solana', randomAddress);
  
        return {
          tokenName,
          tokenDescription: "No description available",
          tokenAddress: randomAddress,
          tokenPrice,
          tokenPairs,
          tokenOrders,
          links: []
        };
      } catch (error) {
        console.warn(`Error fetching data for ${randomAddress}:`, error);
      }
    }
  
    for (const randomToken of tokenProfiles) {
      const tokenDescription = randomToken.description || "No description available";
      const tokenAddress = randomToken.tokenAddress;
      console.log("Fetching token data for:", tokenAddress);
      try {
        const tokenName = await fetchTokenName(tokenAddress) || randomToken.name || randomToken.symbol || "Unnamed Token"; // Ensure token name is correctly extracted
        const tokenPrice = await fetchTokenPrice(tokenAddress);
        return {
          tokenName,
          tokenDescription,
          tokenAddress,
          tokenPrice,
          links: randomToken.links
        };
      } catch (error) {
        console.warn(`Error fetching data for ${tokenAddress}:`, error);
        // Continue to the next token if the name or price is not found
      }
    }
    throw new Error('No valid token data found.');
  }