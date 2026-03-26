import { StorageSerializer, StorageProvider, StorageObjectContent, storageProviderZ, StorageFormat, storageFormatZ } from '@laikacms/storage';
import { JSONSchema7 } from 'json-schema';

export const markdownSerializer: StorageSerializer<StorageFormat> = {
  format: storageFormatZ.parse('raw'),
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

export default markdownSerializer;
