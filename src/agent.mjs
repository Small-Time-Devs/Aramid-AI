import { config } from "./config/config.mjs";
import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";
import { checkRateLimit, updateRateLimitInfo, fetchWithTimeout, fetchTokenData } from "./utils/helpers.mjs";
import axios from 'axios';

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
      //console.log("Generated Tweet:", tweetData);
  
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
        // Step 3 call the fetchTokenData function
        tokenData = await fetchTokenData();
    } catch (error) {
        console.error("Error fetching token data:", error);
        throw new Error("Failed to fetch valid token data.");
    }

    // Step 4 call the generatePrompt function
    const prompt = await generatePrompt(tokenData);
    //console.log("Generated prompt:", prompt);

    // If the response is good for the prompt then we can move on to the next step of calling the api with the response.
    let agentResponses;
    try {
        console.log("Sending request to external API with payload:", { query: prompt });
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

    const tweetAgent = agentResponses[1];
    const commentAgent = agentResponses[2];
    const hashtagsAgent = agentResponses[3];

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

    const projectLink = `https://dexscreener.com/solana/${tokenData.tokenAddress}`;
    const influencers = config.twitter.influencers.twitterHandles;
    const randomInfluencer = influencers[Math.floor(Math.random() * influencers.length)];

    let tweet = `${tweetAgent.name}:\n${tweetAgent.response.replace(tokenData.tokenName, `[${tokenData.tokenName}](${projectLink})`)}`;
    let comment = `${commentAgent.name}:\n${commentAgent.response.replace(tokenData.tokenName, `[${tokenData.tokenName}](${projectLink})`)}`;
    let hashtagsComment = `${hashtagsAgent.name}:\n${hashtagsAgent.response.replace('${randomInfluencer}', randomInfluencer)}\n`;

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
        ...tokenData,
    };

    //console.log("Final tweet data:", tweetData);

    return tweetData;
}

async function generatePrompt(tokenData) {
  const { tokenName, tokenDescription, tokenAddress, tokenPrice, links } = tokenData;
  const influencers = config.twitter.influencers.twitterHandles;
  const randomInfluencer = influencers[Math.floor(Math.random() * influencers.length)];

  return `
    Token Name: ${tokenName}
    Token Description: ${tokenDescription}
    Token Address: ${tokenAddress}
    Token Price: ${tokenPrice}
    Links: ${links}
    Random Influencer: ${randomInfluencer}
    Project Links: ${links}
  `
}

export async function postToTwitter(tweetData, client) {
  try {
    if (config.twitter.settings.devMode) {
      console.log('Development mode is enabled. Not posting to twitter. Generated tweet data:', tweetData);
      return tweetData;
    }

    const canPost = await checkRateLimit(client);
    if (!canPost) {
      console.log('Skipping post due to rate limit.');
      return;
    }

    //console.log('Tweet data received inside postToTwitter:', tweetData);

    const formattedTweet = tweetData.tweet.replace(/\*\*/g, '').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
    //console.log('Posting tweet:', formattedTweet);

    const { data: createdTweet, headers } = await client.v2.tweet(formattedTweet);
    console.log('Tweet headers:', headers); // Log headers for debugging
    updateRateLimitInfo(headers);
    console.log('Tweet posted successfully:', createdTweet);

    if (tweetData.comment) {
      const formattedComment = tweetData.comment.replace(/\*\*/g, '').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
      //console.log('Posting comment:', formattedComment);
      const { headers: commentHeaders } = await client.v2.reply(formattedComment, createdTweet.id);
      console.log('Comment headers:', commentHeaders); // Log headers for debugging
      updateRateLimitInfo(commentHeaders);
      console.log('Comment posted successfully:', formattedComment);
    }

    if (tweetData.hashtagsComment) {
      const formattedHashtagsComment = tweetData.hashtagsComment.replace(/\*\*/g, '').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
      //console.log('Posting hashtags comment:', formattedHashtagsComment);
      const { headers: hashtagsHeaders } = await client.v2.reply(formattedHashtagsComment, createdTweet.id);
      console.log('Hashtags headers:', hashtagsHeaders); // Log headers for debugging
      updateRateLimitInfo(hashtagsHeaders);
      console.log('Hashtags comment posted successfully:', formattedHashtagsComment);
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

export async function scanAndRespondToPosts() {
  const client = new TwitterApi({
    appKey: `${config.twitter.keys.appKey}`,
    appSecret: `${config.twitter.keys.appSecret}`,
    accessToken: `${config.twitter.keys.accessToken}`,
    accessSecret: `${config.twitter.keys.accessSecret}`,
  });

  try {
    const { data } = await client.v2.userTimeline(config.twitter.twitterUserID, { max_results: 5 }); // Set max_results to a valid value
    const tweets = data.data;
    for (const tweet of tweets) {
      if (tweet.in_reply_to_user_id === null) {
        const response = await generateResponseToTweet(tweet.text);
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