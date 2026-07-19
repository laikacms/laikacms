import { dump, JSON_SCHEMA, load } from 'js-yaml';
import type { JSONSchema7 } from 'json-schema';
import type { StorageFormat, StorageObjectContent, StorageSerializer } from 'laikacms/storage';

export const yamlSerializer: StorageSerializer<StorageFormat> = {
  format: 'yaml' as StorageFormat,
  async serializeDocumentFileContents(
    content: StorageObjectContent,
    _schema: JSONSchema7,
  ): Promise<string> {
    return dump(content, { noRefs: true });
  },
  async deserializeDocumentFileContents(
    raw: string,
    _schema: JSONSchema7,
  ): Promise<StorageObjectContent> {
    return load(raw, { schema: JSON_SCHEMA }) as StorageObjectContent;
  },
};

export default yamlSerializer;
