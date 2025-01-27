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
            ],
        },
        solanaProjectsToReveiw: {
            percentageToTalkAbout: {
                chance: 25,
            },
            contractAddresses: {
                swarms: '74SBV4zDXxTRgv1pEMoECskKBkZHc2yGPnc7GYVepump',
                mcs: 'ALHFgnXSenUv17GMdf3dL9gtFW2KKQTz9avpM2Wypump',
                tai: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
                onda: 'CJRXkuaDcnXpPB7yEYw5uRp4F9j57DdzmmJyp37upump',
                trump: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',
                vine: '6AJcP7wuLwmRYLBNbi825wgguaPsWzPBEHcHndpRpump',
                m3m3: 'M3M3pSFptfpZYnWNUgAbyWzKKgPo5d1eWmX6tbiSF2K',
                qude: '3MyaQBG7y3SHLQZa282Jh2xtB2TZKHGzNp1CuZ4Cpump',
                pippin: 'Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump',
                anon: '9McvH6w97oewLmPxqQEoHUAv3u5iYMyQ9AeZZhguYf1T',
                create: '92crE7qiX5T7VtiXhCeagfo1E81UtyguiXM7qCi7pump',
                prism: '79vpEaaXrHnHHEtU9kYYQtwLTZy1SXpxXHi7LZ9Ppump',
                spores: 'H1koD28XAHg2vuGp7XggehBCR4zP6r6k6EQ3MR6j3kU2',
                arc: '61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump',
                pengu: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
                bonk: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
            },  
        },
    },

    // Add API sections and their respective APIs
    apis:{
        crypto: {
            coinGecko: 'https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=', // Update to accept a variable
            dexscreenerTokneProfilesUrl: 'https://api.dexscreener.com/token-profiles/latest/v1',
            dexscreenerTopBoostedUrl: 'https://api.dexscreener.com/token-boosts/top/v1',
            raydiumTokenNameUrl: 'https://api-v3.raydium.io/mint/ids?mints=',
            raydiumTokenPriceUrl: 'https://api-v3.raydium.io/mint/price?mints=',
        },
        weather: {
            openWeatherMap: 'https://api.openweathermap.org/data/2.5/weather?q=London&appid=your_api_key',
        },
    },
};
