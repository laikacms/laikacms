#!/usr/bin/env node
import { execSync } from 'child_process';
import { config } from './config.js';

console.log('🛑 Stopping DynamoDB Local...\n');

try {
  // Check if container exists
  const existing = execSync(`docker ps -a -q -f name=${config.containerName}`, { encoding: 'utf-8' }).trim();
  
  if (!existing) {
    console.log('ℹ️  DynamoDB Local container does not exist');
    process.exit(0);
  }

  // Check if it's running
  const running = execSync(`docker ps -q -f name=${config.containerName}`, { encoding: 'utf-8' }).trim();
  
  if (!running) {
    console.log('ℹ️  DynamoDB Local is not running');
    process.exit(0);
  }

  // Stop the container
  console.log('⏹️  Stopping container...');
  execSync(`docker stop ${config.containerName}`, { stdio: 'inherit' });
  
  console.log('✅ DynamoDB Local stopped successfully');
} catch (error) {
  console.error('❌ Failed to stop DynamoDB Local:', error.message);
  process.exit(1);
}