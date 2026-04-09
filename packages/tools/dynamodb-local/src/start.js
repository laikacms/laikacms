#!/usr/bin/env node
import { execSync } from 'child_process';
import { config } from './config.js';

console.log('🚀 Starting DynamoDB Local...\n');

try {
  // Check if container already exists
  try {
    const existing = execSync(`docker ps -a -q -f name=${config.containerName}`, { encoding: 'utf-8' }).trim();
    if (existing) {
      console.log(`📦 Container ${config.containerName} already exists`);

      // Check if it's running
      const running = execSync(`docker ps -q -f name=${config.containerName}`, { encoding: 'utf-8' }).trim();
      if (running) {
        console.log('✅ DynamoDB Local is already running');
        console.log(`\n🔗 Endpoint: ${config.endpoint}`);
        process.exit(0);
      }

      // Start existing container
      console.log('▶️  Starting existing container...');
      execSync(`docker start ${config.containerName}`, { stdio: 'inherit' });
      console.log('✅ DynamoDB Local started successfully');
      console.log(`\n🔗 Endpoint: ${config.endpoint}`);
      process.exit(0);
    }
  } catch (error) {
    // Container doesn't exist, continue to create it
  }

  // Create and start new container
  console.log('📦 Creating new DynamoDB Local container...');
  execSync(
    `docker run -d \
      --name ${config.containerName} \
      -p ${config.port}:8000 \
      amazon/dynamodb-local \
      -jar DynamoDBLocal.jar -sharedDb -inMemory`,
    { stdio: 'inherit' },
  );

  console.log('✅ DynamoDB Local started successfully');
  console.log(`\n🔗 Endpoint: ${config.endpoint}`);
  console.log('\n💡 Next steps:');
  console.log('   1. Run "pnpm create-tables" to create the required tables');
  console.log('   2. Set environment variables:');
  console.log(`      export DYNAMODB_ENDPOINT=${config.endpoint}`);
  console.log(`      export AWS_REGION=${config.region}`);
  console.log(`      export AWS_ACCESS_KEY_ID=${config.credentials.accessKeyId}`);
  console.log(`      export AWS_SECRET_ACCESS_KEY=${config.credentials.secretAccessKey}`);
} catch (error) {
  console.error('❌ Failed to start DynamoDB Local:', error.message);
  console.error('\n💡 Make sure Docker is installed and running');
  process.exit(1);
}
