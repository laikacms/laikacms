# Decap CMS Integration

## Backend Setup

```bash
pnpm add laikacms hono
```

```typescript
// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import { buildJsonApi as buildAssetsApi } from 'laikacms/assets-api';
import { R2AssetsRepository } from 'laikacms/assets-r2';
import { buildJsonApi as buildDocumentsApi } from 'laikacms/documents-api';
import { DocumentsContentbaseRepository } from 'laikacms/documents-contentbase';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({ origin: ['https://your-site.com'] }));
app.use('/api/*', (c, next) => jwt({ secret: c.env.JWT_SECRET })(c, next));

app.all('/api/documents/*', async c => {
  const repo = new DocumentsContentbaseRepository({ bucket: c.env.CONTENT_BUCKET });
  return buildDocumentsApi({ repo, basePath: '/api/documents' }).fetch(c.req.raw);
});

app.all('/api/assets/*', async c => {
  const repo = new R2AssetsRepository({ bucket: c.env.ASSETS_BUCKET });
  return buildAssetsApi({ repo, basePath: '/api/assets' }).fetch(c.req.raw);
});

export default app;
```

## Frontend Setup

```bash
pnpm add @laikacms/decap decap-cms-app
```

```typescript
// admin/index.tsx
import createLaikaBackend from '@laikacms/decap/decap-cms-backend-laika';
import CMS from 'decap-cms-app';

CMS.registerBackend('laika', createLaikaBackend());
CMS.init();
```

```yaml
# admin/config.yml
backend:
  name: laika
  api_root: https://api.example.com/api

media_folder: uploads
public_folder: /uploads

collections:
  - name: posts
    label: Posts
    folder: posts
    create: true
    fields:
      - { name: title, label: Title, widget: string }
      - { name: body, label: Body, widget: markdown }
```

## OAuth2 Setup

```bash
pnpm add @laikacms/decap
```

The OAuth2 server is exposed as the `@laikacms/decap/decap-oauth2` subpath. Configure your OAuth
provider (GitHub, GitLab, etc.) and deploy the OAuth server.

## Widgets

| Widget       | Subpath                                        |
| ------------ | ---------------------------------------------- |
| AI Chat      | `@laikacms/decap/decap-cms-widget-ai-chat`     |
| Lucide Icons | `@laikacms/decap/decap-cms-widget-lucide-icon` |
| Radix Icons  | `@laikacms/decap/decap-cms-widget-radix-icon`  |

```typescript
import { LucideIconPreview, LucideIconWidget } from '@laikacms/decap/decap-cms-widget-lucide-icon';
import CMS from 'decap-cms-app';

CMS.registerWidget('lucide-icon', LucideIconWidget, LucideIconPreview);
```
