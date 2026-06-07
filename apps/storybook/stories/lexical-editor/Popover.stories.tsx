import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from 'decap-cms-widget-lexicaleditor/editor/ui/button';
import { Input } from 'decap-cms-widget-lexicaleditor/editor/ui/input';
import { Label } from 'decap-cms-widget-lexicaleditor/editor/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from 'decap-cms-widget-lexicaleditor/editor/ui/popover';

const meta = {
  title: 'Lexical Editor/UI/Popover',
  component: Popover,
  tags: ['autodocs'],
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Edit link</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Link</PopoverTitle>
          <PopoverDescription>Set the destination for the selected text.</PopoverDescription>
        </PopoverHeader>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <Label htmlFor="href">URL</Label>
          <Input id="href" defaultValue="https://laikacms.com" />
        </div>
      </PopoverContent>
    </Popover>
  ),
};
