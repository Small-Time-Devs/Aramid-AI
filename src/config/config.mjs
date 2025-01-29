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
        influencers: {
            twitterHandles: [
                'CryptoAudiKing', 
                'MikeDeanLive', 
                'xenpub',
                'KyeGomezB',
                'REALISWORLDS',
                'DEGENLABS_CO',
                'DefiDaddy_',
                'TheDogeArmy_',
                'pumpfunhome',
            ],
        },
    },

    cryptoGlobals: {
        solanaMint: 'solMint: "So11111111111111111111111111111111111111112",',
        publicKey: process.env.SOL_PUBLIC_KEY,
        rpcNode: process.env.HELIUS_RPC_NODE
    },

    // Add API sections and their respective APIs
    apis:{
        crypto: {
            coinGecko: 'https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=', // Update to accept a variable
            dexscreenerTokneProfilesUrl: 'https://api.dexscreener.com/token-profiles/latest/v1',
            dexscreenerTopBoostedUrl: 'https://api.dexscreener.com/token-boosts/top/v1',
            raydiumMintIds: 'https://api-v3.raydium.io/mint/ids?mints=',
            raydiumMintPrice: 'https://api-v3.raydium.io/mint/price?mints=',
        },
        weather: {
            openWeatherMap: 'https://api.openweathermap.org/data/2.5/weather?q=London&appid=your_api_key',
        },
    },
};
