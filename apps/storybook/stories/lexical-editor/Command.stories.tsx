import type { Meta, StoryObj } from '@storybook/react-vite';
import { Calendar as CalendarIcon, Link as LinkIcon, Quote, Smile } from 'lucide-react';
import { expect, userEvent, within } from 'storybook/test';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@laikacms/lexical-editor/editor/ui/command';

const meta = {
  title: 'Lexical Editor/UI/Command',
  component: Command,
  tags: ['autodocs'],
} satisfies Meta<typeof Command>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SlashMenu: Story = {
  render: () => (
    <Command style={{ width: 320, border: '1px solid var(--border)' }}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Blocks">
          <CommandItem value="quote">
            <Quote /> Quote
          </CommandItem>
          <CommandItem value="date">
            <CalendarIcon /> Date <CommandShortcut>⌘D</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Inline">
          <CommandItem value="link">
            <LinkIcon /> Link
          </CommandItem>
          <CommandItem value="emoji">
            <Smile /> Emoji
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText(/type a command/i), 'quote');
    await expect(await canvas.findByText('Quote')).toBeInTheDocument();
    await expect(canvas.queryByText('Emoji')).not.toBeInTheDocument();
  },
};
