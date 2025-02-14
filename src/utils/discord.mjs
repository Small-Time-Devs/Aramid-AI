import { WebhookClient, Client, GatewayIntentBits, Events, PermissionsBitField } from 'discord.js';
import { config } from '../config/config.mjs';
import { getAIResponse } from '../agents/aramidGeneral.mjs';

// Update intents to include all required permissions
export const botClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ]
});

// Initialize bot with token
export function initializeDiscordBot() {
  if (!config.discord.botToken) {
    console.error('Discord bot token not found in config!');
    return;
  }
  botClient.login(config.discord.botToken);
}

// Helper function to split long messages
function splitResponse(response, maxLength = 1900) { // Using 1900 to leave room for mentions
  if (!response || typeof response !== 'string') {
    return ['No response available'];
  }

  const chunks = [];
  let remainingText = response;

  while (remainingText.length > 0) {
    if (remainingText.length <= maxLength) {
      chunks.push(remainingText);
      break;
    }

    let chunk = remainingText.slice(0, maxLength);
    let splitIndex = chunk.lastIndexOf('\n\n');
    
    if (splitIndex === -1) {
      splitIndex = chunk.lastIndexOf('. ');
    }
    if (splitIndex === -1) {
      splitIndex = chunk.lastIndexOf(' ');
    }
    if (splitIndex === -1 || splitIndex === 0) {
      splitIndex = maxLength;
    }
    
    chunks.push(remainingText.slice(0, splitIndex));
    remainingText = remainingText.slice(splitIndex).trim();
  }
  return chunks;
}

// Add message event handler
botClient.on(Events.MessageCreate, async message => {
  // Check if message is from a bot and in a channel that should filter bot messages
  if (message.author.bot && !config.discord.allowBotMessagesChannels.includes(message.channelId)) {
    console.log('Message ignored - Bot message');
    return;
  }

  if (!config.discord.monitoredChannels.includes(message.channelId)) {
    console.log('Message ignored - Not in monitored channels');
    return;
  }

  // Add check for empty messages
  //if (!message.content || message.content.trim() === '') {
  //  console.log('Message ignored - Empty content');
  //  return;
  //}

  try {
    let contentToProcess = [];
    
    // Add text content if it exists
    if (message.content?.trim()) {
      contentToProcess.push(message.content.trim());
    }

    // Check for image attachments
    if (message.attachments.size > 0) {
      const imageAttachments = message.attachments.filter(att => 
        att.contentType?.startsWith('image/'));
      
      if (imageAttachments.size > 0) {
        const imageUrls = imageAttachments.map(img => img.url);
        contentToProcess.push(`[Images: ${imageUrls.join(', ')}]`);
      }
    }

    // Check for embeds (like Twitter posts)
    if (message.embeds?.length > 0) {
      message.embeds.forEach(embed => {
        if (embed.description) {
          contentToProcess.push(`[Embed: ${embed.description}]`);
        }
        if (embed.title) {
          contentToProcess.push(`[Title: ${embed.title}]`);
        }
        if (embed.fields?.length > 0) {
          embed.fields.forEach(field => {
            contentToProcess.push(`[${field.name}: ${field.value}]`);
          });
        }
      });
    }

    // Only skip if there's nothing to process after checking all possible content
    if (contentToProcess.length === 0) {
      console.log('Message ignored - No processable content');
      return;
    }

    const textToProcess = contentToProcess.join('\n');
    console.log('Processing content:', textToProcess);
    const response = await getAIResponse(textToProcess, message.author.id);
    
    const aramidChannel = botClient.channels.cache.get(config.discord.generalAramidChannel);
    if (!aramidChannel || !aramidChannel.isTextBased()) {
      console.error('Could not find Aramid channel or channel is not text-based');
      return;
    }

    // Split response if needed and send in chunks
    const chunks = splitResponse(response);
    const prefix = `<@${message.author.id}> from <#${message.channel.id}>:\n`;
    
    // Send first chunk with prefix
    await aramidChannel.send({
      content: prefix + chunks[0],
      allowedMentions: { users: [message.author.id] }
    });

    // Send remaining chunks if any
    for (let i = 1; i < chunks.length; i++) {
      await aramidChannel.send({ content: chunks[i] });
    }
    
    console.log('Response sent successfully');
  } catch (error) {
    console.error('Error processing message:', error);
    const aramidChannel = botClient.channels.cache.get(config.discord.generalAramidChannel);
    if (aramidChannel && aramidChannel.isTextBased()) {
      await aramidChannel.send(
        `<@${message.author.id}> Sorry, I encountered an error processing your message from <#${message.channel.id}>.`
      );
    }
  }
});

