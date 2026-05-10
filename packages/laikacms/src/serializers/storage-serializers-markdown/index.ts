import type { StorageFormat, StorageObjectContent, StorageSerializer } from '@laikacms/storage';
import matter from 'gray-matter';
import type { JSONSchema7 } from 'json-schema';

export const markdownSerializer: StorageSerializer<StorageFormat> = {
  format: 'markdown' as StorageFormat,
  async serializeDocumentFileContents(
    content: StorageObjectContent,
    _schema: JSONSchema7,
  ): Promise<string> {
    const body = content?.body || '';
    const data = { ...content };
    delete data.body;
    return matter.stringify(body, data);
  },
  async deserializeDocumentFileContents(
    raw: string,
    _schema: JSONSchema7,
  ): Promise<StorageObjectContent> {
    const output = matter(raw);
    return { ...(output.data as Record<string, unknown>), body: output.content };
  },
};

export default markdownSerializer;
