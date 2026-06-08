import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ComponentProps, useState } from 'react';

import WidgetIcon from '@laikacms/decap-integrations/decap-cms-widget-lucide-icon';

const { controlComponent: IconControl, previewComponent: IconPreview } = WidgetIcon;

type ControlProps = ComponentProps<typeof IconControl>;
type PreviewProps = ComponentProps<typeof IconPreview>;

/**
 * The real widget receives a large `CmsWidgetControlProps` object from Decap's
 * editor. Here we supply only the fields the control actually reads and cast to
 * the full type so the picker can run standalone.
 */
function LucideIconControlDemo() {
  const [value, setValue] = useState('Heart');
  const props = {
    value,
    forID: 'lucide-icon',
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
  title: 'Decap Integrations/Lucide Icon Widget',
  tags: ['autodocs'],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Control: Story = {
  render: () => <LucideIconControlDemo />,
};

export const Preview: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
      {['Heart', 'Star', 'Rocket', 'Camera'].map(name => (
        <div key={name} style={{ textAlign: 'center' }}>
          <IconPreview {...({ value: name } as unknown as PreviewProps)} />
          <div style={{ fontSize: 12 }}>{name}</div>
        </div>
      ))}
    </div>
  ),
};
