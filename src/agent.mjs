import { config } from "./config/config.mjs";
import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";
import { checkRateLimit, updateRateLimitInfo, fetchWithTimeout, fetchTokenData } from "./utils/helpers.mjs";
import axios from 'axios';
import { saveTweetData } from './db/dynamo.mjs';
import { decryptPrivateKey } from './encryption/encryption.mjs';
import { storeTradeInfo } from './db/dynamo.mjs';
import { startPriceMonitoring } from './trading/pnl.mjs';
import { executeTradeBuy } from './trading/buy.mjs';

dotenv.config();
const url = 'https://api.smalltimedevs.com/ai/hive-engine'

class TwitterAgent {
  constructor(name, personality, specialty) {
    this.name = name;
    this.personality = personality;
    this.specialty = specialty;
    this.history = [];
  }
// Used to respond to a tweet
  async generateResponse(input) {

    console.log("Generating response for input:", input);
    
    const prompt = `${this.personality}\nUser: ${input}\n${this.name}:`;

    try {
        const response = await fetchWithTimeout(`${url}/agent-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt }),
            timeout: 20000, // 20 seconds timeout
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
                
        const generatedResponse = response.data.text;
        this.history.push(generatedResponse);
        return generatedResponse;

    } catch (error) {
        console.error('Error connecting to external API:', error);
    }
  }
}

export async function generateAutoPostTweet() {
    let tweetData;
    try {
      // Step 2 call the handleQuestion function
      tweetData = await handleQuestion();
      if (config.twitter.settings.devMode) {
        console.log('Development mode is enabled. Not posting to twitter. Generated tweet data:', tweetData);
      }
  
      while (!tweetData || !tweetData.tweet || !tweetData.comment || !tweetData.hashtagsComment) {
        console.log("Generated tweet is null or incomplete, retrying...");
        tweetData = await handleQuestion();
      }
      //console.log("Generated Tweet:", tweetData);
      return tweetData;
    } catch (error) {
      console.error("Error generating auto-post tweet, generating a new one!");
      tweetData = await handleQuestion();
    }
}

export async function handleQuestion() {
    let tokenData;
    try {
        /*
         Step 3 lets go fetch all the token data so we can generate a tweet based on the info we have.
         Example Data output:

          -----------------------------------------------------------------
          ---------------------------DEV DEBUG LOG-------------------------
          Date Created: Mon, 16 Feb 57046 15:20:00 GMT
          Token Name: Gainocologist
          Token Symbol: GAYNS
          Token Description: $GAYNS 

          This is the only OFFICIAL Gainocology project. 

          The master of Gainocology, The Gainocologist himself. 

          This is the ultimate coin for those who seek a massive dose of financial gain. Forget the prescription pad - just HODL and watch your crypto health skyrocket!

          ca: A5JKRAXup65RJndhfBMR1yo1zxZyds2yyZc1niXypump
          Token Address: A5JKRAXup65RJndhfBMR1yo1zxZyds2yyZc1niXypump
          Token Twitter URL: https://x.com/gainocologist
          Token Website URL: No Website On DexScreener Token Profile
          -----------------------------------------------------------------
          Token Price In Sol: 0.0000001763
          Token Price In USD: 0.00004192
          Token Volume 24h: 314813.95
          Token Price Change 5m: -4.94
          Token Price Change 1h: -62.95
          Token Price Change 6h: -62.95
          Token Price Change 24h: -62.95
          Token Liquidity USD: 25821.76
          Token Liquidity Base: 307602399
          Token Liquidity Quote: 54.3758
          Token FDV: 41923
          Token Market Cap: 41923
          -----------------------------------------------------------------

        */
        tokenData = await fetchTokenData();
        if (config.twitter.settings.devMode) {
            console.log('Development mode is enabled. Generated token data:', tokenData);
        }

    } catch (error) {
        console.error("Error fetching token data going to try again!", error);
        await handleQuestion();
    }

    // Step 4 call the generatePrompt function
    const prompt = await generatePrompt(tokenData);
    //console.log("Generated prompt:", prompt);

    // If the response is good for the prompt then we can move on to the next step of calling the api with the response.
    let agentResponses;
    try {
        // Step 5 call the external API with the prompt
        if (config.twitter.settings.devMode) {
        console.log("Sending request to external API with payload:", { query: prompt });
        }

        const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/twitter-agent-chat', { query: prompt });
        //console.log("Received response from external API:", response.data);
        agentResponses = response.data.agents;

    } catch (error) {
        console.error("Error connecting to external API:", error.response ? error.response.data : error.message);
        throw new Error("Failed to connect to external API.");
    }

    if (!agentResponses || agentResponses.length < 4) {
        throw new Error("Invalid agent responses received from API.");
    }

    const anaylstAgent = agentResponses[0];
    const analystResponse = anaylstAgent.response;
    const investmentAgent = agentResponses[1];
    const investmentReponse = investmentAgent.response;
    const investmentDecision = investmentAgent.decision;
    const tweetAgent = agentResponses[2];
    const commentAgent = agentResponses[3];
    const hashtagsAgent = agentResponses[4];

    if (config.twitter.settings.devMode) {
      console.log("Analyst Response:", analystResponse);
      console.log("Tweet Agent Response:", tweetAgent.response);
      console.log("Comment Agent Response:", commentAgent.response);
      console.log("Hashtags Agent Response:", hashtagsAgent.response);
      console.log("Investment Response:", investmentReponse);
      console.log("Investment Decision:", investmentDecision);
    }

    if (!analystResponse) {
      console.error("Invalid analyst response, generating again.");
      await handleQuestion();
    }
    if (!tweetAgent || !tweetAgent.name || !tweetAgent.response) {
        console.error("Invalid tweet agent response, generating again.");
        await handleQuestion();
    }
    if (!commentAgent || !commentAgent.name || !commentAgent.response) {
        console.error("Invalid comment agent response, generating again.");
        await handleQuestion();
    }
    if (!hashtagsAgent || !hashtagsAgent.name || !hashtagsAgent.response) {
        console.error("Invalid hashtags agent response, generating again.");
        await handleQuestion();
    }
    if (!investmentAgent || !investmentAgent.response || !investmentAgent.decision) {
        console.error("Invalid investment agent response, generating again.");
        await handleQuestion();
    }

    let tweet = `${tweetAgent.name}:\n${tweetAgent.response}`;
    let comment = `${commentAgent.name}:\n${commentAgent.response}`;
    let hashtagsComment = `${hashtagsAgent.name}:\n${hashtagsAgent.response}\n`;
    let investmentComment = `${investmentAgent.name}:\n${investmentAgent.response}`;
    let investmentDecisionComment = `${investmentAgent.decision}`;

    if (tweet.length > 280) {
        tweet = tweet.substring(0, 277) + '...';
    }
    if (comment.length > 280) {
        comment = comment.substring(0, 277) + '...';
    }
    if (hashtagsComment.length > 280) {
        hashtagsComment = hashtagsComment.substring(0, 277) + '...';
    }

    const tweetData = {
        tweet,
        comment,
        hashtagsComment,
        tokenData,
        analystResponse,
        investmentComment,
        investmentDecisionComment,
    };

    if (config.twitter.settings.devMode) {
        console.log('Development mode is enabled. Generated tweet data:', tweetData);
    }

    return tweetData;
}

async function generatePrompt(tokenData) {
  const {
    dateCreated,
    tokenName,
    tokenSymbol,
    tokenDescription,
    tokenAddress,
    tokenTwitterURL,
    tokenWebsiteURL,
    tokenPriceInSol,
    tokenPriceInUSD,
    tokenVolume24h,
    tokenPriceChange5m,
    tokenPriceChange1h,
    tokenPriceChange6h,
    tokenPriceChange24h,
    tokenLiquidityUSD,
    tokenLiquidityBase,
    tokenLiquidityQuote,
    tokenFDV,
    tokenMarketCap,
  } = tokenData;
  const influencers = config.twitter.influencers.twitterHandles;
  const randomInfluencer = influencers[Math.floor(Math.random() * influencers.length)];

  /*
          -----------------------------------------------------------------
          ---------------------------DEV DEBUG LOG-------------------------
          Date Created: Mon, 16 Feb 57046 15:20:00 GMT
          Token Name: Gainocologist
          Token Symbol: GAYNS
          Token Description: $GAYNS 

          This is the only OFFICIAL Gainocology project. 

          The master of Gainocology, The Gainocologist himself. 

          This is the ultimate coin for those who seek a massive dose of financial gain. Forget the prescription pad - just HODL and watch your crypto health skyrocket!

          ca: A5JKRAXup65RJndhfBMR1yo1zxZyds2yyZc1niXypump
          Token Address: A5JKRAXup65RJndhfBMR1yo1zxZyds2yyZc1niXypump
          Token Twitter URL: https://x.com/gainocologist
          Token Website URL: No Website On DexScreener Token Profile
          -----------------------------------------------------------------
          Token Price In Sol: 0.0000001763
          Token Price In USD: 0.00004192
          Token Volume 24h: 314813.95
          Token Price Change 5m: -4.94
          Token Price Change 1h: -62.95
          Token Price Change 6h: -62.95
          Token Price Change 24h: -62.95
          Token Liquidity USD: 25821.76
          Token Liquidity Base: 307602399
          Token Liquidity Quote: 54.3758
          Token FDV: 41923
          Token Market Cap: 41923
          -----------------------------------------------------------------
  */
  return `
    Date Created: ${dateCreated}
    Token Name: ${tokenName}
    Token Symbol: ${tokenSymbol}
    Token Description: ${tokenDescription}
    Token Address: ${tokenAddress}
    Token Twitter URL: ${tokenTwitterURL}
    Token Website URL: ${tokenWebsiteURL}
    Token Price In Sol: ${tokenPriceInSol}
    Token Price In USD: ${tokenPriceInUSD}
    Token Volume 24h: ${tokenVolume24h}
    Token Price Change 5m: ${tokenPriceChange5m}
    Token Price Change 1h: ${tokenPriceChange1h}
    Token Price Change 6h: ${tokenPriceChange6h}
    Token Price Change 24h: ${tokenPriceChange24h}
    Token Liquidity USD: ${tokenLiquidityUSD}
    Token Liquidity Base: ${tokenLiquidityBase}
    Token Liquidity Quote: ${tokenLiquidityQuote}
    Token FDV: ${tokenFDV}
    Token Market Cap: ${tokenMarketCap}
    Random Influencer To Mention: ${randomInfluencer}
  `
}

export async function postToTwitter(tweetData, client) {
  try {
    console.log('Starting postToTwitter function with trade data:', {
      investmentDecision: tweetData.investmentDecisionComment,
      tokenDetails: {
        name: tweetData.tokenData.tokenName,
        address: tweetData.tokenData.tokenAddress,
        priceSOL: tweetData.tokenData.tokenPriceInSol
      }
    });

    // Trading logic should execute regardless of dev mode
    if (tweetData.investmentDecisionComment && 
        (tweetData.investmentDecisionComment.startsWith("Invest") || 
         tweetData.investmentDecisionComment.startsWith("Quick Profit"))) {
      
      let targetGain, targetLoss;
      
      if (tweetData.investmentDecisionComment.startsWith("Quick Profit")) {
        const gainMatch = tweetData.investmentDecisionComment.match(/Gain \+(\d+)%/);
        const lossMatch = tweetData.investmentDecisionComment.match(/Loss -(\d+)%/);
        
        targetGain = gainMatch ? parseFloat(gainMatch[1]) : 50;
        targetLoss = lossMatch ? parseFloat(lossMatch[1]) : 20;

        console.log('Extracted trade parameters:', { targetGain, targetLoss });
        
        // Execute trade and wait for result
        const tradeResult = await executeTradeBuy(tweetData, targetGain, targetLoss);
        console.log('Trade execution result:', tradeResult);
        
        if (!tradeResult.success) {
          console.error('Trade execution failed:', tradeResult.error);
        } else {
          console.log('Trade executed successfully. Trade ID:', tradeResult.tradeId);
        }
      }
    }

    // Twitter posting logic
    if (config.twitter.settings.devMode) {
      console.log('Development mode is enabled. Skipping Twitter posts.');
      return;
    }

    const canPost = await checkRateLimit(client);
    if (!canPost) {
      console.log('Skipping post due to rate limit.');
      return;
    }

    //const formattedTweet = tweetData.tweet.replace(/\*\*/g, '').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
    //const { data: createdTweet, headers } = await client.v2.tweet(formattedTweet);
    const { data: createdTweet, headers } = await client.v2.tweet(tweetData.tweet);
    updateRateLimitInfo(headers);
    console.log('Tweet posted successfully:', createdTweet);

    if (tweetData.comment) {
      //const formattedComment = tweetData.comment.replace(/\*\*/g, '').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
      //const { headers: commentHeaders } = await client.v2.reply(formattedComment, createdTweet.id);
      const { headers: commentHeaders } = await client.v2.reply(tweetData.comment, createdTweet.id);
      updateRateLimitInfo(commentHeaders);
      console.log('Comment posted successfully:', tweetData.comment);
    }
    
    if (tweetData.investmentComment && (tweetData.investmentComment.startsWith("Invest") || tweetData.investmentComment.startsWith("Quick Profits"))) {
      const { headers: investmentCommentHeaders } = await client.v2.reply(tweetData.investmentComment, createdTweet.id);
      updateRateLimitInfo(investmentCommentHeaders);
      console.log('Investment decision comment posted successfully:', tweetData.investmentComment);
    }

    if (tweetData.hashtagsComment) {
      //const formattedHashtagsComment = tweetData.hashtagsComment.replace(/\*\*/g, '').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
      //const { headers: hashtagsHeaders } = await client.v2.reply(formattedHashtagsComment, createdTweet.id);
      const { headers: hashtagsHeaders } = await client.v2.reply(tweetData.hashtagsComment, createdTweet.id);
      console.log('Hashtags headers:', hashtagsHeaders); // Log headers for debugging
      updateRateLimitInfo(hashtagsHeaders);
      console.log('Hashtags comment posted successfully:', tweetData.hashtagsComment);
    }

    // Formated Token Data
    const formatedTokenData = JSON.stringify(tweetData.tokenData, null, 2);
    // 
    // Save tweet data to DynamoDB
    if (tweetData.tweet && createdTweet.id && tweetData.comment && tweetData.hashtagsComment && tweetData.analystResponse && tweetData.investmentComment && tweetData.investmentDecisionComment && formatedTokenData ) {
      await saveTweetData(createdTweet.id, new Date().toISOString(), tweetData.tweet, tweetData.comment, tweetData.hashtagsComment, tweetData.analystResponse, tweetData.investmentComment, tweetData.investmentDecisionComment, formatedTokenData );
    }

    return createdTweet;
  } catch (error) {
    if (error.code === 401) {
      console.error('Unauthorized: Check your Twitter API credentials.');
    } else if (error.code === 403) {
      console.error('Forbidden: You do not have permission to perform this action. Check your Twitter API permissions.');
    } else if (error.response && error.response.headers) {
      console.log('Error headers:', error.response.headers); // Log headers for debugging
      updateRateLimitInfo(error.response.headers);
      console.error('Error posting tweet:', error);
    } else {
      console.error('Error posting tweet:', error);
    }
    // Do not throw an error to keep the application running
    console.log('Continuing execution despite the error.');
  }
}

export async function scanAndRespondToOtherUserTweets(targetUserId) {
  const client = new TwitterApi({
    appKey: `${config.twitter.keys.appKey}`,
    appSecret: `${config.twitter.keys.appSecret}`,
    accessToken: `${config.twitter.keys.accessToken}`,
    accessSecret: `${config.twitter.keys.accessSecret}`,
  });

  try {
    // Fetch the latest tweets from the target user's timeline
    const { data } = await client.v2.userTimeline(targetUserId, { max_results: 5 });
    const tweets = data.data;

    if (!tweets || tweets.length === 0) {
      console.log('No tweets found for the specified user.');
      return;
    }

    for (const tweet of tweets) {
      if (tweet.in_reply_to_user_id === null) {
        // Send tweet text to OpenAI and generate a response
        const response = await generateResponseToTweet(tweet.text);

        // Post the response as a reply to the original tweet
        await client.v2.reply(response, tweet.id);
        console.log('Replied to tweet:', tweet.id);
      }
    }
  } catch (error) {
    console.error('Error scanning and responding to posts:', error);
  }
}

async function generateResponseToTweet(tweetText) {
  const prompt = `
    ### Twitter Response Generator

    You are a highly engaging and professional Twitter bot. Your job is to create a thoughtful and engaging response to the following tweet:
    
    Tweet: "${tweetText}"

    Response:
  `;

  try {
    console.log("Sending request to external API with payload:", { query: prompt });
    const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/agent-chat', { query: prompt });
    console.log("Received response from external API:", response.data);
    let generatedResponse = response.data.text.trim();
    generatedResponse = generatedResponse.replace(/\*\*/g, ''); // Remove Markdown bold formatting
    generatedResponse = generatedResponse.replace(/\n/g, ' \\n '); // Replace newlines with escaped newlines
    generatedResponse = generatedResponse.replace(/\s+/g, ' ').trim(); // Remove extra spaces
    if (generatedResponse.length > 280) {
      generatedResponse = generatedResponse.substring(0, 277) + '...'; // Ensure response is within 280 characters
    }
    return generatedResponse;
  } catch (error) {
    console.error("Error generating response to tweet:", error.response ? error.response.data : error.message);
  }
}