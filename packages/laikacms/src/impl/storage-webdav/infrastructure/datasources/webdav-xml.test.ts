import { describe, expect, it } from 'vitest';

import { parseMultiStatus } from './webdav-xml.js';

describe('parseMultiStatus', () => {
  it('parses a Nextcloud-style namespaced multistatus into entries', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/dav/files/alice/notes/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/></d:resourcetype>
              <d:getlastmodified>Mon, 19 May 2026 10:00:00 GMT</d:getlastmodified>
              <d:creationdate>2026-05-01T00:00:00Z</d:creationdate>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/files/alice/notes/hello.md</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype/>
              <d:getcontentlength>42</d:getcontentlength>
              <d:getlastmodified>Mon, 19 May 2026 09:30:00 GMT</d:getlastmodified>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      </d:multistatus>`;

    const entries = parseMultiStatus(xml);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      href: '/dav/files/alice/notes/',
      isCollection: true,
      lastModified: new Date('Mon, 19 May 2026 10:00:00 GMT'),
      creationDate: new Date('2026-05-01T00:00:00Z'),
    });
    expect(entries[1]).toMatchObject({
      href: '/dav/files/alice/notes/hello.md',
      isCollection: false,
      contentLength: 42,
    });
  });

  it('handles default-namespaced and percent-encoded hrefs', () => {
    const xml = `<?xml version="1.0"?>
      <multistatus xmlns="DAV:">
        <response>
          <href>/dav/Project%20A/file%20one.json</href>
          <propstat>
            <prop>
              <resourcetype/>
              <getcontentlength>7</getcontentlength>
            </prop>
            <status>HTTP/1.1 200 OK</status>
          </propstat>
        </response>
      </multistatus>`;

    const [entry] = parseMultiStatus(xml);

    expect(entry.href).toBe('/dav/Project A/file one.json');
    expect(entry.isCollection).toBe(false);
    expect(entry.contentLength).toBe(7);
  });

  it('returns an empty list for a body without any response blocks', () => {
    expect(parseMultiStatus(`<?xml version="1.0"?><multistatus xmlns="DAV:"></multistatus>`)).toEqual([]);
  });

  it('leaves dates undefined when they are absent or unparseable', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/x</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype/>
              <d:getlastmodified>not a date at all</d:getlastmodified>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      </d:multistatus>`;

    const [entry] = parseMultiStatus(xml);
    expect(entry.lastModified).toBeUndefined();
    expect(entry.creationDate).toBeUndefined();
  });
});
