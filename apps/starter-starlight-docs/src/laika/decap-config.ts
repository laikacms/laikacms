export const docsCollections = [
  {
    name: 'docs',
    label: 'Documentation',
    folder: 'docs',
    create: true,
    slug: '{{slug}}',
    extension: 'md',
    fields: [
      { label: 'Title', name: 'title', widget: 'string' },
      { label: 'Description', name: 'description', widget: 'string', required: false },
      {
        label: 'Sidebar',
        name: 'sidebar',
        widget: 'object',
        required: false,
        fields: [
          { label: 'Order', name: 'order', widget: 'number', required: false },
          { label: 'Label', name: 'label', widget: 'string', required: false },
          { label: 'Hidden', name: 'hidden', widget: 'boolean', required: false, default: false },
        ],
      },
      { label: 'Body', name: 'body', widget: 'markdown' },
    ],
  },
] as const;
