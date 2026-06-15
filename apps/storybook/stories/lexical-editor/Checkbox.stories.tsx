import type { Meta, StoryObj } from '@storybook/react-vite';

import { Checkbox } from '@laikacms/lexical-editor/editor/ui/checkbox';
import { Label } from '@laikacms/lexical-editor/editor/ui/label';

const meta = {
  title: 'Lexical Editor/UI/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: { defaultChecked: true },
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithLabel: Story = {
  render: () => (
    <Label>
      <Checkbox defaultChecked /> Accept terms and conditions
    </Label>
  ),
};

export const States: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
      <Checkbox aria-label="Unchecked" />
      <Checkbox defaultChecked aria-label="Checked" />
      <Checkbox disabled aria-label="Disabled" />
      <Checkbox disabled defaultChecked aria-label="Disabled checked" />
    </div>
  ),
};
