/**
 * Decap CMS field schema for the Lexical widget.
 *
 * Mirrors the recovered v4-era schema shape (format/placeholder/buttons/modes
 * /editor_components) and adds nothing Decap doesn't already know.
 */
export const lexicalEditorWidgetSchema = {
  properties: {
    format: {
      type: 'string',
      // The format id matched against the registered `Format` set. Defaults
      // are: `markdown`, `html`, `portabletext`, `contentful-rtf`.
      description: 'Output format for this rich-text field.',
    },
    placeholder: { type: 'string' },
    minimal: { type: 'boolean' },
    sanitize_preview: { type: 'boolean' },
    buttons: {
      type: 'array',
      items: { type: 'string' },
    },
    editor_components: {
      type: 'array',
      items: { type: 'object' },
    },
    modes: {
      type: 'array',
      items: { type: 'string', enum: ['rich_text', 'raw'] },
      minItems: 1,
    },
  },
} as const;
