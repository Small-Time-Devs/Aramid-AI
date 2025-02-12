import { WebhookClient, Client, GatewayIntentBits, Events, PermissionsBitField } from 'discord.js';
import { config } from '../config/config.mjs';

// Initialize Discord bot client with basic intents
export const botClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

// Bot ready event
botClient.once(Events.ClientReady, async c => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
  
  // Send startup message to a specific channel if configured
  if (config.discord.hiveChannel) {
    try {
      const channel = c.channels.cache.get(config.discord.hiveChannel);
      if (!channel) {
        console.error('Could not find the specified channel');
        return;
      }

      // Check if bot has permission to send messages
      if (channel.isTextBased() && 
          channel.permissionsFor(c.user)?.has(PermissionsBitField.Flags.SendMessages)) {
        await channel.send('🟢 Bot is now online and ready!');
      } else {
        console.error('Bot does not have permission to send messages in this channel');
      }
    } catch (error) {
      console.error('Error sending startup message:', error.message);
    }
  }
});

// Initialize bot with token
export function initializeDiscordBot() {
  if (!config.discord.botToken) {
    console.error('Discord bot token not found in config!');
    return;
  }
  botClient.login(config.discord.botToken);
}

export async function sendTradeNotification(tradeData, type = 'BUY') {
  try {
    // Create embed exactly as before
    const embed = createTradeEmbed(tradeData, type);

    // Find the configured trade channel
    const channel = botClient.channels.cache.get(config.discord.tradeChannel);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
      console.log(`${type} trade notification sent to Discord successfully`);
      return true;
    }
    
    console.error('Could not find trade channel or channel is not text-based');
    return false;
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

export async function sendAIAdviceUpdate(tradeId, advice, tradeDetails) {
  try {
    const embed = {
      title: '🧠 AI Trading Advice',
      color: 0x9933ff, // Purple color for AI
      fields: [
        {
          name: 'Trade ID',
          value: tradeId,
          inline: true
        },
        {
          name: 'Advice',
          value: advice,
          inline: true
        },
        {
          name: 'Contract Address',
          value: tradeDetails.contractAddress,
          inline: false
        },
        {
          name: 'Entry Price',
          value: `${tradeDetails.entryPrice} SOL`,
          inline: true
        },
        {
          name: 'Target Gain',
          value: `${tradeDetails.targetGain}%`,
          inline: true
        },
        {
          name: 'Stop Loss',
          value: `${tradeDetails.targetLoss}%`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Aramid AI-X Trading Bot'
      }
    };

    const channel = botClient.channels.cache.get(config.discord.tradeChannel);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
      return true;
    }
    return false;
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
