import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import type { PortableTextDocument } from '@laikacloud/portabletext-core';
import { PortableTextEditorView } from 'decap-cms-widget-portabletext-editor/editor/PortableTextEditorView';

const initialValue: PortableTextDocument = [
  {
    _type: 'block',
    _key: 'heading',
    style: 'h2',
    markDefs: [],
    children: [{ _type: 'span', _key: 'h-1', text: 'Portable Text editor', marks: [] }],
  },
  {
    _type: 'block',
    _key: 'paragraph',
    style: 'normal',
    markDefs: [],
    children: [
      { _type: 'span', _key: 'p-1', text: 'Edit me. Try ', marks: [] },
      { _type: 'span', _key: 'p-2', text: 'bold', marks: ['strong'] },
      { _type: 'span', _key: 'p-3', text: ' and ', marks: [] },
      { _type: 'span', _key: 'p-4', text: 'italic', marks: ['em'] },
      { _type: 'span', _key: 'p-5', text: ' from the toolbar above.', marks: [] },
    ],
  },
];

function EditorDemo() {
  const [value, setValue] = useState<PortableTextDocument>(initialValue);
  return (
    <div style={{ maxWidth: 640, display: 'grid', gap: 16 }}>
      <PortableTextEditorView
        initialValue={initialValue}
        onChange={setValue}
        placeholder="Start writing…"
      />
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>Current Portable Text value</summary>
        <pre style={{ fontSize: 12, overflow: 'auto', background: 'var(--muted)', padding: 12, borderRadius: 8 }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    </div>
  );
}

const meta = {
  title: 'Portable Text Editor/Editor',
  component: PortableTextEditorView,
  tags: ['autodocs'],
  args: { initialValue, onChange: () => {} },
} satisfies Meta<typeof PortableTextEditorView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <EditorDemo />,
};
