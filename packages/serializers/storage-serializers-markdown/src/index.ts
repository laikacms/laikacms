import { StorageSerializer, StorageProvider, StorageObjectContent, storageProviderZ, StorageFormat, storageFormatZ } from '@laikacms/storage';
import { JSONSchema7 } from 'json-schema';
import matter from 'gray-matter';

export const markdownSerializer: StorageSerializer<StorageFormat> = {
  format: storageFormatZ.parse('markdown'),
  async serializeDocumentFileContents(
    content: StorageObjectContent,
    _schema: JSONSchema7
  ): Promise<string> {
    const body = content?.body || '';
    const data = { ...content };
    delete data.body;
    return matter.stringify(body, data);
  },
  async deserializeDocumentFileContents(
    raw: string,
    _schema: JSONSchema7
  ): Promise<StorageObjectContent> {
    const output = matter(raw);
    return { ...(output.data as Record<string, unknown>), body: output.content };
  }
};

export default markdownSerializer;
