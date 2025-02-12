import { config } from "../config/config.mjs";
import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";
import { checkRateLimit, updateRateLimitInfo, fetchLatestTokenData } from "../utils/helpers.mjs";
import axios from 'axios';
import { saveTweetData } from '../db/dynamo.mjs';
import { executeTradeBuy } from '../trading/buy.mjs';
import { checkSolanaBalance } from '../utils/solanaUtils.mjs';
import { sendAnalysisMessage, sendTwitterUpdate } from '../utils/discord.mjs';

dotenv.config();
const url = 'https://api.smalltimedevs.com/ai/hive-engine'

export async function generateAutoPostTweet() {
    let tweetData;
    try {
      // Step 2 call the handleQuestion function
      tweetData = await pickNewTokenNonBoosted();
      if (config.twitter.settings.devMode) {
        console.log('Development mode is enabled. Not posting to twitter. Generated tweet data:', tweetData);
      }
  
      while (!tweetData || !tweetData.tweet || !tweetData.comment) {
        console.log("Generated tweet is missing the tweet post or the comment post, retrying...");
        await generateAutoPostTweet();
      }
      //console.log("Generated Tweet:", tweetData);
      return tweetData;
    } catch (error) {
      console.error("Error generating auto-post tweet, generating a new one!");
      await generateAutoPostTweet();
    }
}

