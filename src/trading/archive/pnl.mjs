import { getTrade, getActiveTrades, moveTradeToPastTrades } from '../db/dynamo.mjs';
import { executeTradeSell } from './sell.mjs';
import { fetchTokenPairs } from '../utils/apiUtils.mjs';
import { config } from '../config/config.mjs';
import { config as dotEnvConfig} from 'dotenv';
import { checkTokenBalance } from '../utils/solanaUtils.mjs';

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

export async function startPriceMonitoring(tradeId) {
  if (activeTrades.has(tradeId)) return;

  const monitor = async () => {
    try {
      if (!canMakeRequest()) {
        console.log('Rate limit approaching, skipping this check');
        setTimeout(() => monitor(), MONITOR_INTERVAL);
        return;
      }

      const trade = await getTrade(tradeId);
      // Only stop monitoring if trade is not found or explicitly marked as not active
      if (!trade) {
        console.log(`Trade ${tradeId} not found - it may have been completed or removed`);
        activeTrades.delete(tradeId);
        return;
      }

      if (trade.status !== 'ACTIVE') {
        console.log(`Trade ${tradeId} is no longer active, stopping monitoring`);
        activeTrades.delete(tradeId);
        return;
      }

      // Check token balance before proceeding
      let tokenBalance;
      try {
        tokenBalance = await checkTokenBalance(
          trade.tokenAddress, 
          config.cryptoGlobals.publicKey
        );
      } catch (balanceError) {
        if (balanceError.message?.includes('No token account found')) {
          console.log(`No token account found for ${trade.tokenAddress}, archiving trade...`);
          await moveTradeToPastTrades(trade, {
            exitPriceSOL: 0,
            exitPriceUSD: 0,
            sellPercentageGain: 0,
            sellPercentageLoss: 0,
            status: 'EXPIRED',
            reason: 'No token account found - tokens may have been transferred out'
          });
          activeTrades.delete(tradeId);
          return;
        }
        throw balanceError;
      }

      // If balance is 0 or less than 1 token, archive the trade
      if (tokenBalance < 1) {
        console.log(`Trade ${tradeId} has insufficient balance (${tokenBalance}), archiving...`);
        const sellInfo = {
          exitPriceSOL: 0,
          exitPriceUSD: 0,
          sellPercentageGain: 0,
          sellPercentageLoss: 0,
          status: 'EXPIRED',
          reason: `Insufficient balance: ${tokenBalance}`
        };

        await moveTradeToPastTrades(trade, sellInfo);
        activeTrades.delete(tradeId);
        return;
      }

      trackRequest();
      const tokenData = await fetchTokenPairs(trade.tokenAddress);
      
      if (!tokenData) {
        console.log(`No price data available for ${trade.tokenAddress}, will retry next interval`);
        setTimeout(() => monitor(), MONITOR_INTERVAL);
        return;
      }

      const currentPrice = tokenData.priceNative;
      const priceChangePercent = calculatePriceChange(currentPrice, trade.entryPriceSOL);

      if (config.twitter.settings.devMode || config.cryptoGlobals.debugMode) {
        console.log(`[${new Date().toISOString()}] Monitoring trade ${tradeId}:`, {
            currentPrice,
            entryPrice: trade.entryPriceSOL,
            priceChange: priceChangePercent,
            targetGain: trade.targetPercentageGain,
            targetLoss: trade.targetPercentageLoss
        });
      }

      if (shouldSell(priceChangePercent, trade)) {
        const sellResult = await executeTradeSell(trade, currentPrice);
        if (!sellResult.success) {
          console.log(`Failed to sell trade ${tradeId}, will retry next interval:`, sellResult.error);
          setTimeout(() => monitor(), MONITOR_INTERVAL);
          return;
        }
        // Only remove from monitoring if sell was successful
        activeTrades.delete(tradeId);
        return;
      }

      setTimeout(() => monitor(), MONITOR_INTERVAL);
    } catch (error) {
      console.error(`Error monitoring trade ${tradeId}:`, error.message);
      // Don't stop monitoring on error, retry next interval
      setTimeout(() => monitor(), MONITOR_INTERVAL);
    }
  };

  activeTrades.set(tradeId, true);
  monitor();
}

export async function initializeTradeMonitoring() {
  try {
    console.log('Initializing trade monitoring...');
    const activeTradesFromDB = await getActiveTrades();
    
    if (activeTradesFromDB.length > 0) {
      console.log(`Found ${activeTradesFromDB.length} active trades to monitor`);
      
      for (const trade of activeTradesFromDB) {
        if (!activeTrades.has(trade.tradeId)) { // Using the Map instance
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

function shouldSell(priceChangePercent, trade) {
  const currentTime = new Date().getTime();
  const tradeTime = new Date(trade.timestamp).getTime();
  
  // Calculate elapsed time based on trade type
  if (trade.tradeType === 'INVEST') {
    const timeElapsedHours = (currentTime - tradeTime) / (1000 * 60 * 60); // Convert to hours
    if (timeElapsedHours >= config.cryptoGlobals.investHoldingTimePeriodHours) {
      console.log(`Selling INVEST trade due to exceeding time limit of ${config.cryptoGlobals.investHoldingTimePeriodHours} hours`);
      return true;
    }
  } else if (trade.tradeType === 'QUICK_PROFIT') {
    const timeElapsedMinutes = (currentTime - tradeTime) / (1000 * 60); // Keep in minutes
    if (timeElapsedMinutes >= config.cryptoGlobals.quickProfitHoldingTimePeriodMinutes) {
      console.log(`Selling QUICK_PROFIT trade due to exceeding time limit of ${config.cryptoGlobals.quickProfitHoldingTimePeriodMinutes} minutes`);
      return true;
    }
  }

  // Check profit/loss targets if time limit hasn't been reached
  return priceChangePercent >= trade.targetPercentageGain || 
         priceChangePercent <= -trade.targetPercentageLoss;
}
