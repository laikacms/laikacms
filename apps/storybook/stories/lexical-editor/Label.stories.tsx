import type { Meta, StoryObj } from '@storybook/react-vite';

import { Input } from 'decap-cms-widget-lexicaleditor/editor/ui/input';
import { Label } from 'decap-cms-widget-lexicaleditor/editor/ui/label';

const meta = {
  title: 'Lexical Editor/UI/Label',
  component: Label,
  tags: ['autodocs'],
  args: { children: 'Email address' },
} satisfies Meta<typeof Label>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithInput: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.5rem', maxWidth: 320 }}>
      <Label htmlFor="email">Email address</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
};
