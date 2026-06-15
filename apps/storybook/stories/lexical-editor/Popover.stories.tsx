import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '@laikacms/lexical-editor/editor/ui/button';
import { Input } from '@laikacms/lexical-editor/editor/ui/input';
import { Label } from '@laikacms/lexical-editor/editor/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@laikacms/lexical-editor/editor/ui/popover';

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
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /edit link/i }));
    await expect(await within(document.body).findByText(/set the destination/i)).toBeInTheDocument();
  },
};
