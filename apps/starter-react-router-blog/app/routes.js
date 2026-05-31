import { index, layout, route } from '@react-router/dev/routes';
export default [
  layout('./layouts/blog.tsx', [
    index('./routes/home.tsx'),
    route('/blog/:slug', './routes/blog.$slug.tsx'),
  ]),
  route('/admin', './routes/admin.tsx'),
  route('/api/decap/*', './routes/api.decap.$.tsx'),
];
