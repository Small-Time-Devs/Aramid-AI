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
import { sendTradeNotification, sendErrorNotification } from '../utils/discord.mjs';

dotEnvConfig();

const activeTrades = new Map();
const MONITOR_INTERVAL = 5000; // 5 seconds
const MAX_REQUESTS_PER_MINUTE = 300;
const requestTimes = [];
const PRICE_CHECK_INTERVAL = 5000; // Check prices every 5 seconds
const AI_ADVICE_INTERVAL = 60000; // Get AI advice every 60 seconds
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

  const monitor = async () => {
    try {
      if (!canMakeRequest()) {
        console.log('Rate limit approaching, waiting...');
        setTimeout(() => monitor(), MONITOR_INTERVAL); // Retry after 1 second if rate limited
        return;
      }

      const trade = await getTrade(tradeId);
      if (!trade || trade.status !== 'ACTIVE') {
        console.log(`Trade ${tradeId} no longer active, stopping monitoring`);
        activeTrades.delete(tradeId);
        return;
      }

      // Check balance and handle zero balance scenario
      const tokenBalance = await checkTokenBalance(trade.tokenAddress, config.cryptoGlobals.publicKey);
      if (tokenBalance < 1) {
        console.log(`Trade ${tradeId} has no balance, archiving trade...`);
        const sellInfo = {
          exitPriceSOL: 0,
          exitPriceUSD: 0,
          sellPercentageGain: 0,
          sellPercentageLoss: 0,
          status: 'COMPLETED',
          reason: 'Token Balance is Dust archiving trade'
        };
        
        await moveTradeToPastTrades(trade, sellInfo);
        activeTrades.delete(tradeId);
        return;
      }

      trackRequest();
      const tokenData = await fetchTokenPairs(trade.tokenAddress);
      if (!tokenData) {
        setTimeout(() => monitor(), PRICE_CHECK_INTERVAL);
        return;
      }

      const currentPrice = tokenData.priceNative;
      const priceChangePercent = calculatePriceChange(currentPrice, trade.entryPriceSOL);

      // Always log current status
      if (config.cryptoGlobals.tradeTokenDevMode) {
        console.log(`[${new Date().toISOString()}] Trade ${tradeId} status:`, {
          currentPrice,
          priceChange: priceChangePercent,
          targetGain: trade.targetPercentageGain,
          targetLoss: trade.targetPercentageLoss
        });
      }

      // First check profit/loss targets
      if (priceChangePercent >= trade.targetPercentageGain) {
        console.log(`Taking profit at ${priceChangePercent}% gain`);
        await executeSellOrder(trade, currentPrice);
        return;
      }

      if (priceChangePercent <= -trade.targetPercentageLoss) {
        console.log(`Stopping loss at ${priceChangePercent}% loss`);
        await executeSellOrder(trade, currentPrice);
        return;
      }

      // Check time limits
      const currentTime = new Date().getTime();
      const tradeTime = new Date(trade.timestamp).getTime();
      
      if (shouldSellBasedOnTime(trade, currentTime, tradeTime)) {
        await executeSellOrder(trade, currentPrice);
        return;
      }

      // Get AI advice on current position
      if (config.cryptoGlobals.askForAdviceFromAI) {
        const lastCheckTime = lastAICheckTimes.get(tradeId) || 0;
        const timeSinceLastCheck = currentTime - lastCheckTime;

        if (timeSinceLastCheck >= AI_ADVICE_INTERVAL) {
          const advice = await autoTradingAdvice(
            'solana',
            trade.tokenAddress,
            trade.entryPriceSOL,
            trade.targetPercentageGain,
            trade.targetPercentageLoss
          );
          
          lastAICheckTimes.set(tradeId, currentTime);
          console.log(`AI advice for ${tradeId}: ${advice} CA: ${trade.tokenAddress} Entry Price: ${trade.entryPriceSOL} Target Gain: ${trade.targetPercentageGain} Target Loss: ${trade.targetPercentageLoss}`);

          // Handle advice
          if (advice.startsWith('Sell Now')) {
            await executeSellOrder(trade, currentPrice);
            return;
          } else if (advice.startsWith('Adjust Trade')) {
            await handleTradeAdjustment(trade, advice);
          }
        }
      }

      // Continue monitoring regardless of result
      setTimeout(() => monitor(), PRICE_CHECK_INTERVAL);
    } catch (error) {
      console.error(`Error monitoring trade ${tradeId}:`, error.message);
      setTimeout(() => monitor(), PRICE_CHECK_INTERVAL); // Keep monitoring even after errors
    }
  };

  async function executeSellOrder(trade, currentPrice) {
    const sellResult = await executeTradeSell(trade, currentPrice);
    if (!sellResult.success) {
      await sendErrorNotification('Failed to execute sell order', {
        tradeId: trade.tradeId,
        tokenAddress: trade.tokenAddress,
        currentPrice
      });
      console.log(`Failed to sell trade ${trade.tradeId}, will retry...`);
      setTimeout(() => monitor(), 5000);
      return;
    }

    // Calculate actual profit/loss
    const priceChangePercent = calculatePriceChange(sellResult.exitPriceSOL, trade.entryPriceSOL);
    
    // Prepare notification data
    const sellNotificationData = {
      ...trade,
      exitPriceSOL: sellResult.exitPriceSOL,
      exitPriceUSD: sellResult.exitPriceUSD,
      sellPercentageGain: priceChangePercent > 0 ? priceChangePercent : null,
      sellPercentageLoss: priceChangePercent <= 0 ? Math.abs(priceChangePercent) : null,
      reason: sellResult.reason || `${priceChangePercent > 0 ? 'Profit' : 'Loss'} Target Reached`,
      txId: sellResult.txId
    };

    // Send sell notification
    await sendTradeNotification(sellNotificationData, 'SELL');
    activeTrades.delete(trade.tradeId);
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