import type { JSONSchema7 } from 'json-schema';
import type { StorageObjectContent } from '../entities/index.js';
import type { StorageFormat } from './storage-format.js';

export interface StorageSerializerRegistry {
  [key: string]: StorageSerializer<StorageFormat>;
}

export interface StorageSerializer<F extends StorageFormat> {
  format: F;
  serializeDocumentFileContents(
    content: StorageObjectContent,
    schema: JSONSchema7,
  ): Promise<string>;

  deserializeDocumentFileContents(
    content: string,
    schema: JSONSchema7,
  ): Promise<StorageObjectContent>;
}
