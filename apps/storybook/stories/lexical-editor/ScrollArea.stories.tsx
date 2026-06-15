import type { Meta, StoryObj } from '@storybook/react-vite';

import { ScrollArea } from '@laikacms/lexical-editor/editor/ui/scroll-area';
import { Separator } from '@laikacms/lexical-editor/editor/ui/separator';

const tags = Array.from({ length: 30 }, (_, index) => `Tag ${index + 1}`);

const meta = {
  title: 'Lexical Editor/UI/ScrollArea',
  component: ScrollArea,
  tags: ['autodocs'],
} satisfies Meta<typeof ScrollArea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Vertical: Story = {
  render: () => (
    <ScrollArea
      style={{
        height: 200,
        width: 220,
        borderRadius: 8,
        border: '1px solid var(--border)',
        padding: '0.5rem 1rem',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Tags</div>
      {tags.map(tag => (
        <div key={tag}>
          <div style={{ padding: '6px 0', fontSize: 14 }}>{tag}</div>
          <Separator />
        </div>
      ))}
    </ScrollArea>
  ),
};
