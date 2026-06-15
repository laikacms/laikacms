import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bold } from 'lucide-react';

import { Toggle } from '@laikacms/lexical-editor/editor/ui/toggle';

const meta = {
  title: 'Lexical Editor/UI/Toggle',
  component: Toggle,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'outline'] },
    size: { control: 'inline-radio', options: ['default', 'sm', 'lg'] },
    disabled: { control: 'boolean' },
  },
  args: { variant: 'default', size: 'default', disabled: false, children: 'Bold' },
} satisfies Meta<typeof Toggle>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithIcon: Story = {
  args: { children: <Bold />, 'aria-label': 'Toggle bold' },
};

export const Outline: Story = {
  args: { variant: 'outline', children: <Bold />, 'aria-label': 'Toggle bold' },
};
