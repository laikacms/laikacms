import { StorageSerializer, StorageObjectContent, StorageFormat } from '@laikacms/storage';
import { JSONSchema7 } from 'json-schema';

export const rawSerializer: StorageSerializer<StorageFormat> = {
  format: 'raw' as StorageFormat,
  async serializeDocumentFileContents(
    content: StorageObjectContent,
    _schema: JSONSchema7
  ): Promise<string> {
    return '' + (content.body ?? '')
  },
  async deserializeDocumentFileContents(
    raw: string,
    _schema: JSONSchema7
  ): Promise<StorageObjectContent> {
    return { body: raw }
  }
};

export default rawSerializer;
