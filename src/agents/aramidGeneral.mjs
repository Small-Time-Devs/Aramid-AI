import axios from 'axios';
import { botClient } from '../utils/discord.mjs';
import { config } from '../config/config.mjs';
import { fetchTokenPairs, fetchTokenNameAndSymbol } from '../utils/apiUtils.mjs';

function parseResponse(response) {
  // Handle cases where response is already a JSON string
  if (typeof response === 'string' && response.trim().startsWith('json\n')) {
    try {
      const jsonStr = response.replace('json\n', '');
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed[0]?.response) {
        return parsed[0].response;
      }
    } catch (e) {
      console.error('Error parsing JSON response:', e);
    }
  }

  // Handle nested response objects
  if (typeof response === 'object' && response.response) {
    return response.response;
  }

  return response;
}

export async function getAIResponse(userInput, userID) {
  try {
    if (!userInput || userInput.trim() === '') {
      throw new Error('Empty user input');
    }

    // Check if the input contains image URLs
    const hasImages = userInput.includes('[Images: ');
    const payload = {
      userInput,
      ...(userID && { userID }),
      context: 'discord-chat',
      type: hasImages ? 'vision' : 'general'
    };

    console.log('Sending request with input:', userInput);

    const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/aramid-chat', payload);

    console.log('API Response:', JSON.stringify(response.data, null, 2));

    // Check if response has agents array
    if (!response.data?.agents || !Array.isArray(response.data.agents)) {
      throw new Error('Invalid response format from API');
    }

    // Find Aramid agent
    const aramidAgent = response.data.agents.find(agent => agent.name === 'Aramid');
    if (!aramidAgent?.response?.response) {
      throw new Error('No valid Aramid response found');
    }

    // For trade notifications, just return the response without further processing
    if (userInput.includes('[Title: SELL Trade Executed]') || 
        userInput.includes('[Title: BUY Trade Executed]') ||
        userInput.includes('[Title: 🤖 AI Trading Analysis]')) {
      return aramidAgent.response.response;
    }

    // Only process decisions for aramid-chat messages
    if (aramidAgent.response.decision) {
      if (typeof aramidAgent.response.decision === 'string' && 
          aramidAgent.response.decision.startsWith('MutePerson:')) {
        const [_, targetID, duration] = aramidAgent.response.decision.split(':')[1].trim().split(',').map(s => s.trim());
        await handleMuteAction(targetID, parseInt(duration));
        return aramidAgent.response.response;
      }
      
      if (aramidAgent.response.decision.type === 'FetchTokenData' && 
          aramidAgent.response.decision.contractAddress) {
        // Only process token data requests for non-trade messages
        try {
          const tokenData = await fetchTokenPairs(aramidAgent.response.decision.contractAddress);
          const tokenMetadata = await fetchTokenNameAndSymbol(aramidAgent.response.decision.contractAddress);
          
          if (tokenData && tokenMetadata) {
            await sendInitialResponse(aramidAgent.response.response, userID);
            
            const researchPayload = {
              userInput: `Research token: ${tokenMetadata.tokenName} (${aramidAgent.response.decision.contractAddress})`,
              tokenData: {
                ...tokenData,
                ...tokenMetadata
              },
              context: 'token-research',
            };

            const researchResponse = await axios.post(
              'https://api.smalltimedevs.com/ai/hive-engine/aramid-chat',
              researchPayload
            );

            if (researchResponse.data?.agents?.[0]?.response) {
              const analysisResponse = researchResponse.data.agents[0].response.response;
              await sendFollowUpResponse(analysisResponse, userID);
            }
            return null;
          }
        } catch (error) {
          console.log('Token data fetch failed, returning normal response');
          return aramidAgent.response.response;
        }
      }
    }

    return aramidAgent.response.response;

  } catch (error) {
    console.error('Error getting AI response:', error.response?.data || error.message);
    throw new Error('Failed to get AI response');
  }
}

async function sendInitialResponse(response, userID) {
  const aramidChannel = botClient.channels.cache.get(config.discord.generalAramidChannel);
  if (aramidChannel && aramidChannel.isTextBased()) {
    const prefix = userID ? `<@${userID}>, ` : '';
    await aramidChannel.send({
      content: prefix + response,
      allowedMentions: { users: userID ? [userID] : [] }
    });
  }
}

async function sendFollowUpResponse(response, userID) {
  const aramidChannel = botClient.channels.cache.get(config.discord.generalAramidChannel);
  if (aramidChannel && aramidChannel.isTextBased()) {
    const prefix = userID ? `<@${userID}>, here's what I found:\n` : '';
    await aramidChannel.send({
      content: prefix + response,
      allowedMentions: { users: userID ? [userID] : [] }
    });
  }
}

async function handleMuteAction(userID, durationMinutes) {
  try {
    // Get all guilds
    for (const guild of botClient.guilds.cache.values()) {
      try {
        // Try to fetch the member directly from the guild
        const member = await guild.members.fetch(userID);
        
        if (member && member.moderatable) {
          await member.timeout(durationMinutes * 60 * 1000, 'Muted by Aramid AI');
          console.log(`Successfully muted user ${userID} for ${durationMinutes} minutes in ${guild.name}`);
          return true;
        }
      } catch (error) {
        // Log specific error for debugging
        if (error.code === 10007) {
          console.log(`User ${userID} is not in guild ${guild.name}`);
        } else {
          console.error(`Error muting user in ${guild.name}:`, error.message);
        }
        continue; // Try next guild
      }
    }
    
    throw new Error(`Could not find or mute user ${userID} in any accessible guild`);
  } catch (error) {
    console.error('Error handling mute action:', error.message);
    return false;
  }
}
