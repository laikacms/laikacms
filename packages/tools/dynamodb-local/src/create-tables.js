#!/usr/bin/env node
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DescribeTableCommand, ResourceInUseException } from '@aws-sdk/client-dynamodb';
import { config } from './config.js';

const client = new DynamoDBClient({
  endpoint: config.endpoint,
  region: config.region,
  credentials: config.credentials,
  maxAttempts: 3,
  requestHandler: {
    requestTimeout: 30000, // 30 second timeout
  },
});

const tables = [
  config.tables.main.createParams,
  config.tables.content.createParams,
];

async function createTable(tableConfig) {
  try {
    // Check if table already exists
    try {
      await client.send(new DescribeTableCommand({ TableName: tableConfig.TableName }));
      console.log(`✅ Table ${tableConfig.TableName} already exists`);
      return;
    } catch (error) {
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
      // Table doesn't exist, continue to create it
    }

    // Create the table
    console.log(`📦 Creating table ${tableConfig.TableName}...`);
    await client.send(new CreateTableCommand(tableConfig));
    console.log(`✅ Table ${tableConfig.TableName} created successfully`);
  } catch (error) {
    if (error instanceof ResourceInUseException) {
      console.log(`✅ Table ${tableConfig.TableName} already exists`);
    } else {
      console.error(`❌ Failed to create table ${tableConfig.TableName}:`, error.message);
      throw error;
    }
  }
}

async function waitForDynamoDB(maxRetries = 5, delayMs = 2000) {
  console.log('🔍 Checking DynamoDB Local connection...');

  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.send(new DescribeTableCommand({ TableName: 'test-connection' }));
      // If we get here without error, connection works
      console.log('✅ DynamoDB Local is ready\n');
      return true;
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        // This is expected - table doesn't exist but connection works
        console.log('✅ DynamoDB Local is ready\n');
        return true;
      } else {
        // Connection failed, retry
        if (i < maxRetries - 1) {
          console.log(`   Attempt ${i + 1}/${maxRetries} failed: ${error.name || error.code}`);
          console.log(`   Waiting ${delayMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          console.error('❌ Cannot connect to DynamoDB Local after multiple attempts');
          console.error(`   Endpoint: ${config.endpoint}`);
          console.error(`   Last error: ${error.name || error.code} - ${error.message}`);
          console.error('\n💡 Make sure DynamoDB Local is running:');
          console.error('   pnpm start');
          return false;
        }
      }
    }
  }
  return false;
}

async function createAllTables() {
  console.log('🚀 Creating DynamoDB tables...\n');

  try {
    // Wait for DynamoDB Local to be ready
    const isReady = await waitForDynamoDB();
    if (!isReady) {
      process.exit(1);
    }

    for (const tableConfig of tables) {
      await createTable(tableConfig);
    }

    console.log('\n✅ All tables created successfully!');
    console.log('\n📋 Created tables:');
    tables.forEach(table => {
      console.log(`   - ${table.TableName}`);
    });
  } catch (error) {
    console.error('\n❌ Failed to create tables:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Make sure DynamoDB Local is running:');
      console.error('   pnpm start');
    }
    process.exit(1);
  }
}

createAllTables();
