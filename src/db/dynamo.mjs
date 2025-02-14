import { config } from '../config/config.mjs';
import { config as dotEnvConfig } from 'dotenv';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import pkg from '@aws-sdk/lib-dynamodb';
const { DynamoDBDocumentClient, QueryCommand, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand, marshall, unmarshall } = pkg;

// Load environment variables from .env file
dotEnvConfig();

// Import keys from environment variables
const ACCESS_KEY = process.env.ACCESS_KEY;
const SECRET_KEY = process.env.SECRET_KEY;

// Ensure the AWS credentials are available
if (!ACCESS_KEY || !SECRET_KEY) {
  console.error('Error: AWS ACCESS_KEY and SECRET_KEY must be set in the environment variables.');
  process.exit(1);
}

// Configure AWS region and credentials
const client = new DynamoDBClient({
  // Ohio server
  region: 'us-east-1',
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY
  }
});

// Configure DynamoDB Document Client with marshall options
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    convertClassInstanceToMap: true,
    removeUndefinedValues: true, // Add this line to remove undefined values
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

export async function saveTweetData(
  tweetId, 
  date, 
  tweet, 
  comment, 
  hashtagsComment,
  analysisComment,
  tweetPost,
  agentComment,
  hashtagsContent,
  investmentComment,
  investmentDecision,
  tokenData
) {
    const tableName = 'AramidAI-X-Past-Tweets';
  
    try {
      const putParams = {
        TableName: tableName,
        Item: {
          TweetID: tweetId,      // Primary key
          Date: date,            // ISO format date string
          Tweet: tweet,          // Combined tweet content
          Comment: comment,      // Combined comment
          // Individual agent responses
          AgentAnalysisComment: analysisComment,
          AgentTweetPost: tweetPost,
          AgentCommentPost: agentComment,
          AgentHashtagsComment: hashtagsContent,
          AgentInvestmentComment: investmentComment,
          AgentInvestmentDecision: investmentDecision,
          TokenData: tokenData,  // Token data
          Timestamp: new Date().toISOString()
        }
      };
  
      const putCommand = new PutCommand(putParams);
      await docClient.send(putCommand);
  
      console.log(`Tweet data saved successfully: ${tweetId}`);
    } catch (error) {
      console.error('Error saving tweet data:', JSON.stringify(error, null, 2));
      throw error;
    }
}

// Store trade information in DynamoDB
export async function storeTradeInfo(data) {
  try {
    const params = {
      TableName: 'AramidAI-X-Trades',
      Item: {
        tradeId: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        tokenName: data.tokenName,
        tokenAddress: data.tokenAddress,
        amountInvested: data.amountInvested,
        entryPriceSOL: data.entryPriceSOL,
        entryPriceUSD: data.entryPriceUSD,
        exitPriceSOL: data.exitPriceSOL || null,
        exitPriceUSD: data.exitPriceUSD || null,
        targetPercentageGain: data.targetPercentageGain,
        targetPercentageLoss: data.targetPercentageLoss,
        sellPercentageGain: data.sellPercentageGain || null,
        sellPercentageLoss: data.sellPercentageLoss || null,
        status: 'ACTIVE',
        tokensReceived: data.tokensReceived, // Add new field for tokens received
        tradeType: data.tradeType, // Add trade type (INVEST, QUICK_PROFIT, or DEGEN)
        timestamp: new Date().toISOString()
      }
    };

    const command = new PutCommand(params);
    await docClient.send(command);
    return params.Item.tradeId;
  } catch (error) {
    console.error('Error storing trade info:', error);
    throw error;
  }
}

// Update trade with sell information
export async function updateTradeWithSellInfo(tradeId, sellData) {
  try {
    // First get the complete trade data
    const trade = await getTrade(tradeId);
    if (!trade) {
      throw new Error(`No trade found with ID: ${tradeId}`);
    }

    // Move trade to past trades with sell info
    await moveTradeToPastTrades(trade, sellData);

    return true;
  } catch (error) {
    console.error('Error updating trade with sell info:', error);
    throw error;
  }
}

// Get trade information from DynamoDB
export async function getTrade(tradeId) {
  try {
    const params = {
      TableName: 'AramidAI-X-Trades',
      Key: { tradeId }
    };

    const command = new GetCommand(params);
    const response = await docClient.send(command);
    
    if (!response.Item) {
      console.log(`Trade ${tradeId} not found - it may have been completed or removed`);
      return null;
    }

    return response.Item;
  } catch (error) {
    console.error(`Error accessing trade with ID ${tradeId}:`, error);
    return null;
  }
}

// Get all active trades
export async function getActiveTrades() {
  try {
    const params = {
      TableName: 'AramidAI-X-Trades',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'ACTIVE'
      }
    };

    const command = new ScanCommand(params);
    const response = await docClient.send(command);
    
    return response.Items || [];
  } catch (error) {
    console.error('Error getting active trades:', error);
    throw error;
  }
}

