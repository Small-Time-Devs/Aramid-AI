import dotenv from 'dotenv';

dotenv.config();

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
            xAutoPoster: true,
            devMode: false,
            xAutoResponder: false,
            useDexScreenerLatestTokens: true,
            useDexScreenerTopBoosted: false,
            useJupNewTokens: false, // Supports raydium and pump fun tokens.
            postsPerDay: 100,
            postsPerMonth: 3000,
            timeToReadPostsOnPage: 2,            
        },
    },

    cryptoGlobals: {
        // settings to enable or disable trading
        tradeTokenDevMode: false,
        tradeTokens: true, // This is for the twitter portion of the bot and the auto-trading portion
        tradeTokensInBackground: true, // This is for the auto-trading portion only

        // Ask AI for advice on open trades
        askForAdviceFromAI: true,

        // Trading Times
        minPumpFunTime: (10 * 60), // 10 minutes in seconds
        maxPumpFunTime: (30 * 60), // 30 minutes in seconds

        // Determine which method to get the token data from
        useDexScreenerLatestTokens: true,
        useDexScreenerTopBoosted: false,

        useJupNewTokens: false, // Supports raydium and pump fun tokens. ( Not great luck so far trading pumpfun tokens with jup still a WIP )

        tradeTokensInBackgroundInterval: 30000, // 60 seconds in miliseconds
        maxOpenTrades: 1,
        solMint: 'So11111111111111111111111111111111111111112',
        solanaMint: 'solMint: "So11111111111111111111111111111111111111112",',
        publicKey: process.env.SOL_PUBLIC_KEY,
        rpcNode: process.env.HELIUS_RPC_NODE,
        walletThreshold: 0.04,
        investmentAmountInSol: 0.025,
        investHoldingTimePeriodHours: 1,
        quickProfitHoldingTimePeriodMinutes: 30,
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
        webhookUrl: process.env.DISCORD_WEB_HOOK || '',
        botToken: process.env.DISCORD_KEY,
        twitterChannel: process.env.DISCORD_TWITTER_CHANNEL_ID,
        tradeChannel: process.env.DISCORD_TRADE_CHANNEL_ID,
        hiveChannel: process.env.DISCORD_BOT_CHANNEL_ID,
    },
};