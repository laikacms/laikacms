import {
  StorageSerializer,
  StorageObjectContent,
  StorageFormat,
} from "@laikacms/storage";
import { JSONSchema7 } from "json-schema";
import yaml from "js-yaml";

export const yamlSerializer: StorageSerializer<StorageFormat> = {
  format: 'yaml' as StorageFormat,
  async serializeDocumentFileContents(
    content: StorageObjectContent,
    _schema: JSONSchema7
  ): Promise<string> {
    return yaml.dump(content, { noRefs: true });
  },
  async deserializeDocumentFileContents(
    raw: string,
    _schema: JSONSchema7
  ): Promise<StorageObjectContent> {
    return yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as StorageObjectContent;
  },
};

export default yamlSerializer;
