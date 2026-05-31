/**
 * Minimal filesystem-backed WebDAV server for local development.
 *
 * Implements only the RFC 4918 operations that WebDavStorageRepository uses:
 *   PROPFIND  — list a collection or describe a resource (Depth: 0 or 1)
 *   GET       — read a resource body
 *   PUT       — create or overwrite a resource
 *   DELETE    — remove a resource
 *   MKCOL     — create a collection (directory)
 *
 * In production, swap WEBDAV_URL to point at a real WebDAV server (Nextcloud,
 * ownCloud, Apache mod_dav, nginx-dav, rclone serve webdav, etc.).
 * The storage layer is identical — only the URL changes.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'webdav-content');
mkdirSync(ROOT, { recursive: true });

function pathToFs(urlPath: string): string {
  const segments = decodeURIComponent(urlPath)
    .split('/')
    .filter(s => s.length > 0);
  return join(ROOT, ...segments);
}

function isoOrRfc(date: Date): { iso: string, rfc: string } {
  return { iso: date.toISOString(), rfc: date.toUTCString() };
}

function propfindXml(
  entries: Array<{ href: string, isDir: boolean, size: number, stat: Stats }>,
): string {
  const responses = entries
    .map(e => {
      const dates = isoOrRfc(e.stat.mtime);
      const cdates = isoOrRfc(e.stat.birthtime || e.stat.mtime);
      const href = e.href.endsWith('/') ? e.href : e.isDir ? e.href + '/' : e.href;
      return `<d:response>
  <d:href>${href}</d:href>
  <d:propstat>
    <d:prop>
      <d:resourcetype>${e.isDir ? '<d:collection/>' : ''}</d:resourcetype>
      ${e.isDir ? '' : `<d:getcontentlength>${e.size}</d:getcontentlength>`}
      <d:getlastmodified>${dates.rfc}</d:getlastmodified>
      <d:creationdate>${cdates.iso}</d:creationdate>
    </d:prop>
    <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
</d:response>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const method = (req.method ?? 'GET').toUpperCase();
  const urlPath = req.url ?? '/';
  const fsPath = pathToFs(urlPath);

  if (method === 'PROPFIND') {
    if (!existsSync(fsPath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const depth = (req.headers['depth'] as string | undefined) ?? '0';
    const stat = statSync(fsPath);
    const isDir = stat.isDirectory();
    const hrefBase = urlPath.endsWith('/') ? urlPath : isDir ? urlPath + '/' : urlPath;
    const entries: Array<{ href: string, isDir: boolean, size: number, stat: Stats }> = [
      { href: hrefBase, isDir, size: stat.size, stat: stat as Stats },
    ];
    if (depth === '1' && isDir) {
      for (const child of readdirSync(fsPath)) {
        const childFs = join(fsPath, child);
        const childStat = statSync(childFs) as Stats;
        const childIsDir = childStat.isDirectory();
        const childHref = hrefBase + encodeURIComponent(child);
        entries.push({ href: childHref, isDir: childIsDir, size: childStat.size, stat: childStat });
      }
    }
    const xml = propfindXml(entries);
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
    return;
  }

  if (method === 'GET') {
    if (!existsSync(fsPath) || statSync(fsPath).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const data = readFileSync(fsPath);
    res.writeHead(200, { 'Content-Length': data.byteLength });
    res.end(data);
    return;
  }

  if (method === 'PUT') {
    const parentDir = join(fsPath, '..');
    if (!existsSync(parentDir)) {
      res.writeHead(409);
      res.end();
      return;
    }
    void readBody(req).then(body => {
      writeFileSync(fsPath, body, 'utf8');
      res.writeHead(existsSync(fsPath) ? 204 : 201);
      res.end();
    });
    return;
  }

  if (method === 'DELETE') {
    if (!existsSync(fsPath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    rmSync(fsPath, { recursive: true });
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === 'MKCOL') {
    if (existsSync(fsPath)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const parentDir = join(fsPath, '..');
    if (!existsSync(parentDir)) {
      res.writeHead(409);
      res.end();
      return;
    }
    mkdirSync(fsPath);
    res.writeHead(201);
    res.end();
    return;
  }

  res.writeHead(405);
  res.end();
}

export function startDevWebDav(port = 4918): void {
  createServer(handleRequest).listen(port, () => {
    console.log(`  WebDAV: http://localhost:${port}  (serving ./webdav-content/)`);
  });
}
