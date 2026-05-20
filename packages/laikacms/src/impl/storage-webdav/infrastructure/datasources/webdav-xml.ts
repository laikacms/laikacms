/**
 * Minimal, namespace-agnostic parser for WebDAV `multistatus` (RFC 4918)
 * responses. WebDAV servers disagree wildly on namespace prefixes (`d:`, `D:`,
 * `lp1:`, none at all), so rather than a full XML DOM we strip prefixes and
 * pull the handful of properties Laika needs out of each `<response>` block.
 *
 * Deliberately dependency-free — keeps `storage-webdav` runtime-agnostic and
 * avoids pulling an XML library into the bundle.
 */

/** A single resource described by a `PROPFIND` multistatus response. */
export interface WebDavEntry {
  /** Decoded server-absolute href as returned by the server. */
  readonly href: string;
  /** `true` when the resource is a collection (directory). */
  readonly isCollection: boolean;
  /** `getcontentlength` in bytes, when the server reported it. */
  readonly contentLength?: number;
  /** `getlastmodified`, parsed; `undefined` when absent or unparseable. */
  readonly lastModified?: Date;
  /** `creationdate`, parsed; `undefined` when absent or unparseable. */
  readonly creationDate?: Date;
}

/** Request body for a `PROPFIND` that asks for exactly the props we consume. */
export const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop>
    <resourcetype/>
    <getcontentlength/>
    <getlastmodified/>
    <creationdate/>
  </prop>
</propfind>`;

/** Drop XML namespace prefixes from opening/closing tags: `<D:href>` -> `<href>`. */
const stripNamespaces = (xml: string): string => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');

/** Decode the five predefined XML entities plus numeric character references. */
const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');

/** Inner text of the first `<tag>...</tag>` in `block`, or `undefined`. */
const tagContent = (block: string, tag: string): string | undefined => {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1] : undefined;
};

/** Parse a date string defensively — never throws, returns `undefined` on junk. */
const parseDate = (value: string | undefined): Date | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * Parse a `207 Multi-Status` body into a flat list of {@link WebDavEntry}.
 * Order is preserved: for a `Depth: 1` listing the requested collection itself
 * is typically the first entry, followed by its children.
 */
export const parseMultiStatus = (xml: string): WebDavEntry[] => {
  const clean = stripNamespaces(xml);
  const entries: WebDavEntry[] = [];
  const responseRe = /<response(?:\s[^>]*)?>([\s\S]*?)<\/response>/gi;

  let match: RegExpExecArray | null;
  while ((match = responseRe.exec(clean)) !== null) {
    const block = match[1];
    const hrefRaw = tagContent(block, 'href');
    if (hrefRaw === undefined) continue;

    let href = decodeXmlEntities(hrefRaw.trim());
    try {
      href = decodeURIComponent(href);
    } catch {
      // Leave href as-is when it contains invalid percent-escapes.
    }

    const resourceType = tagContent(block, 'resourcetype') ?? '';
    const lengthText = tagContent(block, 'getcontentlength')?.trim();
    const length = lengthText !== undefined && lengthText !== '' ? Number(lengthText) : undefined;

    entries.push({
      href,
      isCollection: /<collection\s*\/?\s*>/i.test(resourceType),
      contentLength: length !== undefined && Number.isFinite(length) ? length : undefined,
      lastModified: parseDate(tagContent(block, 'getlastmodified')),
      creationDate: parseDate(tagContent(block, 'creationdate')),
    });
  }

  return entries;
};
