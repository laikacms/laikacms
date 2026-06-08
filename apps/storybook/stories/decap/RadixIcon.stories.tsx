import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ComponentProps, useState } from 'react';

import WidgetIcon from '@laikacms/decap-integrations/decap-cms-widget-radix-icon';

const { controlComponent: IconControl, previewComponent: IconPreview } = WidgetIcon;

type ControlProps = ComponentProps<typeof IconControl>;
type PreviewProps = ComponentProps<typeof IconPreview>;

/** Standalone harness for the Radix icon picker; see the Lucide story for notes. */
function RadixIconControlDemo() {
  const [value, setValue] = useState('HeartIcon');
  const props = {
    value,
    forID: 'radix-icon',
    classNameWrapper: '',
    setActiveStyle: () => {},
    setInactiveStyle: () => {},
    onChange: (next: string) => setValue(next),
    t: (key: string) => key,
  } as unknown as ControlProps;

  return (
    <div style={{ maxWidth: 360 }}>
      <IconControl {...props} />
      <p style={{ marginTop: 12, fontSize: 13 }}>
        Selected: <code>{value || '(none)'}</code>
      </p>
    </div>
  );
}

const meta = {
  title: 'Decap Integrations/Radix Icon Widget',
  tags: ['autodocs'],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Control: Story = {
  render: () => <RadixIconControlDemo />,
};

export const Preview: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
      {['HeartIcon', 'StarIcon', 'RocketIcon', 'CameraIcon'].map(name => (
        <div key={name} style={{ textAlign: 'center' }}>
          <IconPreview {...({ value: name } as unknown as PreviewProps)} />
          <div style={{ fontSize: 12 }}>{name}</div>
        </div>
      ))}
    </div>
  ),
};
