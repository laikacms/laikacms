export const blogCollections = [
  {
    name: 'posts',
    label: 'Posts',
    folder: 'posts',
    create: true,
    slug: '{{slug}}',
    fields: [
      { name: 'title', label: 'Title', widget: 'string' },
      { name: 'date', label: 'Date', widget: 'datetime' },
      { name: 'description', label: 'Description', widget: 'string', required: false },
      { name: 'body', label: 'Body', widget: 'markdown' },
    ],
  },
] as const;
