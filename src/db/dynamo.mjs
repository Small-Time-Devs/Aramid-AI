import { config as dotenvConfig } from 'dotenv';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import pkg from '@aws-sdk/lib-dynamodb';
const { DynamoDBDocumentClient, QueryCommand, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand, marshall, unmarshall } = pkg;

// Load environment variables from .env file
dotenvConfig();

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

export async function saveTweetData(tweetId, date, tweet, comment, hashtags, analysisResponse, tweetData ) {
    const tableName = 'AramidAI-X-Past-Tweets';
  
    try {
      const putParams = {
        TableName: tableName,
        Item: {
          TweetID: tweetId,      // Primary key
          Date: date,            // ISO format date string
          Tweet: tweet,          // Main tweet content
          Comment: comment,      // Reply comment
          Hashtags: hashtags,    // Hashtags as a string
          AnaylsisResponse: analysisResponse,   // Analysis response
          InvestmentComment: investmentComment,  // Investment comment
          InvestmentDecisionComment: investmentDecisionComment,  // Investment decision comment
          TweetData: tweetData,  // Additional tweet data
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
  