import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from 'decap-cms-widget-lexicaleditor/editor/ui/field';
import { Input } from 'decap-cms-widget-lexicaleditor/editor/ui/input';

const meta = {
  title: 'Lexical Editor/UI/Field',
  component: Field,
  tags: ['autodocs'],
  decorators: [Story => <div style={{ maxWidth: 380 }}><Story /></div>],
} satisfies Meta<typeof Field>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Form: Story = {
  render: () => (
    <FieldSet>
      <FieldLegend>Profile</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input id="name" placeholder="Ada Lovelace" />
          <FieldDescription>This is shown on your public profile.</FieldDescription>
        </Field>
        <FieldSeparator />
        <Field>
          <FieldLabel htmlFor="handle">Handle</FieldLabel>
          <Input id="handle" defaultValue="@ada" aria-invalid />
          <FieldError>Handle is already taken.</FieldError>
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <Field orientation="horizontal">
      <FieldLabel htmlFor="newsletter">Subscribe to the newsletter</FieldLabel>
      <Input id="newsletter" type="checkbox" style={{ width: 16, height: 16 }} />
    </Field>
  ),
};
