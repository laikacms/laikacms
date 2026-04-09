#!/usr/bin/env node
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { execSync } from 'child_process';
import { config } from './config.js';

console.log('📊 DynamoDB Local Status\n');

// Check Docker container status
try {
  const existing = execSync(`docker ps -a -q -f name=${config.containerName}`, { encoding: 'utf-8' }).trim();

  if (!existing) {
    console.log('❌ Container Status: Not created');
    console.log('\n💡 Run "pnpm start" to create and start DynamoDB Local');
    process.exit(0);
  }

  const running = execSync(`docker ps -q -f name=${config.containerName}`, { encoding: 'utf-8' }).trim();

  if (running) {
    console.log('✅ Container Status: Running');
    console.log(`🔗 Endpoint: ${config.endpoint}`);
  } else {
    console.log('⏸️  Container Status: Stopped');
    console.log('\n💡 Run "pnpm start" to start DynamoDB Local');
    process.exit(0);
  }

  // If running, check tables
  const client = new DynamoDBClient({
    endpoint: config.endpoint,
    region: config.region,
    credentials: config.credentials,
  });

  const { TableNames } = await client.send(new ListTablesCommand({}));

  console.log(`\n📋 Tables (${TableNames?.length || 0}):`);
  if (TableNames && TableNames.length > 0) {
    TableNames.forEach(name => console.log(`   - ${name}`));
  } else {
    console.log('   (no tables)');
    console.log('\n💡 Run "pnpm create-tables" to create tables');
  }

  console.log('\n🔧 Environment Variables:');
  console.log(`   DYNAMODB_ENDPOINT=${config.endpoint}`);
  console.log(`   AWS_REGION=${config.region}`);
  console.log(`   AWS_ACCESS_KEY_ID=${config.credentials.accessKeyId}`);
  console.log(`   AWS_SECRET_ACCESS_KEY=${config.credentials.secretAccessKey}`);
} catch (error) {
  console.error('❌ Error checking status:', error.message);
  process.exit(1);
}
