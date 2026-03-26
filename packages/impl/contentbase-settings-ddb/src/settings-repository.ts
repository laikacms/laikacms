import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  Result,
  success,
  failure,
  NotFoundError,
  InvalidData,
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

// DynamoDB Key Prefixes
const PREFIX_PROJECT = 'PROJECT';
const PREFIX_SETTINGS = 'SETTINGS';

type SettingsDocument = {
    collections: Record<string, CollectionSettings>;
    schemas: Record<string, JSONSchema7>;
};

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
  private async getSettingsDocument(): Promise<Result<SettingsDocument>> {
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

        return success(settingsObj);
      }

      const settingsData = superjson.deserialize(result.Item.settings);

      return success(settingsData as SettingsDocument);
    } catch (error) {
      console.error(error);
      return failure('internal_error', [`Failed to get settings: ${error}`]);
    }
  }

  /**
   * Update the entire settings document in DynamoDB
   */
  private async putSettingsDocument(document: {
    collections: Record<string, CollectionSettings>;
    schemas: Record<string, JSONSchema7>;
  }): Promise<Result<void>> {
    try {
      await this.docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: this.pk,
          SK: this.sk,
          settings: superjson.serialize(document),
        },
      }));

      return success(undefined);
    } catch (error) {
      console.error(error);
      return failure('internal_error', [`Failed to put settings: ${error}`]);
    }
  }

  async getSettings(): Promise<Result<ContentBaseSettings>> {
    const document = await this.getSettingsDocument();
    if (!document.success) return document;

    const settings: ContentBaseSettings = {
      collections: document.data.collections,
    };

    const parsedSettings = parseSettings(settings);
    if (!parsedSettings.success) return parsedSettings;

    return success(parsedSettings.data);
  }

  async putSettings(settings: ContentBaseSettings): Promise<Result<void>> {
    const document = await this.getSettingsDocument();
    if (!document.success) return document;

    // Update collections while preserving schemas
    document.data.collections = settings.collections;

    return this.putSettingsDocument(document.data);
  }

  async getCollectionSettings(collection: string): Promise<Result<CollectionSettings>> {
    const settings = await this.getSettings();
    if (!settings.success) return settings;

    const collectionSettings = settings.data.collections[collection];
    if (!collectionSettings) {
      return failure(NotFoundError.CODE, [`Collection '${collection}' not found in settings`]);
    }

    return success(collectionSettings);
  }

  async getDocumentCollectionSettings(collection: string): Promise<Result<DocumentCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (!collectionSettings.success) return failure(collectionSettings.code, collectionSettings.messages);
    console.log('Document collection settings:', collectionSettings);
    if (collectionSettings.data.type !== 'document') {
      return failure(InvalidData.CODE, [
        `Settings for document collection '${collection}' are of type '${collectionSettings.data.type}' not of type 'document'.`
      ]);
    }

    return success(collectionSettings.data, collectionSettings.messages);
  }

  async getMediaCollectionSettings(collection: string): Promise<Result<MediaCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (!collectionSettings.success) return failure(collectionSettings.code, collectionSettings.messages);

    if (collectionSettings.data.type !== 'media') {
      return failure(InvalidData.CODE, [
        `Settings for media collection '${collection}' are of type '${collectionSettings.data.type}' not of type 'media'.`
      ]);
    }

    return success(collectionSettings.data, collectionSettings.messages);
  }

  async putCollectionSettings(collection: string, settings: CollectionSettings): Promise<Result<void>> {
    const document = await this.getSettingsDocument();
    if (!document.success) return document;

    // Update the specific collection
    document.data.collections[collection] = settings;

    return this.putSettingsDocument(document.data);
  }

  async putDocumentCollectionSettings(collection: string, settings: DocumentCollectionSettings): Promise<Result<void>> {
    return this.putCollectionSettings(collection, settings);
  }

  async putMediaCollectionSettings(collection: string, settings: MediaCollectionSettings): Promise<Result<void>> {
    return this.putCollectionSettings(collection, settings);
  }

  async getCollectionSchema(collection: string): Promise<Result<JSONSchema7>> {
    const document = await this.getSettingsDocument();
    if (!document.success) return failure(document.code, document.messages);

    const schema = document.data.schemas[collection];
    if (!schema) {
      return failure(NotFoundError.CODE, [`Schema for collection '${collection}' not found`]);
    }

    return success(schema);
  }

  async putCollectionSchema(collection: string, schema: JSONSchema7): Promise<Result<void>> {
    const document = await this.getSettingsDocument();
    if (!document.success) return failure(document.code, document.messages);

    // Update the specific schema
    document.data.schemas[collection] = schema;

    return this.putSettingsDocument(document.data);
  }
}