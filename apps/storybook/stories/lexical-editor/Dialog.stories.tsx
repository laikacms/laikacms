import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from 'decap-cms-widget-lexicaleditor/editor/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'decap-cms-widget-lexicaleditor/editor/ui/dialog';
import { Input } from 'decap-cms-widget-lexicaleditor/editor/ui/input';
import { Label } from 'decap-cms-widget-lexicaleditor/editor/ui/label';

const meta = {
  title: 'Lexical Editor/UI/Dialog',
  component: Dialog,
  tags: ['autodocs'],
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Insert embed</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert embed</DialogTitle>
          <DialogDescription>Paste a URL to embed it in the document.</DialogDescription>
        </DialogHeader>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <Label htmlFor="embed-url">URL</Label>
          <Input id="embed-url" placeholder="https://youtube.com/watch?v=…" />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Insert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
