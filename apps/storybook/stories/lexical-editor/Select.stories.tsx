import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from 'decap-cms-widget-lexicaleditor/editor/ui/select';

const meta = {
  title: 'Lexical Editor/UI/Select',
  component: Select,
  tags: ['autodocs'],
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Select defaultValue="normal">
      <SelectTrigger style={{ width: 200 }}>
        <SelectValue placeholder="Select a style" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Text</SelectLabel>
          <SelectItem value="normal">Normal</SelectItem>
          <SelectItem value="h1">Heading 1</SelectItem>
          <SelectItem value="h2">Heading 2</SelectItem>
          <SelectItem value="h3">Heading 3</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Blocks</SelectLabel>
          <SelectItem value="quote">Quote</SelectItem>
          <SelectItem value="code">Code block</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('combobox'));
    await expect(await within(document.body).findByRole('option', { name: /heading 1/i })).toBeInTheDocument();
  },
};
