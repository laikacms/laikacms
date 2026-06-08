import type { Meta, StoryObj } from '@storybook/react-vite';
import { fromJS } from 'immutable';
import type { ComponentProps } from 'react';
import { Provider } from 'react-redux';

import { AiChatControl } from '@laikacms/decap-ai/widget';

type ControlProps = ComponentProps<typeof AiChatControl>;
type ProviderStore = ComponentProps<typeof Provider>['store'];

// mapStateToProps only reads `entries` (an Immutable map, via getIn) and
// `editorialWorkflow` (short-circuited when undefined), so an empty entries map
// is enough to render.
const mockState = {
  entries: fromJS({ entities: {} }),
  editorialWorkflow: undefined,
};

const store = {
  getState: () => mockState,
  subscribe: () => () => {},
  dispatch: (action: unknown) => action,
} as unknown as ProviderStore;

// A folder collection with a couple of fields and no `i18n` key, so
// getI18nInfo() returns {} and selectFields() takes the folder branch.
const collection = fromJS({
  name: 'posts',
  type: 'folder_based_collection',
  fields: [
    { name: 'title', widget: 'string' },
    { name: 'body', widget: 'markdown' },
  ],
});

const entry = fromJS({
  slug: 'hello-world',
  collection: 'posts',
  data: { title: 'Hello world', body: 'A draft body the assistant can edit.' },
});

const field = fromJS({
  name: 'assistant',
  widget: 'ai-chat',
  welcomeMessage: 'Ask me to draft or edit this document.',
});

// Stub the widget's fetch so the on-mount session lookup resolves to an empty
// list instead of calling a real /api/v1/ai endpoint.
const widget = {
  aiSdk: {
    api: '/api/v1/ai',
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ sessions: [] }) }) as unknown as Response,
  },
};

function AiChatDemo() {
  const props = {
    field,
    entry,
    collection,
    widget,
    metadata: {},
    locale: undefined,
    config: fromJS({}),
    value: undefined,
    onChange: () => {},
    forID: 'ai-chat',
    classNameWrapper: '',
    t: (key: string) => key,
  } as unknown as ControlProps;

  return (
    <div style={{ maxWidth: 480 }}>
      <Provider store={store}>
        <AiChatControl {...props} />
      </Provider>
    </div>
  );
}

const meta = {
  title: 'Decap AI/AI Chat Widget',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The AI chat control is normally a react-redux-connected Decap widget driven by a streaming '
          + 'backend (`useChat`). This story mounts it with a minimal mock redux store and a stubbed '
          + 'fetch so the chat shell renders standalone — actually sending a message still needs a live '
          + 'AI endpoint.',
      },
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Shell: Story = {
  render: () => <AiChatDemo />,
};