// Bot ready event
botClient.once(Events.ClientReady, async c => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
  
  if (config.discord.generalAramidChannel) {
    try {
      const channel = c.channels.cache.get(config.discord.generalAramidChannel);
      if (!channel) {
        console.error('Could not find the specified channel');
        return;
      }

      if (channel.isTextBased() && 
          channel.permissionsFor(c.user)?.has(PermissionsBitField.Flags.SendMessages)) {
        // Get AI response for startup message
        try {
          const response = await getAIResponse("I've just been restarted.");
          await channel.send('🟢 Bot is back online and ready to assist! ' + response);
        } catch (error) {
          console.error('Error getting AI startup message:', error);
          await channel.send('🟢 Bot is back online and ready to assist!');
        }
      } else {
        console.error('Bot does not have permission to send messages in this channel');
      }
    } catch (error) {
      console.error('Error sending startup message:', error.message);
    }
  }
});

// Add cache for recent notifications
const recentNotifications = new Map();

export async function sendTradeNotification(tradeData, type = 'BUY') {
  try {
    // Create unique key for this notification
    const notificationKey = `${type}-${tradeData.tokenAddress}-${Date.now()}`;
    
    // Check if similar notification was sent in last 5 seconds
    const recentKey = Array.from(recentNotifications.keys()).find(key => {
      const [prevType, prevToken] = key.split('-');
      return prevType === type && 
             prevToken === tradeData.tokenAddress && 
             (Date.now() - recentNotifications.get(key)) < 5000;
    });

    if (recentKey) {
      console.log('Duplicate notification prevented');
      return false;
    }

    // Store notification timestamp
    recentNotifications.set(notificationKey, Date.now());

    // Clean old entries
    const fiveSecondsAgo = Date.now() - 5000;
    for (const [key, timestamp] of recentNotifications.entries()) {
      if (timestamp < fiveSecondsAgo) {
        recentNotifications.delete(key);
      }
    }

    // Create embed
    const embed = createTradeEmbed(tradeData, type);

    // Only send to trade channel
    const channel = botClient.channels.cache.get(config.discord.tradeChannel);
    if (!channel || !channel.isTextBased()) {
      console.error('Could not find trade channel or channel is not text-based');
      return false;
    }

    await channel.send({ embeds: [embed] });
    console.log(`${type} trade notification sent to Discord successfully`);
    return true;
  } catch (error) {
    console.error('Error sending trade notification:', error);
    return false;
  }
}

export async function sendErrorNotification(errorMessage, context = {}) {
  try {
    const embed = {
      title: '❌ Trading Error',
      color: 0xff6b6b,
      description: errorMessage,
      fields: Object.entries(context).map(([key, value]) => ({
        name: key,
        value: String(value),
        inline: true
      })),
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Aramid AI-X Trading Bot'
      }
    };

    // Find the configured trade channel
    const channel = botClient.channels.cache.get(config.discord.tradeChannel);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error sending error notification:', error);
    return false;
  }
}

