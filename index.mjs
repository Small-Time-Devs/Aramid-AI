import * as twitterProfessional from "./src/agents/twitter.mjs";
import * as autoTraderAgent from "./src/agents/autoTrader.mjs";
import { config } from './src/config/config.mjs';
import { checkRateLimit } from './src/utils/helpers.mjs';
import { TwitterApi } from "twitter-api-v2";
import { initializeTradeMonitoring } from './src/trading/pnl.mjs';
import { getActiveTrades } from './src/db/dynamo.mjs';
import { checkSolanaBalance } from './src/utils/solanaUtils.mjs';

async function startAI() {
  try {
    // Initialize trade monitoring for any existing active trades
    await initializeTradeMonitoring();
    
    // Start both auto-posting and auto-trading
    autoPostToTwitter();
    autoTrader();
  } catch (error) {
    console.error('Error starting bot:', error);
  }
}

function autoPostToTwitter() {
  if (!config.twitter.settings.xAutoPoster) {
    console.log('Auto-posting is disabled in config.');
    return;
  }

  const maxPostsPerMonth = config.twitter.settings.postsPerMonth;
  const postsPerDay = config.twitter.settings.postsPerDay;
  const maxPostsPerDay = Math.min(postsPerDay, Math.floor(maxPostsPerMonth / 30));
  const maxTweetsPerDay = Math.floor(maxPostsPerDay / 2); // Each post is 2 tweets (tweet, comment, hashtags)
  const interval = 24 * 60 * 60 * 1000 / maxTweetsPerDay; // Interval in milliseconds

  const client = new TwitterApi({
    appKey: `${config.twitter.keys.appKey}`,
    appSecret: `${config.twitter.keys.appSecret}`,
    accessToken: `${config.twitter.keys.accessToken}`,
    accessSecret: `${config.twitter.keys.accessSecret}`,
  });

  for (let i = 0; i < maxTweetsPerDay; i++) {
    setTimeout(async () => {
      try {
        const canPost = await checkRateLimit(client);
        if (!canPost) {
          console.log('Skipping post due to rate limit.');
          return;
        }

        // step 1 call the generateAutoPostTweet function from the twitterProfessional module
        const tweet = await twitterProfessional.generateAutoPostTweet();

        if (config.twitter.settings.devMode) {
          console.log(`Dev mode enabled, 
            Tweet to be sent!. ${tweet.tweet}
            Comment to be sent!: ${tweet.comment}
            `);
        }

        if (tweet === undefined) {
            console.log("Tweet is undefined, generating a new one!");
            const tweet = await twitterProfessional.generateAutoPostTweet();
        }
        await twitterProfessional.postToTwitter(tweet, client);
      } catch (error) {
        console.error("Error auto-posting to Twitter:", error);
      }
    }, i * interval);
  }
}

async function autoTrader() {
  if (!config.cryptoGlobals.tradeTokensInBackground) {
    console.log('Background trading is disabled in config.');
    return;
  }

  console.log(`Starting auto trader with interval of ${config.cryptoGlobals.tradeTokensInBackgroundInterval}ms`);
  console.log(`Maximum concurrent trades allowed: ${config.cryptoGlobals.maxOpenTrades}`);

  setInterval(async () => {
    try {
      // Check current active trades
      const activeTrades = await getActiveTrades();
      if (activeTrades.length >= config.cryptoGlobals.maxOpenTrades) {
        console.log(`Skipping trade check - At maximum open trades (${activeTrades.length}/${config.cryptoGlobals.maxOpenTrades})`);
        return;
      }

      // Check wallet balance
      const currentBalance = await checkSolanaBalance(config.cryptoGlobals.publicKey);
      const investmentAmount = config.cryptoGlobals.investmentAmountInSol;
      const minThreshold = config.cryptoGlobals.walletThreshold;
      
      // Check if balance is below threshold
      if (currentBalance < minThreshold) {
        console.log(`Insufficient wallet balance (${currentBalance} SOL) is below minimum threshold of ${minThreshold} SOL`);
        return;
      }
      
      // Check if investment would drop balance below threshold
      if ((currentBalance - investmentAmount) < minThreshold) {
        console.log(`Investment of ${investmentAmount} SOL would put wallet balance (${currentBalance} SOL) below threshold (${minThreshold} SOL)`);
        return;
      }

      console.log(`Current active trades: ${activeTrades.length}/${config.cryptoGlobals.maxOpenTrades}`);
      console.log(`Wallet balance: ${currentBalance} SOL`);
      console.log('Auto trader checking for new opportunities...');
      
      const investmentChoice = await autoTraderAgent.generateTradeAnswer();

      if (!investmentChoice) {
        console.log('No valid investment opportunities found this round.');
        return;
      }

      if (config.cryptoGlobals.tradeTokenDevMode) {
        console.log('Trade dev mode enabled:', {
          token: investmentChoice.tokenData.tokenName,
          tokenAddress: investmentChoice.tokenData.tokenAddress,
          tokenPrice: investmentChoice.tokenData.tokenPriceInSol,
          tokenPriceSOL: investmentChoice.tokenData.tokenPriceInSol,
          investmentComment: investmentChoice.agentInvestmentComment,
          investmentDecision: investmentChoice.agentInvestmentDecisionComment
        });
      }

      await autoTraderAgent.executeTrade(investmentChoice);
    } catch (error) {
      console.error("Error in auto trader:", error);
    }
  }, config.cryptoGlobals.tradeTokensInBackgroundInterval);
}

function scanAndRespondToTwitterPosts() {
  if (!config.twitter.settings.xAutoResponder) return; // Ensure the function respects the xAutoResponder flag

  const interval = config.twitter.settings.timeToReadPostsOnPage * 60 * 1000; // Interval in milliseconds

  setInterval(async () => {
    try {
      await twitterProfessional.scanAndRespondToPosts();
    } catch (error) {
      console.error("Error scanning and responding to Twitter posts:", error);
    }
  }, interval);
}

startAI();