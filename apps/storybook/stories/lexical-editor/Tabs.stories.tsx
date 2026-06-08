import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tabs, TabsContent, TabsList, TabsTrigger } from 'decap-cms-widget-lexicaleditor/editor/ui/tabs';

const meta = {
  title: 'Lexical Editor/UI/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  decorators: [Story => (
    <div style={{ maxWidth: 420 }}>
      <Story />
    </div>
  )],
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="write">
      <TabsList>
        <TabsTrigger value="write">Write</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="write">Compose your content here.</TabsContent>
      <TabsContent value="preview">A rendered preview of your content.</TabsContent>
      <TabsContent value="settings">Per-document settings.</TabsContent>
    </Tabs>
  ),
};

export const LineVariant: Story = {
  render: () => (
    <Tabs defaultValue="one">
      <TabsList variant="line">
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">First panel.</TabsContent>
      <TabsContent value="two">Second panel.</TabsContent>
    </Tabs>
  ),
};
