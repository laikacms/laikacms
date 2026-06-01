---
title: Hello with an Image
date: '2026-06-01T00:00:00.000Z'
---

Welcome to the media blog starter! This starter demonstrates how to upload images through Decap CMS and serve them from a LaikaCMS-backed server.

## How it works

1. Open the [Admin panel](/admin/) and create a post
2. Use the markdown body field and click the image button to upload a photo
3. Decap stores the image via the LaikaCMS assets API (base64-encoded in the contentbase)
4. The server's `/uploads/:filename` route decodes and serves the binary

The key code in `src/server.ts`:

```ts
app.get('/uploads/:filename', async c => {
  const obj = await runTask(laika.storage.getObject(`public/uploads/${filename}`));
  const bytes = Buffer.from(obj.content['data'] as string, 'base64');
  return new Response(bytes, { headers: { 'Content-Type': obj.content['mimeType'] as string } });
});
```

Try uploading an image below to see it render inline!