async function pickNewTokenNonBoosted() {
    let tokenData;
    try {
      // Step 3
        tokenData = await fetchLatestTokenData();
        console.log('Token data:', tokenData);
    } catch (error) {
        console.error("Error fetching token data going to try again!", error);
        return await pickNewTokenNonBoosted();
    }

    // Step 4
    const tokenAddress = tokenData.tokenAddress;
    const chainId = tokenData.chainId;

    // Make the const for the api specific request
    const contractAddress = tokenAddress;
    const chain = chainId;
    // If the response is good for the prompt then we can move on to the next step of calling the api with the response.
    let agentResponses;
    try {
        const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/twitter-agent-chat', {chain, contractAddress });
        console.log("Received response from external API:", response.data);
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

    let tweet = `
    ${tweetAgent.name}: 
    ${tweetAgent.response}\n\n 
    
    ${commentAgent.name}:
    ${commentAgent.response}\n\n

    ${hashtagsAgent.name}:\n${hashtagsAgent.response}\n`;

    let comment = `
    ${anaylstAgent.name}:
    ${anaylstAgent.response}\n\n
    
    ${investmentAgent.name}:
    ${investmentAgent.response}\n
    ${investmentAgent.decision}`;
    
    let agetnAnalysisComment = `${anaylstAgent.name}:\n${anaylstAgent.response}`;
    let agentTweetPost = `${tweetAgent.name}:\n${tweetAgent.response}`;
    let agentComment = `${commentAgent.name}:\n${commentAgent.response}`;
    let agetnHashtagsComment = `${hashtagsAgent.name}:\n${hashtagsAgent.response}\n`;
    let agentInvestmentComment = `${investmentAgent.name}:\n${investmentAgent.response}`;
    let agentInvestmentDecisionComment = `${investmentAgent.decision}`;

    const tweetData = {
        tweet,
        comment,
        agetnAnalysisComment,
        agentTweetPost,
        agentComment,
        agetnHashtagsComment,
        agentInvestmentComment,
        agentInvestmentDecisionComment,
        tokenData,
    };

    if (config.twitter.settings.devMode) {
        console.log('Development mode is enabled. Generated tweet data:', tweetData);
    }

    return tweetData;
}

export async function postToTwitter(tweetData, client) {
  try {
    // Send tweet data to hive channel first
    await sendAnalysisMessage('tweet', {
      analysis: tweetData.agetnAnalysisComment,
      investment: tweetData.agentInvestmentComment,
      decision: tweetData.agentInvestmentDecisionComment
    });

    let tradeResult = null;

    // Only proceed with trading if tradeTokens is enabled
    if (config.cryptoGlobals.tradeTokens && tweetData.agentInvestmentDecisionComment && 
        (tweetData.agentInvestmentDecisionComment.startsWith("Invest") || 
         tweetData.agentInvestmentDecisionComment.startsWith("Quick Profit"))) {
      
      // Check wallet balance before attempting trade
      const currentBalance = await checkSolanaBalance(config.cryptoGlobals.publicKey);
      const investmentAmount = config.cryptoGlobals.investmentAmountInSol;
      const minThreshold = config.cryptoGlobals.walletThreshold;
      
      if (currentBalance < minThreshold || (currentBalance - investmentAmount) < minThreshold) {
        console.log('Insufficient balance for trade');
        const donationComment = `I currently don't have enough funds to make this trade. If you want to see me keep purchasing through these trenches, feel free to donate to my trading funds:\nhttps://solscan.io/account/${config.cryptoGlobals.publicKey} 🙏`;
        tweetData.comment = `${tweetData.comment}\n\n${donationComment}`;
      } else {
        // Extract trade parameters and execute trade
        let targetGain, targetLoss;
        let tradeType = null;

        if (tweetData.agentInvestmentDecisionComment.startsWith("Quick Profit")) {
          const gainMatch = tweetData.agentInvestmentDecisionComment.match(/Gain \+(\d+)%/);
          const lossMatch = tweetData.agentInvestmentDecisionComment.match(/Loss -(\d+)%/);
          
          targetGain = gainMatch ? parseFloat(gainMatch[1]) : 50;
          targetLoss = lossMatch ? parseFloat(lossMatch[1]) : 20;
          tradeType = 'QUICK_PROFIT';
        } else {
          // Regular Invest format
          const targetGainMatch = tweetData.agentInvestmentDecisionComment.match(/take profit at (\d+)%/i);
          const targetLossMatch = tweetData.agentInvestmentDecisionComment.match(/stop loss at (\d+)%/i);
          
          targetGain = targetGainMatch ? parseFloat(targetGainMatch[1]) : 50;
          targetLoss = targetLossMatch ? parseFloat(targetLossMatch[1]) : 20;
          tradeType = 'INVEST';
        }

        console.log('Extracted trade parameters:', { targetGain, targetLoss });
        
        tradeResult = await executeTradeBuy(tweetData, targetGain, targetLoss, tradeType);
        
        if (!tradeResult.success) {
          if (tradeResult.error && tradeResult.error.includes('insufficient balance')) {
            const donationComment = `I currently don't have enough funds to make this trade. If you want to see me keep purchasing through these trenches, feel free to donate to my trading funds:\nhttps://solscan.io/account/${config.cryptoGlobals.publicKey} 🙏`;
            tweetData.comment = `${tweetData.comment}\n\n${donationComment}`;
          } else {
            console.error('Trade execution failed:', tradeResult.error);
          }
        } else {
          console.log('Trade executed successfully. Trade ID:', tradeResult.tradeId);
          if (tradeResult.txId) {
            const tradeComment = `I put my money where my agent's mouth is! Check out the trade: https://solscan.io/tx/${tradeResult.txId} 🚀`;
            tweetData.comment = `${tweetData.comment}\n${tradeComment}`;
          }
        }
      }
    }

    // Twitter posting logic should execute regardless of dev mode
    if (config.twitter.settings.devMode) {
      console.log('Development mode is enabled. Skipping Twitter posts.');
      if (tradeResult && tradeResult.success) {
        console.log('Trade comment that would be posted:', tweetData.comment);
      }
      return;
    }

    const canPost = await checkRateLimit(client);
    if (!canPost) {
      console.log('Skipping post due to rate limit.');
      return;
    }

    // Post main tweet and send to Discord
    const { data: createdTweet, headers } = await client.v2.tweet(tweetData.tweet);
    updateRateLimitInfo(headers);
    await sendTwitterUpdate('tweet', tweetData.tweet);
    console.log('Tweet posted successfully:', createdTweet);

    // Post reply and send to Discord
    if (tweetData.comment) {
      const { headers: commentHeaders } = await client.v2.reply(tweetData.comment, createdTweet.id);
      updateRateLimitInfo(commentHeaders);
      await sendTwitterUpdate('reply', tweetData.comment);
      console.log('Comment posted successfully');
    }

    // Save tweet data to DynamoDB
    if (
      tweetData.tweet && 
      createdTweet.id && 
      tweetData.comment
    ) {
      await saveTweetData(
        createdTweet.id,                              // tweetId
        new Date().toISOString(),                     // date
        tweetData.tweet,                              // tweet
        tweetData.comment,                            // comment
        tweetData.agetnHashtagsComment,               // hashtagsComment
        tweetData.agetnAnalysisComment,               // analysisComment
        tweetData.agentTweetPost,                     // tweetPost
        tweetData.agentComment,                       // agentComment
        tweetData.agetnHashtagsComment,               // hashtagsContent
        tweetData.agentInvestmentComment,             // investmentComment
        tweetData.agentInvestmentDecisionComment,     // investmentDecision
        JSON.stringify(tweetData.tokenData, null, 2)  // tokenData
      );
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