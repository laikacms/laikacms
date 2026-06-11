import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DdbStorageRepository } from '@laikacms/aws/storage-ddb';
import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

/**
 * AWS credentials — use any standard mechanism:
 *   - Environment: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION
 *   - IAM role (EC2 / ECS / Lambda) — no explicit credentials needed
 *   - AWS_PROFILE for local named profiles
 *
 * Required env vars:
 *   AWS_REGION       — e.g. us-east-1
 *   DDB_TABLE        — DynamoDB table name (default: laika_storage)
 *   PORT             — HTTP port (default: 3000)
 *
 * DynamoDB table schema (run once with AWS CLI or CDK):
 *   aws dynamodb create-table \
 *     --table-name laika_storage \
 *     --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
 *     --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
 *     --billing-mode PAY_PER_REQUEST
 *
 * Local DynamoDB (docker):
 *   docker run -p 8000:8000 amazon/dynamodb-local
 *   AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
 *   AWS_REGION=us-east-1 DDB_ENDPOINT=http://localhost:8000 pnpm dev
 */

const dynamoClient = new DynamoDBClient(
  process.env['DDB_ENDPOINT']
    ? { endpoint: process.env['DDB_ENDPOINT'] }
    : {},
);
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const storage = new DdbStorageRepository({
  docClient,
  tableName: process.env['DDB_TABLE'] ?? 'laika_storage',
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    raw: rawSerializer,
  },
  defaultFileExtension: 'md',
});

export const laika = createCustomLaika({
  storage,
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export const adminHtml = decapAdminHtml({ decapConfig: laika.decapConfig });
