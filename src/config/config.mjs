import dotenv from 'dotenv';

dotenv.config();

// Helper function to parse boolean values
const parseBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return false;
};

export const config = {
    twitter: {
        keys: {
            appKey: process.env.TWITTER_API_KEY,
            appSecret: process.env.TWITTER_API_SECRET,
            accessToken: process.env.TWITTER_ACCESS_TOKEN,
            accessSecret: process.env.TWITTER_ACCESS_SECRET,
            twitterUserID: process.env.TWITTER_USER_ID,
        },
        settings: {
            xAutoPoster: parseBool(process.env.TWITTER_POSTER) || false,
            devMode: parseBool(process.env.TWITTER_DEV_MODE) || false,
            xAutoResponder: parseBool(process.env.TWITTER_RESPONDER) || false,
            useDexScreenerLatestTokens: parseBool(process.env.TWITTER_GATHER_DEXSCREENER_LATEST_TOKENS) || false,
            useDexScreenerTopBoosted: parseBool(process.env.TWITTER_GATHER_DEXSCREENER_LATEST_BOOSTED_TOKENS) || false,
            
            postsPerDay: process.env.TWITTER_POSTS_PER_DAY || 10,
            postsPerMonth: process.env.TWITTER_POSTS_PER_MONTH || 300,
            timeToReadPostsOnPage: 2,            
        },
    },

    cryptoGlobals: {
        // settings to enable or disable trading
        tradeTokenDevMode: parseBool(process.env.CRYPTO_TRADE_DEV_MODE) || false,
        tradeTokens: parseBool(process.env.CRYPTO_TRADE_TOKENS) || false, // This is for the twitter portion of the bot and the auto-trading portion
        tradeTokensInBackground: parseBool(process.env.CRYPTO_TRADE_TOKENS_IN_BACKGROUND) || false, // This is for the auto-trading portion only

        // Ask AI for advice on open trades
        askForAdviceFromAI: parseBool(process.env.CRYPTO_TRADE_TOKENS_ASK_AI_TRADE_ADVICE) || false,

        // Trading Times
        minPumpFunTime: (10 * 60), // 10 minutes in seconds
        maxPumpFunTime: (30 * 60), // 30 minutes in seconds

        // Determine which method to get the token data from
        useDexScreenerLatestTokens: process.env.CRYPTO_TRADE_TOKENS_GATHER_DEXSCREENER_LATEST_TOKENS || false,
        useDexScreenerTopBoosted: process.env.CRYPTO_TRADE_TOKENS_GATHER_DEXSCREENER_LATEST_BOOSTED_TOKENS || false,
        useJupNewTokens: process.env.CRYPTO_TRADE_TOKENS_GATHER_JUP_NEW_TOKENS, // Supports raydium and pump fun tokens. ( Not great luck so far trading pumpfun tokens with jup still a WIP )

        tradeTokensInBackgroundInterval: process.env.CRYPTO_TRADE_TOKENS_INTERVAL_MS || 30000, // 30 seconds
        maxOpenTrades: process.env.CRYPTO_TRADE_TOKENS_MAX_OPEN_TRADES || 1,
        solMint: 'So11111111111111111111111111111111111111112',
        solanaMint: 'solMint: "So11111111111111111111111111111111111111112",',
        publicKey: process.env.SOL_PUBLIC_KEY,
        rpcNode: process.env.HELIUS_RPC_NODE,
        walletThreshold: process.env.CRYPTO_TRADE_TOKENS_MIN_WALLET_BALANCE || 0.1,
        investmentAmountInSol: process.env.CRYPTO_TRADE_TOKENS_INVESTMENT_AMOUNT_SOL || 0.1,
        investHoldingTimePeriodHours: process.env.CRYPTO_TRADE_TOKENS_INVEST_MIN_HOLD_TIME_HOURS || 1,
        quickProfitHoldingTimePeriodMinutes: process.env.CRYPTO_TRADE_TOKENS_QUICK_PROFIT_HOLD_TIME_MINUTES || 30,
        tradeCooldownHours: process.env.CRYPTO_TRADE_TOKENS_REINVEST_COOLDOWN_HOURS || 24, // How many hours to wait before trading same token again
    },

    // Add API sections and their respective APIs
    apis:{
        crypto: {
            coinGecko: 'https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=',
            dexscreenerTokneProfilesUrl: 'https://api.dexscreener.com/token-profiles/latest/v1',
            dexscreenerTopBoostedUrl: 'https://api.dexscreener.com/token-boosts/top/v1',
            latestJupTokens: 'https://api.jup.ag/tokens/v1/new',
            raydiumMintIds: 'https://api-v3.raydium.io/mint/ids?mints=',
            raydiumMintPrice: 'https://api-v3.raydium.io/mint/price?mints=',
        },
    },

    discord: {
        botToken: process.env.DISCORD_KEY,
        webhookUrl: process.env.DISCORD_WEB_HOOK || '',

        cortexAI: '1340512058474631178',

        generalAramidChannel: process.env.DISCORD_ARAMID_GENERAL,
        hiveChannel: process.env.DISCORD_ARAMID_HIVE,
        twitterChannel: process.env.DISCORD_TWITTER,
        tradeChannel: process.env.DISCORD_TRADE,

        monitoredChannels: [
            // Aramid Monitored Channels
            process.env.DISCORD_ARAMID_GENERAL,
            process.env.DISCORD_GENERAL_CHAT,
            process.env.DISCORD_TWITTER,
            process.env.DISCORD_ARAMID_HIVE,
            process.env.DISCORD_TRADE,

            // Other Random Channels
            process.env.DISCORD_PROFIT_SHOWCASE,
            process.env.DISCORD_LOSS_SHOWCASE,
            process.env.DISCORD_FARMING_CHAT,
            process.env.DISCORD_MEME_CHAT,
        ].filter(Boolean),

        allowBotMessagesChannels: [
            process.env.DISCORD_ARAMID_GENERAL,
            process.env.DISCORD_GENERAL_CHAT,
            process.env.DISCORD_TRADE,
            process.env.DISCORD_PROFIT_SHOWCASE,
            process.env.DISCORD_LOSS_SHOWCASE,
            process.env.DISCORD_FARMING_CHAT,
            process.env.DISCORD_MEME_CHAT,
            // Add any other channels where bot messages should be allowed
        ].filter(Boolean),
    },
};