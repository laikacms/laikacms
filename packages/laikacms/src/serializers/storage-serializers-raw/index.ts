import type { JSONSchema7 } from 'json-schema';
import type { StorageFormat, StorageObjectContent, StorageSerializer } from 'laikacms/storage';

export const rawSerializer: StorageSerializer<StorageFormat> = {
  format: 'raw' as StorageFormat,
  async serializeDocumentFileContents(
    content: StorageObjectContent,
    _schema: JSONSchema7,
  ): Promise<string> {
    const extraFields = Object.keys(content).filter(k => k !== 'body');
    if (extraFields.length > 0) {
      throw new Error(
        `rawSerializer only persists the 'body' field; fields [${
          extraFields.join(', ')
        }] would be silently dropped. Use jsonSerializer to store multi-field content.`,
      );
    }
    return '' + (content.body ?? '');
  },
  async deserializeDocumentFileContents(
    raw: string,
    _schema: JSONSchema7,
  ): Promise<StorageObjectContent> {
    return { body: raw };
  },
};

export default rawSerializer;