// Get wallet details
export async function getWalletDetails() {
  console.log('Getting wallet details');
  try {
    const params = {
      TableName: 'AramidAI-X-Wallets',
      Key: { 
        solPublicKey: config.cryptoGlobals.publicKey
      }
    };

    const command = new GetCommand(params);
    const response = await docClient.send(command);
    
    if (!response.Item) {
      throw new Error('No wallet details found');
    }

    // Return both public and private keys
    return {
      solPublicKey: response.Item.solPublicKey,
      solPrivateKey: response.Item.solPrivateKey
    };
  } catch (error) {
    console.error('Error getting wallet details:', error);
    throw error;
  }
}

export async function findActiveTradeByToken(tokenAddress) {
  try {
    const params = {
      TableName: 'AramidAI-X-Trades',
      FilterExpression: '#status = :status AND tokenAddress = :tokenAddress',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'ACTIVE',
        ':tokenAddress': tokenAddress
      }
    };

    console.log('Looking for existing trade:', { tokenAddress });
    const command = new ScanCommand(params);
    const response = await docClient.send(command);
    
    if (response.Items && response.Items.length > 0) {
      console.log('Found existing trade:', response.Items[0]);
    }
    
    return response.Items?.[0] || null;
  } catch (error) {
    console.error('Error finding active trade by token:', error);
    throw error;
  }
}

export async function updateTradeAmounts(tradeId, additionalAmount, additionalTokens) {
  try {
    const params = {
      TableName: 'AramidAI-X-Trades',
      Key: { tradeId },
      UpdateExpression: 'SET amountInvested = amountInvested + :amount, tokensReceived = tokensReceived + :tokens',
      ExpressionAttributeValues: {
        ':amount': parseFloat(additionalAmount) || 0,
        ':tokens': parseFloat(additionalTokens) || 0
      },
      ReturnValues: 'ALL_NEW'
    };

    // Log update attempt
    console.log('Updating trade amounts:', {
      tradeId,
      additionalAmount: params.ExpressionAttributeValues[':amount'],
      additionalTokens: params.ExpressionAttributeValues[':tokens']
    });

    const command = new UpdateCommand(params);
    const response = await docClient.send(command);
    
    console.log('Trade updated successfully:', response.Attributes);
    return response.Attributes;
  } catch (error) {
    console.error('Error updating trade amounts:', error);
    throw error;
  }
}

export async function updateTradeTargets(tradeId, targetGain, targetLoss) {
  try {
    const params = {
      TableName: config.aws.tradesTableName,
      Key: { tradeId },
      UpdateExpression: "set targetPercentageGain = :g, targetPercentageLoss = :l",
      ExpressionAttributeValues: {
        ":g": targetGain,
        ":l": targetLoss
      },
      ReturnValues: "ALL_NEW"
    };

    const result = await dynamoDbDoc.send(new UpdateCommand(params));
    return result.Attributes;
  } catch (error) {
    console.error('Error updating trade targets:', error);
    throw error;
  }
}

export async function moveTradeToPastTrades(trade, sellInfo) {
  try {
    // Don't send notification here since it's handled in executeTradeSell
    const pastTradeParams = {
      TableName: 'AramidAI-X-PastTrades',
      Item: {
        ...trade,
        exitPriceSOL: sellInfo.exitPriceSOL,
        exitPriceUSD: sellInfo.exitPriceUSD,
        sellPercentageGain: sellInfo.sellPercentageGain,
        sellPercentageLoss: sellInfo.sellPercentageLoss,
        status: sellInfo.status || 'COMPLETED',
        reason: sellInfo.reason || null,
        completedAt: new Date().toISOString()
      }
    };

    await docClient.send(new PutCommand(pastTradeParams));
    console.log(`Trade ${trade.tradeId} archived to past trades`);

    await docClient.send(new DeleteCommand({
      TableName: 'AramidAI-X-Trades',
      Key: { tradeId: trade.tradeId }
    }));
    console.log(`Trade ${trade.tradeId} removed from active trades`);

    return true;
  } catch (error) {
    console.error('Error archiving trade:', error);
    throw error;
  }
}

export async function checkPastTrades(tokenAddress) {
  try {
    const params = {
      TableName: 'AramidAI-X-PastTrades',
      FilterExpression: 'tokenAddress = :tokenAddress',
      ExpressionAttributeValues: {
        ':tokenAddress': tokenAddress
      }
    };

    const command = new ScanCommand(params);
    const response = await docClient.send(command);
    
    if (response.Items && response.Items.length > 0) {
      // Check if the most recent trade with this token was within the last 24 hours
      const mostRecentTrade = response.Items.reduce((latest, trade) => {
        return (!latest || trade.timestamp > latest.timestamp) ? trade : latest;
      });
      
      const tradeTime = new Date(mostRecentTrade.timestamp).getTime();
      const currentTime = new Date().getTime();
      const hoursSinceLastTrade = (currentTime - tradeTime) / (1000 * 60 * 60);
      
      // Return true if we've traded this token in the last 24 hours
      return hoursSinceLastTrade < 24;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking past trades:', error);
    return false;
  }
}
