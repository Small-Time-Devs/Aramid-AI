import { 
  getTrade, 
  getActiveTrades, 
  moveTradeToPastTrades, 
  updateTradeTargets  // Make sure this function is implemented in your Dynamo module
} from '../db/dynamo.mjs';
import { executeTradeSell } from './sell.mjs';
import { fetchTokenPairs, autoTradingAdvice } from '../utils/apiUtils.mjs';
import { config } from '../config/config.mjs';
import { config as dotEnvConfig } from 'dotenv';
import { checkTokenBalance } from '../utils/solanaUtils.mjs';
import { sendTradeNotification, sendErrorNotification, sendTradeStatusUpdate, sendAIAdviceUpdate, sendTradeTargetUpdate } from '../utils/discord.mjs';
import { getTradeAdvice } from '../agents/tradeAdvice.mjs';

dotEnvConfig();

const activeTrades = new Map();
const MONITOR_INTERVAL = 5000; // 5 seconds
const MAX_REQUESTS_PER_MINUTE = 300;
const requestTimes = [];
const PRICE_CHECK_INTERVAL = 5000; // Check prices every 5 seconds
const AI_ADVICE_INTERVAL = 20000; // Get AI advice every 20 seconds
const lastAICheckTimes = new Map(); // Track last AI check time per trade

function canMakeRequest() {
  const now = Date.now();
  // Remove requests older than 1 minute
  while (requestTimes.length > 0 && requestTimes[0] < now - 60000) {
    requestTimes.shift();
  }
  return requestTimes.length < MAX_REQUESTS_PER_MINUTE;
}

function trackRequest() {
  requestTimes.push(Date.now());
}

