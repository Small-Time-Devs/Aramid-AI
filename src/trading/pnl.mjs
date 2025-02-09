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

export async function startPriceMonitoring(tradeId, initialDelay = 60000) { // Add initialDelay parameter
  if (activeTrades.has(tradeId)) return;

  // Add initial delay for new trades to allow token account creation
  await new Promise(resolve => setTimeout(resolve, initialDelay));

  const monitor = async () => {
    try {
      if (!canMakeRequest()) {
        console.log('Rate limit approaching, skipping this check');
        setTimeout(() => monitor(), MONITOR_INTERVAL);
        return;
      }

      const trade = await getTrade(tradeId);
      // Stop monitoring if trade is not found or is no longer active
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
      let attempts = 0;
      const maxAttempts = 3; // Try up to 3 times to find the token balance

      while (attempts < maxAttempts) {
        try {
          tokenBalance = await checkTokenBalance(
            trade.tokenAddress,
            config.cryptoGlobals.publicKey
          );
          
          if (tokenBalance > 0) break; // Exit loop if we find tokens

          console.log(`Attempt ${attempts + 1}: No balance found yet, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 20000)); // Wait 20s between attempts
          attempts++;
          
        } catch (balanceError) {
          if (balanceError.message?.includes('No token account found') && attempts < maxAttempts - 1) {
            console.log(`Attempt ${attempts + 1}: Token account not found yet, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 20000));
            attempts++;
            continue;
          }
          throw balanceError;
        }
      }

      // Only archive if we've tried multiple times and still no balance
      if (tokenBalance < 1 && attempts >= maxAttempts) {
        console.log(`Trade ${tradeId} has insufficient balance after ${maxAttempts} attempts, archiving...`);
        const sellInfo = {
          exitPriceSOL: 0,
          exitPriceUSD: 0,
          sellPercentageGain: 0, 
          sellPercentageLoss: 0,
          status: 'EXPIRED',
          reason: `Insufficient balance after ${maxAttempts} attempts: ${tokenBalance}`
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

      // First check if we've hit our configured profit/loss targets
      if (priceChangePercent >= trade.targetPercentageGain) {
        console.log(`Taking profit at ${priceChangePercent}% gain`);
        const sellResult = await executeTradeSell(trade, currentPrice);
        if (!sellResult.success) {
          console.log(`Failed to sell trade ${tradeId}, will retry next interval:`, sellResult.error);
          setTimeout(() => monitor(), MONITOR_INTERVAL);
          return;
        }
        activeTrades.delete(tradeId);
        return;
      }

      if (priceChangePercent <= -trade.targetPercentageLoss) {
        console.log(`Stopping loss at ${priceChangePercent}% loss`);
        const sellResult = await executeTradeSell(trade, currentPrice);
        if (!sellResult.success) {
          console.log(`Failed to sell trade ${tradeId}, will retry next interval:`, sellResult.error);
          setTimeout(() => monitor(), MONITOR_INTERVAL);
          return;
        }
        activeTrades.delete(tradeId);
        return;
      }

      // Check time-based exits
      const currentTime = new Date().getTime();
      const tradeTime = new Date(trade.timestamp).getTime();
      
      if (trade.tradeType === 'INVEST' && 
          (currentTime - tradeTime) >= (config.cryptoGlobals.investHoldingTimePeriodHours * 60 * 60 * 1000)) {
        console.log(`Selling INVEST trade ${tradeId} due to time limit`);
        const sellResult = await executeTradeSell(trade, currentPrice);
        if (!sellResult.success) {
          setTimeout(() => monitor(), MONITOR_INTERVAL);
          return;
        }
        activeTrades.delete(tradeId);
        return;
      }

      if (trade.tradeType === 'QUICK_PROFIT' && 
          (currentTime - tradeTime) >= (config.cryptoGlobals.quickProfitHoldingTimePeriodMinutes * 60 * 1000)) {
        console.log(`Selling QUICK_PROFIT trade ${tradeId} due to time limit`);
        const sellResult = await executeTradeSell(trade, currentPrice);
        if (!sellResult.success) {
          setTimeout(() => monitor(), MONITOR_INTERVAL);
          return;
        }
        activeTrades.delete(tradeId);
        return;
      }

      // Only proceed to AI advice if we haven't hit any standard exit conditions
      const chainID = 'solana';
      const tokenAddress = trade.tokenAddress;
      const entryPrice = trade.entryPriceSOL;
      const targetGain = trade.targetPercentageGain;
      const targetLoss = trade.targetPercentageLoss;

      console.log('Token Address:', trade.tokenAddress);
      console.log('ChainID:', chainID);
      console.log('Entry Price:', trade.entryPriceSOL);
      console.log('Target Gain:', trade.targetPercentageGain);
      console.log('Target Loss:', trade.targetPercentageLoss);

      if (config.cryptoGlobals.askForAdviceFromAI) {
        const advice = await autoTradingAdvice(chainID, tokenAddress, entryPrice, targetGain, targetLoss);
        console.log(`OpenAI advice for trade ${tradeId}: ${advice}`);

        if (advice.startsWith('Sell Now')) {
          // Trigger the sell function.
          const sellResult = await executeTradeSell(trade, currentPrice);
          if (!sellResult.success) {
            console.log(`Failed to sell trade ${tradeId}, will retry next interval:`, sellResult.error);
            setTimeout(() => monitor(), MONITOR_INTERVAL);
            return;
          }
          // Remove from active monitoring after a successful sell.
          activeTrades.delete(tradeId);
          return;
        } else if (advice.startsWith('Adjust Trade')) {
          // Expecting a format like: 
          // "adjust trade: targetpercentagegain: 12, targetpercentageloss: 8"
          const regex = /targetpercentagegain:\s*([\d.]+).*targetpercentageloss:\s*([\d.]+)/i;
          const match = advice.match(regex);
          if (match) {
            const newGain = parseFloat(match[1]);
            const newLoss = parseFloat(match[2]);
            // Update the trade's targets in DynamoDB.
            const updateResult = await updateTradeTargets(trade.tradeId, {
              targetPercentageGain: newGain,
              targetPercentageLoss: newLoss,
            });
            if (updateResult.success) {
              console.log(`Updated trade ${trade.tradeId} with new targets: Gain ${newGain}% Loss ${newLoss}%`);
            } else {
              console.log(`Failed to update trade ${trade.tradeId}:`, updateResult.error);
            }
          } else {
            console.log('Could not parse new thresholds from OpenAI advice, holding trade.');
          }
          // Continue monitoring after adjusting the trade.
          setTimeout(() => monitor(), MONITOR_INTERVAL);
          return;
        } else if (advice === 'Hold') {
          return;
        }
      }

      // If the advice is "hold" or anything unrecognized, just continue monitoring.
      setTimeout(() => monitor(), MONITOR_INTERVAL);
    } catch (error) {
      console.error(`Error monitoring trade ${tradeId}:`, error.message);
      // On error, retry the monitoring loop after the interval.
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