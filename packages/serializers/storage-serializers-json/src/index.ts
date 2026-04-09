import type { StorageFormat, StorageObjectContent, StorageSerializer } from '@laikacms/storage';
import type { JSONSchema7 } from 'json-schema';

export const jsonSerializer: StorageSerializer<StorageFormat> = {
  format: 'json' as StorageFormat,
  async serializeDocumentFileContents(
    content: StorageObjectContent,
    _schema: JSONSchema7,
  ): Promise<string> {
    return JSON.stringify(content, null, 2);
  },
  async deserializeDocumentFileContents(
    raw: string,
    _schema: JSONSchema7,
  ): Promise<StorageObjectContent> {
    return JSON.parse(raw) as StorageObjectContent;
  },
};

export default jsonSerializer;
