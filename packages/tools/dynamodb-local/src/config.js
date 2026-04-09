import { getTableConfig } from '@laikacms/ddb-data';

/**
 * DynamoDB Local configuration
 */
export const config = {
  // Match CDK default environment naming (see DynamoDBTables construct)
  environment: process.env.DYNAMODB_ENVIRONMENT || 'dev',

  // Docker container name
  containerName: 'laika-dynamodb-local',

  // Port to expose DynamoDB Local on
  port: 8000,

  // DynamoDB Local endpoint
  endpoint: 'http://localhost:8000',

  // AWS region for local development
  region: 'us-east-1',

  // Fake credentials for local development
  credentials: {
    accessKeyId: 'fakeAccessKeyId',
    secretAccessKey: 'fakeSecretAccessKey',
  },

  // Table definitions - populated from centralized config
  tables: getTableConfig(process.env.DYNAMODB_ENVIRONMENT || 'dev'),
};
