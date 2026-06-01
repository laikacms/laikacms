import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Asset } from 'laikacms/assets';
import { collectStream, runTask } from 'laikacms/compat';

import { assets, GALLERY_FOLDER } from './assets.js';

const app = new Hono();

app.get('/', async c => {
  let photoItems = '';
  try {
    const { items } = await collectStream(assets.listResources(GALLERY_FOLDER));
    const photoAssets = items.filter((r): r is Asset => r.type === 'asset');

    if (photoAssets.length > 0) {
      const { items: varItems } = await collectStream(assets.getVariations(photoAssets));
      const thumbMap = new Map<string, string>();
      for (const v of varItems) {
        const thumb = v.variations['thumbnail'];
        if (thumb?.url) thumbMap.set(v.key, thumb.url);
      }

      photoItems = photoAssets
        .map(photo => {
          const slug = encodeURIComponent(photo.key);
          const thumbUrl = thumbMap.get(photo.key) ?? '';
          const label = photo.key.replace(`${GALLERY_FOLDER}/`, '');
          return `<li style="display:inline-block;margin:0.5rem">
            <a href="/photo/${slug}">
              <img src="${thumbUrl}" alt="${label}" style="width:150px;height:150px;object-fit:cover;display:block">
              <span style="font-size:0.75rem;color:#666">${label}</span>
            </a>
          </li>`;
        })
        .join('\n');
    }
  } catch {
    photoItems = '<li style="color:#c00">Error listing photos. Check your credentials.</li>';
  }

  const body = photoItems
    ? `<ul style="list-style:none;padding:0;display:flex;flex-wrap:wrap">${photoItems}</ul>`
    : `<p>No photos yet. <a href="/upload">Upload your first photo</a>.</p>`;

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Photo Gallery · Cloudinary</title></head>
<body style="font-family:sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem">
  <h1>Photo Gallery</h1>
  <p style="color:#888">Backed by Cloudinary — variation URLs computed locally (zero extra API calls)</p>
  ${body}
  <p><a href="/upload">Upload →</a></p>
</body>
</html>`);
});

app.get('/photo/:key', async c => {
  const key = decodeURIComponent(c.req.param('key'));
  let content = '';
  try {
    const asset = await runTask(assets.getAsset(key));
    const { items: varItems } = await collectStream(assets.getVariations([asset]));
    const assetVars = varItems.find(v => v.key === key);

    if (assetVars) {
      const varHtml = Object.entries(assetVars.variations)
        .map(([name, v]) => {
          const meta = [v.width ? `${v.width}px` : '', v.mimeType ?? ''].filter(Boolean).join(' · ');
          return `
          <li style="margin-bottom:2rem">
            <strong>${name}</strong>${meta ? ` — ${meta}` : ''}<br>
            <code style="font-size:0.75rem;word-break:break-all;color:#555">${v.url}</code><br>
            <img src="${v.url}" alt="${name}" style="max-width:100%;margin-top:0.5rem;max-height:300px">
          </li>`;
        })
        .join('');
      content = `<ul style="list-style:none;padding:0">${varHtml}</ul>`;
    }
  } catch {
    return c.notFound();
  }

  const label = key.replace(`${GALLERY_FOLDER}/`, '');
  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${label} · Gallery</title></head>
<body style="font-family:sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem">
  <h1>${label}</h1>
  <p style="color:#888">All variation URLs are strings computed locally — zero additional Cloudinary API calls.</p>
  ${content}
  <p><a href="/">← Back to gallery</a></p>
</body>
</html>`);
});

app.get('/upload', c =>
  c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Upload · Gallery</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:2rem auto;padding:0 1rem">
  <h1>Upload a photo</h1>
  <form method="post" enctype="multipart/form-data">
    <label>
      File:<br>
      <input type="file" name="file" accept="image/*" required style="margin:0.5rem 0">
    </label><br>
    <label>
      Name (optional — used as the Cloudinary public_id leaf):<br>
      <input type="text" name="name" placeholder="my-photo" style="margin:0.5rem 0;width:100%">
    </label><br>
    <button type="submit" style="margin-top:1rem">Upload</button>
  </form>
  <p><a href="/">← Back to gallery</a></p>
</body>
</html>`));

app.post('/upload', async c => {
  const form = await c.req.formData();
  const file = form.get('file');
  const name = (form.get('name') as string | null)?.trim();

  if (!(file instanceof File)) return c.text('No file provided', 400);

  const bytes = await file.arrayBuffer();
  const mimeType = file.type || 'image/jpeg';
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const safeName = (name || file.name.replace(/\.[^.]+$/, ''))
    .replace(/[^a-z0-9-_]/gi, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .slice(0, 80);
  const key = `${GALLERY_FOLDER}/${safeName}`;

  try {
    await runTask(
      assets.createAsset({
        key,
        content: new Uint8Array(bytes),
        mimeType,
        filename: `${safeName}.${ext}`,
      }),
    );
  } catch (err) {
    return c.text(`Upload failed: ${err instanceof Error ? err.message : String(err)}`, 500);
  }

  return c.redirect(`/photo/${encodeURIComponent(key)}`);
});

const PORT = Number(process.env['PORT'] ?? 3000);
serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Cloudinary gallery running at http://localhost:${info.port}`);
  console.log(`  Gallery: http://localhost:${info.port}/`);
  console.log(`  Upload:  http://localhost:${info.port}/upload`);
});
