import type { Meta, StoryObj } from '@storybook/react-vite';

import { Editor, EditorGlobalStyles } from '@laikacms/lexical-editor';
import { DEFAULT_EDITOR_SCHEMA, defineSchema } from '@laikacms/lexical-editor/core';

/**
 * The same `Editor` rendered under two schemas. The schema drives which
 * authoring controls appear — note how the markdown-like schema hides tables,
 * embeds, columns, date-time, sub/superscript, etc.
 */
const meta = {
  title: 'Lexical Editor/Editor (Schema)',
  component: Editor,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Editor>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A markdown-friendly subset: no tables, embeds, columns, date-time or sub/sup. */
const markdownSchema = defineSchema({
  decorators: [{ name: 'strong' }, { name: 'em' }, { name: 'code' }],
  styles: [
    { name: 'normal' },
    { name: 'h1' },
    { name: 'h2' },
    { name: 'h3' },
    { name: 'blockquote' },
  ],
  lists: [{ name: 'bullet' }, { name: 'number' }],
  annotations: [{ name: 'link', fields: [{ name: 'href', type: 'string' }] }],
  blockObjects: [{ name: 'code' }, { name: 'image' }, { name: 'divider' }],
  inlineObjects: [],
});

/** Full vocabulary — every control available. */
export const FullSchema: Story = {
  render: () => (
    <>
      <EditorGlobalStyles />
      <Editor schema={DEFAULT_EDITOR_SCHEMA} />
    </>
  ),
};

/** Restricted, markdown-like schema. */
export const MarkdownSchema: Story = {
  render: () => (
    <>
      <EditorGlobalStyles />
      <Editor schema={markdownSchema} />
    </>
  ),
};
