export const decapConfig = {
  backend: {
    name: 'laika',
    branch: 'main',
  },
  media_folder: 'static/uploads',
  public_folder: '/uploads',
  collections: [
    {
      name: 'posts',
      label: 'Posts',
      folder: 'posts',
      create: true,
      slug: '{{slug}}',
      extension: 'md',
      fields: [
        { name: 'title', label: 'Title', widget: 'string' },
        { name: 'date', label: 'Date', widget: 'datetime' },
        { name: 'body', label: 'Body', widget: 'markdown' },
      ],
    },
  ],
};