// Helper function to create trade embed (moved from sendTradeNotification)
function createTradeEmbed(tradeData, type) {
  // Validate required fields
  const requiredFields = ['tokenName', 'tokenAddress', 'tradeType'];
  const missingFields = requiredFields.filter(field => !tradeData[field]);
  
  if (missingFields.length > 0) {
    console.warn('Missing required fields:', missingFields);
    // Set fallback values for missing fields
    tradeData = {
      tokenName: tradeData.tokenName || 'Unknown Token',
      tokenAddress: tradeData.tokenAddress || 'N/A',
      tradeType: tradeData.tradeType || 'Unknown',
      ...tradeData
    };
  }

  const color = type === 'BUY' ? 0x00ff00 : 0xff0000; // Green for buy, Red for sell
  
  const embed = {
    title: `${type} Trade Executed`,
    color: color,
    fields: [
      {
        name: 'Token Name',
        value: String(tradeData.tokenName || 'Unknown Token'),
        inline: true
      },
      {
        name: 'Token Address',
        value: String(tradeData.tokenAddress || 'N/A'),
        inline: true
      },
      {
        name: 'Trade Type',
        value: String(tradeData.tradeType || 'N/A'),
        inline: true
      }
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Aramid AI-X Trading Bot'
    }
  };

  // Rest of the embed creation logic (fields for BUY/SELL) remains the same
  // Ensure numeric values are properly formatted
  const formatNumber = (num) => num ? Number(num).toFixed(num < 0.001 ? 9 : 4) : '0';

  // Add trade-specific fields based on type
  if (type === 'BUY') {
    const fields = [
      {
        name: 'Amount Invested (SOL)',
        value: String(formatNumber(tradeData.amountInvested || 0)),
        inline: true
      },
      {
        name: 'Entry Price (SOL)',
        value: String(formatNumber(tradeData.entryPriceSOL || 0)),
        inline: true
      },
      {
        name: 'Tokens Received',
        value: String(tradeData.tokensReceived || '0'),
        inline: true
      },
      {
        name: 'Target Gain %',
        value: String(`${tradeData.targetPercentageGain || 0}%`),
        inline: true
      },
      {
        name: 'Stop Loss %',
        value: String(`${tradeData.targetPercentageLoss || 0}%`),
        inline: true
      }
    ];
    embed.fields.push(...fields);
  } else if (type === 'SELL') {
    // Validate and sanitize numeric values
    const sanitizeNumber = (num) => {
      if (typeof num === 'string') num = parseFloat(num);
      return typeof num === 'number' && !isNaN(num) ? num : 0;
    };

    // Ensure all numeric fields are properly formatted
    const exitPriceSOL = sanitizeNumber(tradeData.exitPriceSOL);
    const sellPercentageGain = sanitizeNumber(tradeData.sellPercentageGain);
    const sellPercentageLoss = sanitizeNumber(tradeData.sellPercentageLoss);

    // Update the sell-specific fields with proper number handling
    embed.fields.push(
      {
        name: 'Exit Price (SOL)',
        value: exitPriceSOL.toFixed(9),
        inline: true
      },
      {
        name: 'Profit/Loss %',
        value: `${sellPercentageGain ? '+' + sellPercentageGain.toFixed(2) : '-' + sellPercentageLoss.toFixed(2)}%`,
        inline: true
      },
      {
        name: 'Reason',
        value: tradeData.reason || 'Target Reached',
        inline: true
      }
    );
  }

  // Add transaction ID if available
  if (tradeData.txId) {
    embed.fields.push({
      name: 'Transaction',
      value: `[View on Solscan](https://solscan.io/tx/${tradeData.txId})`,
      inline: true
    });
  }

  // For sell notifications, ensure proper profit/loss display
  if (type === 'SELL') {
    const profitLoss = tradeData.sellPercentageGain || -tradeData.sellPercentageLoss;
    embed.fields.push({
      name: 'Profit/Loss %',
      value: `${profitLoss > 0 ? '+' : ''}${profitLoss.toFixed(2)}%`,
      inline: true
    });
  }

  return embed;
}

export async function sendAnalysisMessage(type, data) {
  try {
    let embed = {
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Aramid AI-X Trading Bot'
      }
    };

    switch(type) {
      case 'token':
        embed.title = '🔍 New Token Analysis';
        embed.color = 0x3498db; // Blue
        embed.fields = [
          {
            name: 'Token Address',
            value: data.tokenAddress || 'N/A',
            inline: true
          },
          {
            name: 'Chain ID',
            value: data.chainId || 'N/A',
            inline: true
          }
        ];
        break;

      case 'analysis':
        embed.title = '🤖 AI Analysis Results';
        embed.color = 0x9b59b6; // Purple
        embed.fields = [
          {
            name: 'Analyst Review',
            value: data.analysis || 'No analysis provided',
            inline: false
          },
          {
            name: 'Investment Recommendation',
            value: data.investment || 'No recommendation provided',
            inline: false
          },
          {
            name: 'Decision',
            value: data.decision || 'No decision provided',
            inline: false
          }
        ];
        break;
    }

    // Find the configured channel
    const channel = botClient.channels.cache.get(config.discord.hiveChannel);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error sending analysis message:', error);
    return false;
  }
}

