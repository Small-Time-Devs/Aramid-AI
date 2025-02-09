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

dotEnvConfig();

const activeTrades = new Map();
const MONITOR_INTERVAL = 5000; // 5 seconds
const MAX_REQUESTS_PER_MINUTE = 300;
const requestTimes = [];

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
        setTimeout(() => monitor(), 1000); // Retry after 1 second if rate limited
        return;
      }

      const trade = await getTrade(tradeId);
      if (!trade || trade.status !== 'ACTIVE') {
        console.log(`Trade ${tradeId} no longer active, stopping monitoring`);
        activeTrades.delete(tradeId);
        return;
      }

      // Check balance and fetch price data
      const tokenBalance = await checkTokenBalance(trade.tokenAddress, config.cryptoGlobals.publicKey);
      if (tokenBalance < 1) {
        console.log(`No balance found for trade ${tradeId}, will retry...`);
        setTimeout(() => monitor(), 5000); // Retry every 5 seconds
        return;
      }

      trackRequest();
      const tokenData = await fetchTokenPairs(trade.tokenAddress);
      if (!tokenData) {
        setTimeout(() => monitor(), 5000);
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
        const advice = await autoTradingAdvice(
          'solana',
          trade.tokenAddress,
          trade.entryPriceSOL,
          trade.targetPercentageGain,
          trade.targetPercentageLoss
        );
        
        console.log(`AI advice for ${tradeId}: ${advice} CA: ${trade.tokenAddress} Entry Price: ${trade.entryPriceSOL} Target Gain: ${trade.targetPercentageGain} Target Loss: ${trade.targetPercentageLoss}`);

        // Handle advice
        if (advice.startsWith('Sell Now')) {
          await executeSellOrder(trade, currentPrice);
          return;
        } else if (advice.startsWith('Adjust Trade')) {
          await handleTradeAdjustment(trade, advice);
        }
      }

      // Continue monitoring regardless of result
      setTimeout(() => monitor(), 5000);
    } catch (error) {
      console.error(`Error monitoring trade ${tradeId}:`, error.message);
      setTimeout(() => monitor(), 5000); // Keep monitoring even after errors
    }
  };

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

async function executeSellOrder(trade, currentPrice) {
  const sellResult = await executeTradeSell(trade, currentPrice);
  if (!sellResult.success) {
    console.log(`Failed to sell trade ${trade.tradeId}, will retry...`);
    setTimeout(() => monitor(), 5000);
    return;
  }
  activeTrades.delete(trade.tradeId);
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