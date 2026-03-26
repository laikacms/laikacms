/**
 * DynamoDB table configuration
 * 
 * This module provides the table schema definitions for both:
 * - Local development (DynamoDB Local)
 * - Production (AWS DynamoDB)
 */

export interface TableConfig {
  name: string;
  createParams: {
    TableName: string;
    KeySchema: Array<{ AttributeName: string; KeyType: 'HASH' | 'RANGE' }>;
    AttributeDefinitions: Array<{ AttributeName: string; AttributeType: 'S' | 'N' | 'B' }>;
    GlobalSecondaryIndexes?: Array<{
      IndexName: string;
      KeySchema: Array<{ AttributeName: string; KeyType: 'HASH' | 'RANGE' }>;
      Projection: { ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE'; NonKeyAttributes?: string[] };
    }>;
    BillingMode: 'PAY_PER_REQUEST' | 'PROVISIONED';
    ProvisionedThroughput?: {
      ReadCapacityUnits: number;
      WriteCapacityUnits: number;
    };
  };
}

/**
 * Get table configuration for a given environment
 * 
 * @param env - Environment name (e.g., 'dev', 'staging', 'prod')
 * @returns Table configurations for main and content tables
 */
export function getTableConfig(env: string = 'dev'): {
  main: TableConfig;
  content: TableConfig;
} {
  return {
    main: {
      name: `laika-cms-${env}`,
      createParams: {
        TableName: `laika-cms-${env}`,
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
          { AttributeName: 'GSI2PK', AttributeType: 'S' },
          { AttributeName: 'GSI2SK', AttributeType: 'S' },
          { AttributeName: 'GSI3PK', AttributeType: 'S' },
          { AttributeName: 'GSI3SK', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI3',
            KeySchema: [
              { AttributeName: 'GSI3PK', KeyType: 'HASH' },
              { AttributeName: 'GSI3SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST', // Lowest cost with eventual consistency
      },
    },
    content: {
      name: `laika-cms-content-${env}`,
      createParams: {
        TableName: `laika-cms-content-${env}`,
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
          { AttributeName: 'GSI2PK', AttributeType: 'S' },
          { AttributeName: 'GSI2SK', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST', // Lowest cost with eventual consistency
      },
    },
  };
}

/**
 * Get CDK-compatible table configuration
 * 
 * This returns the configuration in a format suitable for AWS CDK
 */
export function getCDKTableConfig(env: string = 'dev') {
  const config = getTableConfig(env);
  
  return {
    main: {
      tableName: config.main.name,
      partitionKey: { name: 'PK', type: 'S' as const },
      sortKey: { name: 'SK', type: 'S' as const },
      billingMode: 'PAY_PER_REQUEST' as const,
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: 'S' as const },
          sortKey: { name: 'GSI1SK', type: 'S' as const },
          projectionType: 'ALL' as const,
        },
        {
          indexName: 'GSI2',
          partitionKey: { name: 'GSI2PK', type: 'S' as const },
          sortKey: { name: 'GSI2SK', type: 'S' as const },
          projectionType: 'ALL' as const,
        },
        {
          indexName: 'GSI3',
          partitionKey: { name: 'GSI3PK', type: 'S' as const },
          sortKey: { name: 'GSI3SK', type: 'S' as const },
          projectionType: 'ALL' as const,
        },
      ],
    },
    content: {
      tableName: config.content.name,
      partitionKey: { name: 'PK', type: 'S' as const },
      sortKey: { name: 'SK', type: 'S' as const },
      billingMode: 'PAY_PER_REQUEST' as const,
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: 'S' as const },
          sortKey: { name: 'GSI1SK', type: 'S' as const },
          projectionType: 'ALL' as const,
        },
        {
          indexName: 'GSI2',
          partitionKey: { name: 'GSI2PK', type: 'S' as const },
          sortKey: { name: 'GSI2SK', type: 'S' as const },
          projectionType: 'ALL' as const,
        },
      ],
    },
  };
}