export async function sendRetryNotification() {
  try {
    const embed = {
      title: '🔄 Learning and Retrying',
      color: 0xffa500, // Orange color
      description: "I'm currently learning! My overlord didn't like my response, so I'm looking for something new to analyze.",
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Aramid AI-X Trading Bot'
      }
    };

    const channel = botClient.channels.cache.get(config.discord.hiveChannel);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error sending retry notification:', error);
    return false;
  }
}

export async function sendTradeStatusUpdate(message, tradeId = null) {
  try {
    const embed = {
      title: '📊 Trade Status Update',
      color: 0x2ecc71, // Green color
      description: message,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Aramid AI-X Trading Bot'
      }
    };

    if (tradeId) {
      embed.fields = [{
        name: 'Trade ID',
        value: tradeId,
        inline: true
      }];
    }

    const channel = botClient.channels.cache.get(config.discord.tradeChannel);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error sending trade status update:', error);
    return false;
  }
}

// Add helper function to split long advice
function splitAdvice(advice, maxLength = 1000) {
  const parts = [];
  let currentPart = '';
  const lines = advice.split('\n');

  for (const line of lines) {
    if ((currentPart + '\n' + line).length > maxLength && currentPart) {
      parts.push(currentPart);
      currentPart = line;
    } else {
      currentPart = currentPart ? currentPart + '\n' + line : line;
    }
  }
  
  if (currentPart) {
    parts.push(currentPart);
  }
  
  return parts;
}

export async function sendAIAdviceUpdate(tradeId, advice, tradeDetails) {
  try {
    // Format advice object
    let formattedAdvice = 'No advice available';
    
    if (advice) {
      if (typeof advice === 'object') {
        // Convert object to readable string
        formattedAdvice = JSON.stringify(advice, null, 2)
          .replace(/[{}"]/g, '')
          .trim()
          .split('\n')
          .map(line => line.trim())
          .filter(line => line) // Remove empty lines
          .join('\n');
      } else {
        formattedAdvice = String(advice);
      }
    }

    // Format trade details
    const tradeInfo = `Entry Price: ${tradeDetails.entryPrice || 'N/A'}\n` +
                     `Target Gain: ${tradeDetails.targetGain || 'N/A'}%\n` +
                     `Stop Loss: ${tradeDetails.targetLoss || 'N/A'}%`;

    // Create base embed
    const baseEmbed = {
      title: '🧠 AI Trading Advice',
      color: 0x9933ff,
      fields: [
        {
          name: 'Trade ID',
          value: tradeId || 'Unknown',
          inline: true
        },
        {
          name: 'Contract Address',
          value: tradeDetails.contractAddress || 'Unknown',
          inline: true
        },
        {
          name: 'Trade Parameters',
          value: tradeInfo,
          inline: false
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Aramid AI-X Trading Bot'
      }
    };

    const channel = botClient.channels.cache.get(config.discord.hiveChannel);
    if (!channel || !channel.isTextBased()) return false;

    // Split advice into parts if needed
    const adviceParts = splitAdvice(formattedAdvice);

    // Send first part with base embed
    if (adviceParts.length > 0) {
      const firstEmbed = {
        ...baseEmbed,
        fields: [
          ...baseEmbed.fields,
          {
            name: 'AI Advice (Part 1)',
            value: adviceParts[0],
            inline: false
          }
        ]
      };
      await channel.send({ embeds: [firstEmbed] });
    }

    // Send remaining parts as follow-up messages
    for (let i = 1; i < adviceParts.length; i++) {
      const followUpEmbed = {
        color: 0x9933ff,
        fields: [
          {
            name: `AI Advice (Part ${i + 1})`,
            value: adviceParts[i],
            inline: false
          }
        ]
      };
      await channel.send({ embeds: [followUpEmbed] });
    }

    console.log('AI advice sent:', { 
      tradeId, 
      partsCount: adviceParts.length,
      tradeDetails 
    });
    return true;
  } catch (error) {
    console.error('Error sending AI advice update:', error);
    return false;
  }
}

export async function sendTwitterUpdate(type, content) {
  try {
    const embed = {
      title: type === 'tweet' ? '🐦 New Tweet Posted' : '💬 Reply Posted',
      color: 0x1DA1F2, // Twitter blue color
      description: content,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Aramid AI-X Twitter Bot'
      }
    };

    const channel = botClient.channels.cache.get(config.discord.twitterChannel);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error sending Twitter update:', error);
    return false;
  }
}
