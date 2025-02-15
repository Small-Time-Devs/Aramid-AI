import { autoTradingAdvice } from '../utils/apiUtils.mjs';
import { sendAIAdviceUpdate } from '../utils/discord.mjs';
import { updateTradeTargets } from '../db/dynamo.mjs';

export async function getTradeAdvice(trade, currentPrice) {
  try {
    const advice = await autoTradingAdvice(
      'solana',
      trade.tokenAddress,
      trade.entryPriceSOL,
      trade.targetPercentageGain,
      trade.targetPercentageLoss
    );

    // Parse the advice response
    const parsedAdvice = parseAdviceResponse(advice);
    
    // If advice is to adjust trade, update the targets in DynamoDB
    if (parsedAdvice.action === 'ADJUST' && parsedAdvice.adjustments) {
      try {
        await updateTradeTargets(
          trade.tradeId,
          parsedAdvice.adjustments.targetGain,
          parsedAdvice.adjustments.stopLoss
        );
        console.log('Successfully updated trade targets:', {
          tradeId: trade.tradeId,
          newTargetGain: parsedAdvice.adjustments.targetGain,
          newStopLoss: parsedAdvice.adjustments.stopLoss
        });
      } catch (error) {
        console.error('Failed to update trade targets:', error);
      }
    }

    // Send detailed advice to Discord
    await sendFormattedAdvice(trade.tradeId, parsedAdvice, {
      contractAddress: trade.tokenAddress,
      entryPrice: trade.entryPriceSOL,
      targetGain: parsedAdvice.adjustments?.targetGain || trade.targetPercentageGain,
      targetLoss: parsedAdvice.adjustments?.stopLoss || trade.targetPercentageLoss,
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
  try {
    // Parse the JSON if it's a string
    const parsedData = typeof advice === 'string' ? JSON.parse(advice) : advice;
    
    // Handle both array and single object formats
    const agentAdvice = Array.isArray(parsedData) ? parsedData[0] : parsedData;
    
    if (!agentAdvice?.decision) {
      console.log('Invalid advice format:', advice);
      return defaultResponse();
    }

    const { response, decision } = agentAdvice;

    // Parse decision format: "Adjust Trade: targetPercentageGain: 15, targetPercentageLoss: 10"
    const adjustMatch = decision.match(/Adjust Trade:\s*targetPercentageGain:\s*(\d+),\s*targetPercentageLoss:\s*(\d+)/i);
    const sellMatch = decision.match(/Sell Now/i);

    let action = 'HOLD';
    let adjustments = null;

    if (adjustMatch) {
      action = 'ADJUST';
      adjustments = {
        targetGain: parseInt(adjustMatch[1]),
        stopLoss: parseInt(adjustMatch[2])
      };
      console.log('Found trade adjustments:', adjustments);
    } else if (sellMatch) {
      action = 'SELL';
    }

    console.log('Parsed advice:', {
      action,
      hasAdjustments: !!adjustments,
      decision
    });

    return {
      action,
      reason: response,
      adjustments,
      formattedAdvice: response,
      rawAdvice: JSON.stringify(agentAdvice, null, 2),
      decision: decision
    };
  } catch (error) {
    console.error('Error parsing advice response:', error);
    console.error('Raw advice received:', advice);
    return defaultResponse();
  }
}

async function sendFormattedAdvice(tradeId, parsedAdvice, tradeDetails) {
  const formattedAdvice = {
    title: '🤖 Trading Analysis & Advice',
    details: parsedAdvice.reason,
    currentStatus: `Current Price: ${tradeDetails.currentPrice} SOL\n` +
                  `Entry Price: ${tradeDetails.entryPrice} SOL\n` +
                  `Target Gain: ${tradeDetails.targetGain}%\n` +
                  `Stop Loss: ${tradeDetails.targetLoss}%`,
    recommendation: `Decision: ${parsedAdvice.decision}\n` +
                   (parsedAdvice.adjustments ? 
                     `New Targets:\n` +
                     `• Target Gain: ${parsedAdvice.adjustments.targetGain}%\n` +
                     `• Stop Loss: ${parsedAdvice.adjustments.stopLoss}%` : 
                     `Action: ${parsedAdvice.action}`)
  };

  await sendAIAdviceUpdate(tradeId, formattedAdvice, tradeDetails);
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
  // Keep all section headers and content
  let formatted = advice
    .split(/(\d+\.\s+\*\*[^*]+\*\*:)/)
    .filter(Boolean)
    .map(part => part.trim())
    .join('\n');

  // Add a clear separator before the decision
  const decisionMatch = formatted.match(/((?:Adjust Trade|Hold|Sell Now).*$)/m);
  if (decisionMatch) {
    formatted = formatted.replace(
      decisionMatch[0],
      '\n**Decision:**\n' + decisionMatch[0]
    );
  }

  return formatted;
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
