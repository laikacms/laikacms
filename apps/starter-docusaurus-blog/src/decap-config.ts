export const blogCollections = [
  {
    name: 'posts',
    label: 'Blog Posts',
    folder: 'blog',
    create: true,
    slug: '{{year}}-{{month}}-{{day}}-{{slug}}',
    sortable_fields: ['title', 'date'],
    fields: [
      { label: 'Title', name: 'title', widget: 'string' },
      { label: 'Date', name: 'date', widget: 'datetime' },
      { label: 'Description', name: 'description', widget: 'string', required: false },
      { label: 'Body', name: 'body', widget: 'markdown' },
    ],
  },
] as const;