export async function startPriceMonitoring(tradeId, initialDelay = 30000) {
  if (activeTrades.has(tradeId)) return;

  await new Promise(resolve => setTimeout(resolve, initialDelay));

  async function monitor() {
    try {
      if (!canMakeRequest()) {
        console.log('Rate limit approaching, waiting...');
        setTimeout(() => monitor(), MONITOR_INTERVAL);
        return;
      }

      const trade = await getTrade(tradeId);
      if (!trade || trade.status !== 'ACTIVE') {
        console.log(`Trade ${tradeId} no longer active, stopping monitoring`);
        activeTrades.delete(tradeId);
        return;
      }

      // First get current price and trade data
      const tokenData = await fetchTokenPairs(trade.tokenAddress);
      if (!tokenData) {
        setTimeout(() => monitor(), PRICE_CHECK_INTERVAL);
        return;
      }

      const currentPrice = tokenData.priceNative;
      const priceChangePercent = calculatePriceChange(currentPrice, trade.entryPriceSOL);

      // Process AI advice if enabled
      if (config.cryptoGlobals.askForAdviceFromAI) {
        const currentTime = Date.now();
        const lastCheckTime = lastAICheckTimes.get(tradeId) || 0;
        const timeSinceLastCheck = currentTime - lastCheckTime;

        if (timeSinceLastCheck >= AI_ADVICE_INTERVAL) {
          try {
            const parsedAdvice = await getTradeAdvice(trade, currentPrice);
            lastAICheckTimes.set(tradeId, currentTime);

            if (parsedAdvice) {
              // Create validated trade status object
              const tradeStatus = {
                tradeId: trade.tradeId,
                tokenAddress: trade.tokenAddress,
                tokenName: trade.tokenName,
                currentPrice: currentPrice?.toString() || '0',
                entryPrice: trade.entryPriceSOL?.toString() || '0',
                targetGain: trade.targetPercentageGain || 0,
                targetLoss: trade.targetPercentageLoss || 0,
                status: trade.status || 'ACTIVE'
              };

              // Only send update if we have valid data
              if (tradeStatus.tradeId && tradeStatus.currentPrice && tradeStatus.entryPrice) {
                await sendAIAdviceUpdate(parsedAdvice, tradeStatus);
              }

              // Handle trade adjustments if needed
              if (parsedAdvice.action === 'ADJUST' && parsedAdvice.adjustments) {
                const targetGain = parseFloat(parsedAdvice.adjustments.targetGain);
                const targetLoss = parseFloat(parsedAdvice.adjustments.stopLoss);

                if (!isNaN(targetGain) && !isNaN(targetLoss)) {
                  const updateResult = await updateTradeTargets(
                    trade.tradeId,
                    targetGain,
                    targetLoss
                  );

                  if (updateResult.success) {
                    await sendTradeTargetUpdate(updateResult);
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error processing AI advice:', error);
          }
        }
      }

      // Check profit/loss targets and execute sell if needed 
      const sellDecision = shouldExecuteSell(trade, currentPrice, priceChangePercent);
      if (sellDecision.shouldSell) {
        await executeSellOrder(trade, currentPrice, sellDecision.reason);
        return;
      }

      setTimeout(() => monitor(), PRICE_CHECK_INTERVAL);

    } catch (error) {
      console.error(`Error monitoring trade ${tradeId}:`, error);
      setTimeout(() => monitor(), PRICE_CHECK_INTERVAL);
    }
  }

  async function executeSellOrder(trade, currentPrice, reason = null) {
    try {
      // Verify token balance before attempting sell
      const tokenBalance = await checkTokenBalance(trade.tokenAddress);
      if (!tokenBalance || tokenBalance < trade.tokensReceived * 0.9) { // Allow 10% slippage
        console.log(`No tokens available for trade ${trade.tradeId}, removing from active trades`);
        
        // Move to past trades with appropriate status
        await moveTradeToPastTrades(trade, {
          exitPriceSOL: currentPrice,
          status: 'COMPLETED',
          reason: 'Tokens no longer available'
        });
        
        activeTrades.delete(trade.tradeId);
        return;
      }

      const sellResult = await executeTradeSell(trade, currentPrice);
      if (!sellResult.success) {
        if (sellResult.error === 'No tokens available to sell') {
          // Handle case where tokens are no longer available
          await moveTradeToPastTrades(trade, {
            exitPriceSOL: currentPrice,
            status: 'COMPLETED',
            reason: 'Tokens no longer available'
          });
          activeTrades.delete(trade.tradeId);
          return;
        }

        await sendErrorNotification('Failed to execute sell order', {
          tradeId: trade.tradeId,
          tokenAddress: trade.tokenAddress,
          currentPrice,
          error: sellResult.error
        });
        console.log(`Failed to sell trade ${trade.tradeId}, will retry...`);
        setTimeout(() => monitor(), 5000);
        return;
      }

      // Calculate actual profit/loss
      const priceChangePercent = calculatePriceChange(sellResult.exitPriceSOL, trade.entryPriceSOL);
      
      // Determine the sell reason
      const sellReason = reason || 
        (priceChangePercent > 0 ? 'Target Gain Reached' : 'Loss Target Reached');

      // Prepare notification data
      const sellNotificationData = {
        ...trade,
        exitPriceSOL: sellResult.exitPriceSOL,
        exitPriceUSD: sellResult.exitPriceUSD,
        sellPercentageGain: priceChangePercent > 0 ? priceChangePercent : null,
        sellPercentageLoss: priceChangePercent <= 0 ? Math.abs(priceChangePercent) : null,
        reason: sellReason,
        txId: sellResult.txId
      };

      // Send sell notification once
      await sendTradeNotification(sellNotificationData, 'SELL');
      
      activeTrades.delete(trade.tradeId);
      await sendTradeStatusUpdate(`Trade ${trade.tradeId} archived to past trades`, trade.tradeId);
    } catch (error) {
      console.error(`Error executing sell order for trade ${trade.tradeId}:`, error);
      setTimeout(() => monitor(), 5000);
    }
  }

  activeTrades.set(tradeId, true);
  monitor(); // Start the monitoring loop
}

// Helper functions to keep code organized
function shouldSellBasedOnTime(trade, currentTime, tradeTime) {
  if (trade.tradeType === 'INVEST') {
    return (currentTime - tradeTime) >= (config.cryptoGlobals.investHoldingTimePeriodHours * 60 * 60 * 1000);
  }
  if (trade.tradeType === 'QUICK_PROFIT') {
    return (currentTime - tradeTime) >= (config.cryptoGlobals.quickProfitHoldingTimePeriodMinutes * 60 * 1000);
  }
  return false;
}

export async function initializeTradeMonitoring() {
  try {
    console.log('Initializing trade monitoring...');
    const activeTradesFromDB = await getActiveTrades();
    
    if (activeTradesFromDB.length > 0) {
      console.log(`Found ${activeTradesFromDB.length} active trades to monitor`);
      
      for (const trade of activeTradesFromDB) {
        if (!activeTrades.has(trade.tradeId)) {
          console.log(`Starting monitoring for trade ${trade.tradeId}`);
          startPriceMonitoring(trade.tradeId);
        }
      }
    } else {
      console.log('No active trades found to monitor');
    }
  } catch (error) {
    console.error('Error initializing trade monitoring:', error);
  }
}

function calculatePriceChange(currentPrice, entryPrice) {
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

function shouldExecuteSell(trade, currentPrice, priceChange) {
  // Take profit target reached
  if (priceChange >= trade.targetPercentageGain) {
    console.log(`Taking profit at ${priceChange.toFixed(2)}% gain`);
    return {
      shouldSell: true,
      reason: 'Target Gain Reached'
    };
  }

  // Hit stop loss
  if (priceChange <= -trade.targetPercentageLoss) {
    console.log(`Stopping loss at ${priceChange.toFixed(2)}% loss`);
    return {
      shouldSell: true,
      reason: 'Loss Target Reached'
    };
  }

  // Check time-based exit
  const currentTime = Date.now();
  const tradeTime = new Date(trade.timestamp).getTime();
  
  if (shouldSellBasedOnTime(trade, currentTime, tradeTime)) {
    console.log('Time limit reached, executing sell');
    return {
      shouldSell: true,
      reason: 'Time Limit Reached'
    };
  }

  return {
    shouldSell: false
  };
}