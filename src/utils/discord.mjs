import { WebhookClient } from 'discord.js';
import { config } from '../config/config.mjs';

// Initialize Discord webhook client
const webhookClient = new WebhookClient({ url: config.discord.webhookUrl });

export async function sendTradeNotification(tradeData, type = 'BUY') {
  try {
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
      embed.fields.push(
        {
          name: 'Exit Price (SOL)',
          value: tradeData.exitPriceSOL.toFixed(9),
          inline: true
        },
        {
          name: 'Profit/Loss %',
          value: `${tradeData.sellPercentageGain ? '+' + tradeData.sellPercentageGain.toFixed(2) : tradeData.sellPercentageLoss.toFixed(2)}%`,
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

    await webhookClient.send({
      embeds: [embed]
    });

    console.log(`${type} trade notification sent to Discord successfully`);
    return true;
  } catch (error) {
    console.error('Error sending Discord notification:', error);
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

    await webhookClient.send({
      embeds: [embed]
    });

    return true;
  } catch (error) {
    console.error('Error sending error notification:', error);
    return false;
  }
}
