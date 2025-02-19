import { WebhookClient, Client, GatewayIntentBits, Events, PermissionsBitField, EmbedBuilder } from 'discord.js';
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
  // Only ignore own messages and error messages outside of trade channel
  if ((message.channelId !== config.discord.tradeChannel) && 
      (message.author.id === botClient.user.id 
      || message.content.includes('🟢 Bot is back online')
      //|| message.content.startsWith('🔄 Learning and Retrying')
      //|| message.content.startsWith('📊 Trade Status Update')
      //|| message.content.startsWith('🧠 AI Trading Analysis')
      //|| message.content.startsWith('🐦 New Tweet Posted')
      || message.content.includes('Sorry, I encountered an error processing your message'))
      || message.content.includes('I apologize, but I encountered an error processing your request. Please try again.')
      && config.discord.generalAramidChannel) {
    return;
  }

  // Add random response chance for cortexAI messages in generalAramidChannel
  if (message.author.bot && 
      message.author.id === config.discord.cortexAI &&
      message.channelId === config.discord.generalAramidChannel) {
    // 30% chance to respond
    if (Math.random() > 0.3) {
      console.log('Randomly chose not to respond to Cortex-AI message');
      return;
    }
  }

  if (message.author.bot && !config.discord.allowBotMessagesChannels.includes(message.channelId)) {
    console.log('Message ignored - Bot message');
    return;
  }

  if (!config.discord.monitoredChannels.includes(message.channelId)) {
    console.log('Message ignored - Not in monitored channels');
    return;
  }

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
        try {
          const response = await getAIResponse("I've just been restarted.");
          if (response) {
            await channel.send('🟢 **Bot Restarted!**\n\n' + response);
          }
        } catch (error) {
          console.error('Error getting AI startup message:', error);
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

    // Determine which channel to use based on message type
    let targetChannel;
    
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
        targetChannel = config.discord.hiveChannel; // Use trade channel for token analysis
        break;

      case 'analysis':
        embed.title = '🤖 AI Analysis Results';
        embed.color = 0x9b59b6; // Purple
        embed.fields = [
          {
            name: 'Full Analysis',
            value: (data.analysis || 'No analysis provided').substring(0, 1024),
            inline: false
          }
        ];

        if (data.analysis && data.analysis.length > 1024) {
          const remainingAnalysis = data.analysis.substring(1024);
          const chunks = splitAdvice(remainingAnalysis, 1024);
          chunks.forEach((chunk, index) => {
            embed.fields.push({
              name: `Analysis (continued ${index + 1})`,
              value: chunk,
              inline: false
            });
          });
        }

        if (data.decision) {
          embed.fields.push({
            name: 'Investment Decision',
            value: data.decision,
            inline: false
          });
        }
        targetChannel = config.discord.hiveChannel; // Use hive channel for analysis
        break;
    }

    // Find the configured channel based on message type
    const channel = botClient.channels.cache.get(targetChannel);
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

    const channel = botClient.channels.cache.get(config.discord.hiveChannel);
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

export async function sendAIAdviceUpdate(advice, tradeDetails) {
  try {
    const channel = botClient.channels.cache.get(config.discord.hiveChannel);
    if (!channel || !channel.isTextBased()) return;

    // Validate required fields
    if (!tradeDetails?.tradeId || !tradeDetails?.currentPrice || !tradeDetails?.entryPrice) {
      console.log('Missing required trade details');
      return;
    }

    // Calculate current percentage change
    const currentChange = ((parseFloat(tradeDetails.currentPrice) - parseFloat(tradeDetails.entryPrice)) 
                          / parseFloat(tradeDetails.entryPrice)) * 100;

    const fields = [
      {
        name: 'Trade ID',
        value: tradeDetails.tradeId || 'Unknown',
        inline: true
      },
      {
        name: 'Token',
        value: tradeDetails.tokenName || 'Unknown Token',
        inline: true
      }
    ];

    // Only add status field if we have required data
    const statusValue = [
      `Current Price: ${tradeDetails.currentPrice} SOL`,
      `Entry Price: ${tradeDetails.entryPrice} SOL`,
      `Current P/L: ${currentChange >= 0 ? '+' : ''}${currentChange.toFixed(2)}%`,
      `Target Gain: ${tradeDetails.targetGain}%`,
      `Stop Loss: ${tradeDetails.targetLoss}%`
    ].join('\n');

    fields.push({
      name: 'Status',
      value: statusValue,
      inline: false
    });

    // Add recommendation field if we have advice
    if (advice?.action) {
      const recValue = advice.action === 'ADJUST' ?
        `New Targets:\n• Target Gain: ${advice.adjustments?.targetGain}%\n• Stop Loss: ${advice.adjustments?.stopLoss}%` :
        `Action: ${advice.action}`;

      fields.push({
        name: 'Recommendation',
        value: recValue,
        inline: false
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🤖 AI Trading Analysis')
      .setDescription('Latest trade analysis and recommendations');

    // Add validated fields
    embed.addFields(fields);
    embed.setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error sending AI advice update:', error);
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

export async function sendTradeTargetUpdate(updateResult) {
  try {
    const hiveChannel = botClient.channels.cache.get(config.discord.hiveChannel);
    if (!hiveChannel) {
      console.error('Hive channel not found');
      return;
    }

    // Validate that we have both old and new values
    if (!updateResult?.oldValues?.gain || !updateResult?.newValues?.gain) {
      console.error('Missing target values in update result:', updateResult);
      return;
    }

    // Only send notification if values actually changed
    if (updateResult.oldValues.gain === updateResult.newValues.gain && 
        updateResult.oldValues.loss === updateResult.newValues.loss) {
      console.log('Trade targets unchanged, skipping notification');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#FFD700')  // Gold color for target updates
      .setTitle('🎯 Trade Targets Updated')
      .addFields(
        { 
          name: 'Token Name', 
          value: updateResult.tokenName || 'N/A', 
          inline: true 
        },
        { 
          name: 'Previous Targets', 
          value: `Gain: ${updateResult.oldValues.gain}%\nLoss: ${updateResult.oldValues.loss}%`, 
          inline: true 
        },
        { 
          name: 'New Targets', 
          value: `Gain: ${updateResult.newValues.gain}%\nLoss: ${updateResult.newValues.loss}%`, 
          inline: true 
        }
      )
      .setTimestamp();

    await hiveChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error sending trade target update:', error);
  }
}
