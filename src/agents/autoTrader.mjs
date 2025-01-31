import { config } from "../config/config.mjs";
import dotenv from "dotenv";
import { fetchWithTimeout, fetchTokenData, fetchBoostedTokenData, fetchMeteoraTokenData } from "../utils/helpers.mjs";
import axios from 'axios';
import { decryptPrivateKey } from '../encryption/encryption.mjs';
import { storeTradeInfo } from '../db/dynamo.mjs';
import { startPriceMonitoring } from '../trading/pnl.mjs';
import { executeTradeBuy, executeBackgroundTradeBuy } from '../trading/buy.mjs';

export async function generateTradeAnswer() {
    let investmentChoice;
    try {
        investmentChoice = await handleTradeQuestion();
        console.log("Generated Investment Decision:", investmentChoice);

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

// Passed this function
export async function handleTradeQuestion() {
    let tokenData;
    try {
        //tokenData = await fetchBoostedTokenData();
        tokenData = await fetchMeteoraTokenData();
        if (config.cryptoGlobals.tradeTokenDevMode) {
            console.log('Development mode is enabled. Generated token data:', tokenData);
        }

    } catch (error) {
        console.error("Error fetching token data going to try again!", error);
        await handleTradeQuestion();
    }

    // Step 4 call the generatePrompt function
    const prompt = await generateTradePrompt(tokenData);
    console.log("Generated prompt:", prompt);

    // If the response is good for the prompt then we can move on to the next step of calling the api with the response.
    let agentResponses;
    try {
        // Step 5 call the external API with the prompt
        if (config.cryptoGlobals.tradeTokenDevMode) {
        console.log("Sending request to external API with payload:", { query: prompt });
        }

        const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/trading-agent-chat', { query: prompt });
        //console.log("Received response from external API:", response.data);
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
        await handleTradeQuestion();
    }

    const investmentChoice = {
        agetnAnalysisComment,
        agentInvestmentComment,
        agentInvestmentDecisionComment,
        tokenData,
    };

    if (config.twitter.settings.devMode) {
        console.log('Development mode is enabled. Generated Investment Decision:', investmentChoice);
    }

    return investmentChoice;
}

async function generateTradePrompt(tokenData) {
  const {
    dateCreated,
    tokenName,
    tokenSymbol,
    tokenDescription,
    tokenAddress,
    tokenTwitterURL,
    tokenWebsiteURL,
    tokenPriceInSol,
    tokenPriceInUSD,
    tokenVolume24h,
    tokenPriceChange5m,
    tokenPriceChange1h,
    tokenPriceChange6h,
    tokenPriceChange24h,
    tokenLiquidityUSD,
    tokenLiquidityBase,
    tokenLiquidityQuote,
    tokenFDV,
    tokenMarketCap,
    tokenSafe,
    tokenFreezeAuthority,
    tokenMintAuthority,
    meteoraSpecific,
  } = tokenData;

  return `
    Token Information:
    Date Created: ${dateCreated}
    Token Name: ${tokenName}
    Token Symbol: ${tokenSymbol}
    Token Description: ${tokenDescription}
    Token Address: ${tokenAddress}
    Token Twitter URL: ${tokenTwitterURL}
    Token Website URL: ${tokenWebsiteURL}

    Price & Market Data:
    Token Price In Sol: ${tokenPriceInSol}
    Token Price In USD: ${tokenPriceInUSD}
    Token Volume 24h: ${tokenVolume24h}
    Token Price Change 5m: ${tokenPriceChange5m}
    Token Price Change 1h: ${tokenPriceChange1h}
    Token Price Change 6h: ${tokenPriceChange6h}
    Token Price Change 24h: ${tokenPriceChange24h}
    Token Liquidity USD: ${tokenLiquidityUSD}
    Token Liquidity Base: ${tokenLiquidityBase}
    Token Liquidity Quote: ${tokenLiquidityQuote}
    Token FDV: ${tokenFDV}
    Token Market Cap: ${tokenMarketCap}

    Security Info:
    Token Safe: ${tokenSafe}
    Has Freeze Authority: ${tokenFreezeAuthority}
    Has Mint Authority: ${tokenMintAuthority}

    Meteora Pool Info:
    Pool Address: ${meteoraSpecific?.pairAddress}
    Bin Step: ${meteoraSpecific?.binStep}
    Base Fee %: ${meteoraSpecific?.baseFeePercent}
    Max Fee %: ${meteoraSpecific?.maxFeePercent}
    Protocol Fee %: ${meteoraSpecific?.protocolFeePercent}
    Fees 24h: ${meteoraSpecific?.fees24h}
    Today's Fees: ${meteoraSpecific?.todayFees}
    Pool APR: ${meteoraSpecific?.apr}
    Pool APY: ${meteoraSpecific?.apy}
    Farm APR: ${meteoraSpecific?.farmApr}
    Farm APY: ${meteoraSpecific?.farmApy}
  `;
}

export async function executeTrade(investmentChoice) {
    if (!investmentChoice) {
        console.log('No valid investment choice provided, skipping trade execution');
        return;
    }

    try {
        console.log('Starting autoTrade function with trade data:', {
            investmentDecision: investmentChoice.agentInvestmentDecisionComment,
            tokenDetails: {
                name: investmentChoice.tokenData.tokenName,
                address: investmentChoice.tokenData.tokenAddress,
                priceSOL: investmentChoice.tokenData.tokenPriceInSol
            }
        });

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

          console.log('Extracted trade parameters:', { 
            targetGain, 
            targetLoss,
            tradeType,
            timeLimit: tradeType === 'INVEST' ? 
              `${config.cryptoGlobals.investHoldingTimePeriodDays} days` : 
              `${config.cryptoGlobals.quickProfitHoldingTimePeriodMinutes} minutes`
          });
          
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