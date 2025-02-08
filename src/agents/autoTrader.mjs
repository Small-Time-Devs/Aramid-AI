import { config } from "../config/config.mjs";
import dotenv from "dotenv";
import { fetchWithTimeout, fetchLatestTokenData, fetchBoostedTokenData  } from "../utils/helpers.mjs";
import axios from 'axios';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { storeTradeInfo } from '../db/dynamo.mjs';
import { startPriceMonitoring } from '../trading/pnl.mjs';
import { executeTradeBuy, executeBackgroundTradeBuy } from '../trading/buy.mjs';
import { findActiveTradeByToken, checkPastTrades } from '../db/dynamo.mjs';

// step 1
export async function generateTradeAnswer() {
    let investmentChoice;
    try {
      // Step 2
        investmentChoice = await pickToken();
        if (config.cryptoGlobals.tradeTokenDevMode) {
        console.log("Generated Investment Decision:", investmentChoice);
        }

        // Skip if the investment decision is a "Pass"
        if (investmentChoice?.agentInvestmentDecisionComment?.startsWith('Pass')) {
            console.log('Investment rejected by trading agent:', investmentChoice.agentInvestmentDecisionComment);
            return null;
        }

        // Validate required fields
        if (!investmentChoice?.agetnAnalysisComment || 
            !investmentChoice?.agentInvestmentComment || 
            !investmentChoice?.agentInvestmentDecisionComment) {
            console.log("Invalid investment choice - missing required fields");
            return null;
        }

        return investmentChoice;
    } catch (error) {
        console.error("Error generating Investment Decision:", error);
        return null;
    }
}

async function pickToken() {
    let tokenData;
    let attempts = 0;
    const MAX_ATTEMPTS = 50;

    while (attempts < MAX_ATTEMPTS) {
        try {
            tokenData = await fetchLatestTokenData();
            
            if (config.cryptoGlobals.tradeTokenDevMode) {
                console.log('Checking token:', tokenData.tokenAddress);
            }

            // Check if token is already in active trades
            const existingTrade = await findActiveTradeByToken(tokenData.tokenAddress);
            if (existingTrade) {
                console.log('Token already has an active trade, trying another token...');
                attempts++;
                continue;
            }

            // Check if token was traded recently
            const recentlyTraded = await checkPastTrades(tokenData.tokenAddress);
            if (recentlyTraded) {
                console.log('Token was traded recently, trying another token...');
                attempts++;
                continue;
            }

            if (config.cryptoGlobals.tradeTokenDevMode) {
                console.log('Token data:', tokenData);
            }

            break; // Token passed all checks, proceed with it

        } catch (error) {
            console.error("Error fetching token data, trying again!", error);
            attempts++;
            if (attempts >= MAX_ATTEMPTS) {
                throw new Error('Maximum attempts reached trying to find a suitable token');
            }
        }
    }

    // Step 4
    const tokenAddress = tokenData.tokenAddress;
    const chainId = tokenData.chainId;

    // Make the const for the api specific request
    const contractAddress = tokenAddress;
    const chain = chainId;
    // If the response is good for the prompt then we can move on to the next step of calling the api with the response.
    let agentResponses;
    try {
        const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/autoTrading-agent-chat', {chain, contractAddress });
        if (config.cryptoGlobals.tradeTokenDevMode) {
          console.log("Received response from external API:", response.data);
        }
        agentResponses = response.data.agents;
    } catch (error) {
        console.error("Error connecting to external API:", error.response ? error.response.data : error.message);
        throw new Error("Failed to connect to external API.");
    }

    if (!agentResponses || agentResponses.length < 2) {
        throw new Error("Invalid agent responses received from API.");
    }

    const anaylstAgent = agentResponses[0];
    const agetnAnalysisComment = anaylstAgent.response;
    const investmentAgent = agentResponses[1];
    const agentInvestmentComment = investmentAgent.response;
    const agentInvestmentDecisionComment = investmentAgent.decision;

    if (config.cryptoGlobals.tradeTokenDevMode) {
      console.log("Analyst Response:", agetnAnalysisComment);
      console.log("Investment Response:", agentInvestmentComment);
      console.log("Investment Decision:", agentInvestmentDecisionComment);
    }

    if (!agentInvestmentDecisionComment) {
        console.error("Invalid investment agent decision, generating again.");
        return await pickToken();
    }

    const investmentChoice = {
        agetnAnalysisComment,
        agentInvestmentComment,
        agentInvestmentDecisionComment,
        tokenData,
    };

    return investmentChoice;
}

export async function executeTrade(investmentChoice) {
    if (!investmentChoice) {
        console.log('No valid investment choice provided, skipping trade execution');
        return;
    }

    try {

        let tradeResult = null;

        // Only proceed with trading if tradeTokens is enabled
        if (config.cryptoGlobals.tradeTokensInBackground && 
            investmentChoice.agentInvestmentDecisionComment && 
            (investmentChoice.agentInvestmentDecisionComment.startsWith("Quick Profit") || 
             investmentChoice.agentInvestmentDecisionComment.startsWith("Invest"))) {
          
          let targetGain, targetLoss;
          let tradeType;
          
          if (investmentChoice.agentInvestmentDecisionComment.startsWith("Quick Profit")) {
            const gainMatch = investmentChoice.agentInvestmentDecisionComment.match(/Gain \+(\d+)%/);
            const lossMatch = investmentChoice.agentInvestmentDecisionComment.match(/Loss -(\d+)%/);
            
            targetGain = gainMatch ? parseFloat(gainMatch[1]) : 50;
            targetLoss = lossMatch ? parseFloat(lossMatch[1]) : 20;
            tradeType = 'QUICK_PROFIT';
          } else {
            // Regular Invest format
            const targetGainMatch = investmentChoice.agentInvestmentDecisionComment.match(/take profit at (\d+)%/i);
            const targetLossMatch = investmentChoice.agentInvestmentDecisionComment.match(/stop loss at (\d+)%/i);
            
            targetGain = targetGainMatch ? parseFloat(targetGainMatch[1]) : 50;
            targetLoss = targetLossMatch ? parseFloat(targetLossMatch[1]) : 20;
            tradeType = 'INVEST';
          }

          if (config.cryptoGlobals.tradeTokensInBackground) {
            console.log('Extracted trade parameters:', { 
              targetGain, 
              targetLoss,
              tradeType,
              timeLimit: tradeType === 'INVEST' ? 
                `${config.cryptoGlobals.investHoldingTimePeriodHours} hours` : 
                `${config.cryptoGlobals.quickProfitHoldingTimePeriodMinutes} minutes`
            });
          }

          tradeResult = await executeBackgroundTradeBuy(investmentChoice, targetGain, targetLoss, tradeType);
          
          if (!tradeResult.success) {
            console.error('Trade execution failed:', tradeResult.error);
          } else {
            console.log('Trade executed successfully. Trade ID:', tradeResult.tradeId);
          }

          if (tradeResult && tradeResult.success && tradeResult.txId) {
            console.log(`Check out the trade: https://solscan.io/tx/${tradeResult.txId} 🚀`);
          }
        } else if (!config.cryptoGlobals.tradeTokensInBackground) {
          console.log('Auto Trading is disabled in config. Skipping trade execution.');
        }
    } catch (error) {
        console.error('Error executing trade:', error);
    }
}