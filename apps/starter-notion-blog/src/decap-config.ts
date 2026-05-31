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
      // Notion stores content as plain paragraph blocks — markdown widgets work
      // but rendered output is plain text, not HTML.
      { name: 'body', label: 'Body', widget: 'text' },
    ],
  },
] as const;
