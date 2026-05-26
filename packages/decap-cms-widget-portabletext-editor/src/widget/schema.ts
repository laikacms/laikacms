/**
 * Field-level JSON schema for the `portabletext-editor` widget. Decap reads
 * this when validating CMS configs.
 */
export const schema = {
  type: 'object',
  properties: {
    /** Mapper id used to read the stored value and to serialize on save. */
    format: { type: 'string' },
    /** Placeholder shown when the document is empty. */
    placeholder: { type: 'string' },
  },
};
