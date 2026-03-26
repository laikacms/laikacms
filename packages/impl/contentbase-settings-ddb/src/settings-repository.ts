import {
  GetCommand,
  PutCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  LaikaError,
  LaikaResult,
  NotFoundError,
  InvalidData,
  InternalError,
} from "@laikacms/core";
import {
  CollectionSettings,
  ContentBaseSettings,
  ContentBaseSettingsProvider,
  createDefaultSettingsFile,
  DocumentCollectionSettings,
  MediaCollectionSettings,
  parseSettings,
} from "@laikacms/contentbase-settings";
import type { JSONSchema7 } from 'json-schema';
import superjson from 'superjson';
import * as Result from 'effect/Result';

// DynamoDB Key Prefixes
const PREFIX_PROJECT = 'PROJECT';
const PREFIX_SETTINGS = 'SETTINGS';

type SettingsDocument = {
    collections: Record<string, CollectionSettings>;
    schemas: Record<string, JSONSchema7>;
};

/**
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

/**
 * DynamoDB-backed ContentBase settings repository
 * 
 * Stores settings in a single item per project:
 * - PK: PROJECT#{projectId}
 * - SK: SETTINGS
 * - collections: { [collectionName]: CollectionSettings }
 * - schemas: { [collectionName]: JSONSchema7 }
 */
export class DynamoDBContentBaseSettingsProvider extends ContentBaseSettingsProvider {
  private readonly pk: string;
  private readonly sk: string;

  constructor(
    private readonly docClient: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly projectId: string
  ) {
    super();
    this.pk = `${PREFIX_PROJECT}#${projectId}`;
    this.sk = PREFIX_SETTINGS;
  }

  /**
   * Get the entire settings document from DynamoDB
   */
  private async getSettingsDocument(): Promise<LaikaResult<SettingsDocument>> {
    try {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.pk,
          SK: this.sk,
        },
      }));

      if (!result.Item) {
        // Settings don't exist, create default
        const defaultSettings = createDefaultSettingsFile();
        const settingsObj = {
          collections: defaultSettings.collections,
          schemas: {} as Record<string, JSONSchema7>,
        };

        await this.docClient.send(new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: this.pk,
            SK: this.sk,
            settings: superjson.serialize(settingsObj),
          },
        }));

        return Result.succeed(settingsObj);
      }

      const settingsData = superjson.deserialize(result.Item.settings);

      return Result.succeed(settingsData as SettingsDocument);
    } catch (error) {
      console.error(error);
      return Result.fail(new InternalError(`Failed to get settings: ${error}`));
    }
  }

  /**
   * Update the entire settings document in DynamoDB
   */
  private async putSettingsDocument(document: {
    collections: Record<string, CollectionSettings>;
    schemas: Record<string, JSONSchema7>;
  }): Promise<LaikaResult<void>> {
    try {
      await this.docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: this.pk,
          SK: this.sk,
          settings: superjson.serialize(document),
        },
      }));

      return Result.succeed(undefined);
    } catch (error) {
      console.error(error);
      return Result.fail(new InternalError(`Failed to put settings: ${error}`));
    }
  }

  async getSettings(): Promise<LaikaResult<ContentBaseSettings>> {
    const document = await this.getSettingsDocument();
    if (Result.isFailure(document)) {
      return failAs<ContentBaseSettings>(document.failure);
    }

    const settings: ContentBaseSettings = {
      collections: document.success.collections,
    };

    const parsedSettings = parseSettings(settings);
    if (Result.isFailure(parsedSettings)) {
      return failAs<ContentBaseSettings>(parsedSettings.failure);
    }

    return Result.succeed(parsedSettings.success);
  }

  async putSettings(settings: ContentBaseSettings): Promise<LaikaResult<void>> {
    const document = await this.getSettingsDocument();
    if (Result.isFailure(document)) {
      return failAs<void>(document.failure);
    }

    // Update collections while preserving schemas
    document.success.collections = settings.collections;

    return this.putSettingsDocument(document.success);
  }

  async getCollectionSettings(collection: string): Promise<LaikaResult<CollectionSettings>> {
    const settings = await this.getSettings();
    if (Result.isFailure(settings)) {
      return failAs<CollectionSettings>(settings.failure);
    }

    const collectionSettings = settings.success.collections[collection];
    if (!collectionSettings) {
      return Result.fail(new NotFoundError(`Collection '${collection}' not found in settings`));
    }

    return Result.succeed(collectionSettings);
  }

  async getDocumentCollectionSettings(collection: string): Promise<LaikaResult<DocumentCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (Result.isFailure(collectionSettings)) {
      return failAs<DocumentCollectionSettings>(collectionSettings.failure);
    }
    console.log('Document collection settings:', collectionSettings);
    if (collectionSettings.success.type !== 'document') {
      return Result.fail(new InvalidData(
        `Settings for document collection '${collection}' are of type '${collectionSettings.success.type}' not of type 'document'.`
      ));
    }

    return Result.succeed(collectionSettings.success as DocumentCollectionSettings);
  }

  async getMediaCollectionSettings(collection: string): Promise<LaikaResult<MediaCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (Result.isFailure(collectionSettings)) {
      return failAs<MediaCollectionSettings>(collectionSettings.failure);
    }

    if (collectionSettings.success.type !== 'media') {
      return Result.fail(new InvalidData(
        `Settings for media collection '${collection}' are of type '${collectionSettings.success.type}' not of type 'media'.`
      ));
    }

    return Result.succeed(collectionSettings.success as MediaCollectionSettings);
  }

  async putCollectionSettings(collection: string, settings: CollectionSettings): Promise<LaikaResult<void>> {
    const document = await this.getSettingsDocument();
    if (Result.isFailure(document)) {
      return failAs<void>(document.failure);
    }

    // Update the specific collection
    document.success.collections[collection] = settings;

    return this.putSettingsDocument(document.success);
  }

  async putDocumentCollectionSettings(collection: string, settings: DocumentCollectionSettings): Promise<LaikaResult<void>> {
    return this.putCollectionSettings(collection, settings);
  }

  async putMediaCollectionSettings(collection: string, settings: MediaCollectionSettings): Promise<LaikaResult<void>> {
    return this.putCollectionSettings(collection, settings);
  }

  async getCollectionSchema(collection: string): Promise<LaikaResult<JSONSchema7>> {
    const document = await this.getSettingsDocument();
    if (Result.isFailure(document)) {
      return failAs<JSONSchema7>(document.failure);
    }

    const schema = document.success.schemas[collection];
    if (!schema) {
      return Result.fail(new NotFoundError(`Schema for collection '${collection}' not found`));
    }

    return Result.succeed(schema);
  }

  async putCollectionSchema(collection: string, schema: JSONSchema7): Promise<LaikaResult<void>> {
    const document = await this.getSettingsDocument();
    if (Result.isFailure(document)) {
      return failAs<void>(document.failure);
    }

    // Update the specific schema
    document.success.schemas[collection] = schema;

    return this.putSettingsDocument(document.success);
  }
}
