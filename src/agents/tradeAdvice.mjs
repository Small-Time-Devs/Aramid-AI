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

function parseAdviceResponse(response) {
  // First check if response is a string starting with '[' (JSON array)
  console.log('Parsing advice response:', response);
  if (typeof response === 'string' && response.trim().startsWith('[')) {
    try {
      const parsedArray = JSON.parse(response);
      if (Array.isArray(parsedArray) && parsedArray[0]) {
        const advice = parsedArray[0];
        
        // Check for adjustments in the decision field
        if (advice.decision && advice.decision.startsWith('Adjust Trade:')) {
          const matches = advice.decision.match(/targetPercentageGain: (\d+), targetPercentageLoss: (\d+)/);
          if (matches) {
            return {
              action: 'ADJUST',
              hasAdjustments: true,
              adjustments: {
                targetGain: parseInt(matches[1]),
                stopLoss: parseInt(matches[2])
              },
              reason: advice.response || '',
              decision: advice.decision,
              analysis: advice.response || '' // Include analysis from response field
            };
          }
        }
        
        // Return the decision with analysis from response field
        return {
          action: advice.decision.startsWith('Hold') ? 'HOLD' : 'SELL',
          hasAdjustments: false,
          reason: advice.response || '',
          decision: advice.decision,
          analysis: advice.response || '' // Include analysis from response field
        };
      }
    } catch (e) {
      console.error('Error parsing JSON array response:', e);
    }
  }

  // Handle existing plain text formats
  if (typeof response === 'string') {
    if (response.startsWith('Adjust Trade:')) {
      const matches = response.match(/targetPercentageGain: (\d+), targetPercentageLoss: (\d+)/);
      if (matches) {
        return {
          action: 'ADJUST',
          hasAdjustments: true,
          adjustments: {
            targetGain: parseInt(matches[1]),
            stopLoss: parseInt(matches[2])
          }
        };
      }
    }
    
    if (response === 'Hold') {
      return {
        action: 'HOLD',
        hasAdjustments: false,
        decision: 'Hold'
      };
    }
  }

  // Try parsing as regular JSON object
  try {
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    console.log('Raw advice received:', response);
    
    // Default to hold if we can't parse the response
    return {
      action: 'HOLD',
      hasAdjustments: false,
      decision: 'Hold' 
    };
  }
}

async function sendFormattedAdvice(tradeId, parsedAdvice, tradeDetails) {
  // Log the incoming parsed advice for debugging
  console.log('Formatting advice:', JSON.stringify(parsedAdvice, null, 2));

  const formattedAdvice = {
    title: '🤖 Trading Analysis & Advice',
    details: parsedAdvice.analysis || parsedAdvice.reason || 'No detailed analysis available',
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

  // Log the formatted advice before sending
  console.log('Sending formatted advice:', JSON.stringify(formattedAdvice, null, 2));

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
