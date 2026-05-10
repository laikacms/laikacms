import type { StorageFormat, StorageObjectContent, StorageSerializer } from '@laikacms/storage';
import yaml from 'js-yaml';
import type { JSONSchema7 } from 'json-schema';

export const yamlSerializer: StorageSerializer<StorageFormat> = {
  format: 'yaml' as StorageFormat,
  async serializeDocumentFileContents(
    content: StorageObjectContent,
    _schema: JSONSchema7,
  ): Promise<string> {
    return yaml.dump(content, { noRefs: true });
  },
  async deserializeDocumentFileContents(
    raw: string,
    _schema: JSONSchema7,
  ): Promise<StorageObjectContent> {
    return yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as StorageObjectContent;
  },
};

export default yamlSerializer;
