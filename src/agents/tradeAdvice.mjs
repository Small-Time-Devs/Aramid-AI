import { autoTradingAdvice } from '../utils/apiUtils.mjs';
import { sendAIAdviceUpdate } from '../utils/discord.mjs';

export async function getTradeAdvice(trade, currentPrice) {
  try {
    const advice = await autoTradingAdvice(
      'solana',
      trade.tokenAddress,
      trade.entryPriceSOL,
      trade.targetPercentageGain,
      trade.targetPercentageLoss
    );

    // Format and parse the advice
    const parsedAdvice = parseAdviceResponse(advice);
    
    // Send detailed advice to Discord
    await sendFormattedAdvice(trade.tradeId, parsedAdvice, {
      contractAddress: trade.tokenAddress,
      entryPrice: trade.entryPriceSOL,
      targetGain: trade.targetPercentageGain,
      targetLoss: trade.targetPercentageLoss,
      currentPrice: currentPrice
    });

    return parsedAdvice;
  } catch (error) {
    console.error('Error getting trade advice:', error);
    return {
      action: 'HOLD',
      reason: 'Error getting advice',
      formattedAdvice: 'Unable to get trading advice'
    };
  }
}

function parseAdviceResponse(advice) {
  if (!advice) return defaultResponse();

  // Extract the Final Output section
  const finalOutputMatch = advice.match(/\*\*Final Output\*\*:\s*(.*?)(?=\n|$)/s);
  const finalOutput = finalOutputMatch ? finalOutputMatch[1].trim() : '';

  // Determine action based on Final Output
  let action = 'HOLD';
  let adjustments = null;
  let reason = '';

  if (finalOutput.startsWith('Sell Now')) {
    action = 'SELL';
    reason = extractReason(finalOutput);
  } else if (finalOutput.startsWith('Adjust Trade')) {
    action = 'ADJUST';
    adjustments = extractAdjustmentsFromFinalOutput(finalOutput);
  }

  return {
    action,
    reason,
    adjustments,
    formattedAdvice: formatDetailedAdvice(advice),
    rawAdvice: finalOutput
  };
}

function extractAdjustmentsFromFinalOutput(finalOutput) {
  const gainMatch = finalOutput.match(/targetPercentageGain:\s*(\d+)/);
  const lossMatch = finalOutput.match(/targetPercentageLoss:\s*(\d+)/);

  // Only return adjustments if at least one value is found
  const targetGain = gainMatch ? parseInt(gainMatch[1]) : null;
  const stopLoss = lossMatch ? parseInt(lossMatch[1]) : null;

  if (!targetGain && !stopLoss) return null;

  return {
    targetGain,
    stopLoss
  };
}

function formatDetailedAdvice(advice) {
  // Split the advice into sections
  const sections = advice.split(/\d+\.\s+\*\*/).filter(Boolean);
  
  // Process and truncate each section to fit Discord limits
  const processedSections = sections.map(section => {
    const title = section.match(/^([^:]+):/);
    if (title) {
      const content = section.replace(title[0], '').trim();
      // Truncate content if needed
      const truncatedContent = content.length > 900 ? 
        content.substring(0, 900) + '...(truncated)' : 
        content;
      return `${title[1]}:\n${truncatedContent}\n`;
    }
    return section.length > 900 ? 
      section.substring(0, 900) + '...(truncated)' : 
      section.trim();
  });

  return processedSections.join('\n');
}

async function sendFormattedAdvice(tradeId, parsedAdvice, tradeDetails) {
  // Truncate and split long text fields
  const details = truncateField(parsedAdvice.formattedAdvice, 1000);
  const recommendation = truncateField(
    `Action: ${parsedAdvice.action}\n` +
    `${parsedAdvice.reason ? 'Reason: ' + parsedAdvice.reason + '\n' : ''}` +
    (parsedAdvice.adjustments ? 
      `Suggested Adjustments:\n` +
      `- New Target Gain: ${parsedAdvice.adjustments.targetGain}%\n` +
      `- New Stop Loss: ${parsedAdvice.adjustments.stopLoss}%` : ''),
    1000
  );

  const formattedAdvice = {
    title: '🤖 Trading Analysis & Advice',
    details,
    currentStatus: `Current Price: ${tradeDetails.currentPrice} SOL\n` +
                  `Entry Price: ${tradeDetails.entryPrice} SOL\n` +
                  `Target Gain: ${tradeDetails.targetGain}%\n` +
                  `Stop Loss: ${tradeDetails.targetLoss}%`,
    recommendation
  };

  await sendAIAdviceUpdate(tradeId, formattedAdvice, tradeDetails);
}

function truncateField(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? 
    text.substring(0, maxLength - 3) + '...' : 
    text;
}

function defaultResponse() {
  return {
    action: 'HOLD',
    reason: 'No advice available',
    adjustments: null,
    formattedAdvice: 'Unable to analyze trade',
    rawAdvice: ''
  };
}
