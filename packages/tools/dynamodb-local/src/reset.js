#!/usr/bin/env node
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb';
import { config } from './config.js';

const client = new DynamoDBClient({
  endpoint: config.endpoint,
  region: config.region,
  credentials: config.credentials,
});

async function deleteTable(tableName) {
  try {
    console.log(`🗑️  Deleting table ${tableName}...`);
    await client.send(new DeleteTableCommand({ TableName: tableName }));

    // Wait for table to be deleted
    await waitUntilTableNotExists(
      { client, maxWaitTime: 60 },
      { TableName: tableName },
    );

    console.log(`✅ Table ${tableName} deleted successfully`);
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      console.log(`ℹ️  Table ${tableName} does not exist`);
    } else {
      console.error(`❌ Failed to delete table ${tableName}:`, error.message);
      throw error;
    }
  }
}

async function resetTables() {
  console.log('🔄 Resetting DynamoDB Local tables...\n');

  try {
    // List all tables
    const { TableNames } = await client.send(new ListTablesCommand({}));

    if (!TableNames || TableNames.length === 0) {
      console.log('ℹ️  No tables to delete');
      return;
    }

    console.log(`📋 Found ${TableNames.length} table(s):\n`);
    TableNames.forEach(name => console.log(`   - ${name}`));
    console.log();

    // Delete all tables
    for (const tableName of TableNames) {
      await deleteTable(tableName);
    }

    console.log('\n✅ All tables deleted successfully!');
    console.log('\n💡 Run "pnpm create-tables" to recreate the tables');
  } catch (error) {
    console.error('\n❌ Failed to reset tables:', error.message);
    process.exit(1);
  }
}

resetTables();
