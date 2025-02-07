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
            postsPerDay: 100,
            postsPerMonth: 3000,
            timeToReadPostsOnPage: 2,            
        },
    },

    cryptoGlobals: {
        tradeTokenDevMode: false,
        tradeTokens: true, // This is for the twitter portion of the bot and the auto-trading portion
        tradeTokensInBackground: true,
        tradeTokensInBackgroundInterval: 60000, // 60 seconds in miliseconds
        maxOpenTrades: 5,
        solanaMint: 'solMint: "So11111111111111111111111111111111111111112",',
        publicKey: process.env.SOL_PUBLIC_KEY,
        rpcNode: process.env.HELIUS_RPC_NODE,
        investmentAmountInSol: 0.05,
        buySlippage: 500, // 5% slippage
        sellSlippage: 1500, // 15% slippage
        priorityFee: 200000, // Default priority fee
        referralPublicKey: 'G479Un81UEDZEeHPv23Uy9n2qqgy1CzT7muJVj7PUHJF',
        useJito: false,
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
};
