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
    const params = {
      TableName: 'AramidAI-X-Trades',
      Key: { tradeId },
      UpdateExpression: 'SET exitPriceSOL = :exitSOL, exitPriceUSD = :exitUSD, sellPercentageGain = :gain, sellPercentageLoss = :loss, #tradeStatus = :statusValue',
      ExpressionAttributeNames: {
        '#tradeStatus': 'status'  // Use a different name for the status attribute
      },
      ExpressionAttributeValues: {
        ':exitSOL': sellData.exitPriceSOL,
        ':exitUSD': sellData.exitPriceUSD,
        ':gain': sellData.sellPercentageGain,
        ':loss': sellData.sellPercentageLoss,
        ':statusValue': 'COMPLETED'
      }
    };

    const command = new UpdateCommand(params);
    await docClient.send(command);
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
      throw new Error(`No trade found with ID: ${tradeId}`);
    }

    return response.Item;
  } catch (error) {
    console.error(`Error getting trade with ID ${tradeId}:`, error);
    throw error;
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
    console.log('Public key:', config.cryptoGlobals.publicKey);
  try {
    const params = {
      TableName: 'AramidAI-X-Wallets',
      Key: { 
        solPublicKey: config.cryptoGlobals.publicKey // Using original config import
      }
    };

    const command = new GetCommand(params);
    const response = await docClient.send(command);
    
    if (!response.Item) {
      throw new Error('No wallet details found');
    }

    // Return the wallet details with the encrypted private key
    return {
      solPublicKey: response.Item.solPublicKey,
      solPrivateKey: response.Item.solPrivateKey
    };
  } catch (error) {
    console.error('Error getting wallet details:', error);
    throw error;
  }
}
