import type { Meta, StoryObj } from '@storybook/react-vite';

import { Input } from 'decap-cms-widget-lexicaleditor/editor/ui/input';

const meta = {
  title: 'Lexical Editor/UI/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    type: { control: 'select', options: ['text', 'email', 'password', 'number', 'search'] },
  },
  args: {
    placeholder: 'Type something…',
    disabled: false,
    type: 'text',
  },
  decorators: [Story => (
    <div style={{ maxWidth: 320 }}>
      <Story />
    </div>
  )],
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Disabled: Story = {
  args: { disabled: true, placeholder: 'Disabled' },
};

export const WithValue: Story = {
  args: { defaultValue: 'Hello world' },
};
