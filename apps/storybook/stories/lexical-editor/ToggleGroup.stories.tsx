import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Underline } from 'lucide-react';

import { ToggleGroup, ToggleGroupItem } from 'decap-cms-widget-lexicaleditor/editor/ui/toggle-group';

const meta = {
  title: 'Lexical Editor/UI/ToggleGroup',
  component: ToggleGroup,
  tags: ['autodocs'],
  args: { type: 'multiple' },
} satisfies Meta<typeof ToggleGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Multiple: Story = {
  render: () => (
    <ToggleGroup type="multiple" variant="outline">
      <ToggleGroupItem value="bold" aria-label="Bold"><Bold /></ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Italic"><Italic /></ToggleGroupItem>
      <ToggleGroupItem value="underline" aria-label="Underline"><Underline /></ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const SingleSelection: Story = {
  render: () => (
    <ToggleGroup type="single" defaultValue="left">
      <ToggleGroupItem value="left" aria-label="Align left"><AlignLeft /></ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center"><AlignCenter /></ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right"><AlignRight /></ToggleGroupItem>
    </ToggleGroup>
  ),
};
