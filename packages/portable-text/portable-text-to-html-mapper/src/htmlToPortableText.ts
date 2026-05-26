import {
  createKeyGenerator,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/** Heading tag -> Portable Text block style. */
const HEADING_STYLES: Record<string, string> = {
  H1: 'h1',
  H2: 'h2',
  H3: 'h3',
  H4: 'h4',
  H5: 'h5',
  H6: 'h6',
};

/** Inline element tag -> Portable Text decorator name. */
const DECORATOR_TAGS: Record<string, string> = {
  STRONG: 'strong',
  B: 'strong',
  EM: 'em',
  I: 'em',
  CODE: 'code',
  S: 'strike-through',
  DEL: 'strike-through',
  STRIKE: 'strike-through',
  U: 'underline',
  SUB: 'sub',
  SUP: 'sup',
  MARK: 'highlight',
};

interface Keys {
  block: () => string;
  span: () => string;
  mark: () => string;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Collapse HTML whitespace runs the way a browser would for non-`pre` text. */
function collapse(text: string): string {
  return text.replace(/[\t\n\r ]+/g, ' ');
}

/** Collect Portable Text spans from the inline content of an element. */
function extractSpans(root: Node, markDefs: PortableTextMarkDefinition[], keys: Keys): PortableTextSpan[] {
  const spans: PortableTextSpan[] = [];
  let current: { text: string, marks: string[], marksKey: string } | null = null;

  const flush = (): void => {
    if (!current) return;
    spans.push({ _type: 'span', _key: keys.span(), text: current.text, marks: current.marks });
    current = null;
  };

  const emit = (text: string, marks: string[]): void => {
    const marksKey = marks.join(' ');
    if (current && current.marksKey === marksKey) current.text += text;
    else {
      flush();
      current = { text, marks: [...marks], marksKey };
    }
  };

  const walk = (node: Node, decorators: string[], linkKey: string | undefined): void => {
    node.childNodes.forEach(child => {
      if (child.nodeType === TEXT_NODE) {
        const text = collapse(child.textContent ?? '');
        if (text) emit(text, linkKey ? [...decorators, linkKey] : decorators);
        return;
      }
      if (child.nodeType !== ELEMENT_NODE) return;
      const element = child as Element;
      const tag = element.tagName;
      if (tag === 'UL' || tag === 'OL' || tag === 'LI') {
        // Nested lists are block content, not inline — handled by walkList.
      } else if (tag === 'BR') {
        emit('\n', linkKey ? [...decorators, linkKey] : decorators);
      } else if (tag === 'A') {
        const key = keys.mark();
        markDefs.push({ _type: 'link', _key: key, href: element.getAttribute('href') ?? '' });
        flush();
        walk(element, decorators, key);
        flush();
      } else if (DECORATOR_TAGS[tag]) {
        walk(element, [...decorators, DECORATOR_TAGS[tag]!], linkKey);
      } else {
        walk(element, decorators, linkKey);
      }
    });
  };

  walk(root, [], undefined);
  flush();
  return spans;
}

function textBlock(element: Element, style: string, keys: Keys): PortableTextDocument[number] {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = extractSpans(element, markDefs, keys);
  return { _type: 'block', _key: keys.block(), style, markDefs, children };
}

function codeBlock(element: Element, keys: Keys): PortableTextDocument[number] {
  const codeEl = element.tagName === 'PRE' ? (element.querySelector('code') ?? element) : element;
  const language = element.getAttribute('data-language')
    ?? (codeEl.getAttribute('class')?.match(/language-([\w-]+)/)?.[1] ?? null);
  return { _type: 'code', _key: keys.block(), code: codeEl.textContent ?? '', language };
}

/** Append the list items of a `ul`/`ol` (and any nested lists) to `out`. */
function walkList(list: Element, out: PortableTextDocument, level: number, keys: Keys): void {
  const listItem = list.tagName === 'OL' ? 'number' : 'bullet';
  for (const item of [...list.children]) {
    if (item.tagName !== 'LI') continue;
    const nestedLists = [...item.children].filter(el => el.tagName === 'UL' || el.tagName === 'OL');
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = extractSpans(item, markDefs, keys);
    out.push({ _type: 'block', _key: keys.block(), style: 'normal', listItem, level, markDefs, children });
    for (const nested of nestedLists) walkList(nested, out, level + 1, keys);
  }
}

/** Append the Portable Text blocks for a run of top-level elements to `out`. */
function walkBlocks(elements: Element[], out: PortableTextDocument, keys: Keys): void {
  for (const element of elements) {
    const tag = element.tagName;
    if (HEADING_STYLES[tag]) {
      out.push(textBlock(element, HEADING_STYLES[tag]!, keys));
    } else if (tag === 'P') {
      out.push(textBlock(element, 'normal', keys));
    } else if (tag === 'BLOCKQUOTE') {
      out.push(textBlock(element, 'blockquote', keys));
    } else if (tag === 'PRE') {
      out.push(codeBlock(element, keys));
    } else if (tag === 'UL' || tag === 'OL') {
      walkList(element, out, 1, keys);
    } else if (tag === 'HR') {
      // No standard Portable Text node for a thematic break — skip.
    } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
      walkBlocks([...element.children], out, keys);
    } else {
      // A stray inline element at the top level — wrap it in a paragraph.
      out.push(textBlock(element, 'normal', keys));
    }
  }
}

/**
 * Convert an HTML string into a Portable Text document.
 *
 * Uses the platform `DOMParser` — available natively in the browser (where the
 * editor widget runs) and provided by `happy-dom`/`jsdom` in tests.
 */
export function htmlToPortableText(html: string): PortableTextDocument {
  const ParserCtor = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!ParserCtor) {
    throw new Error('portable-text-to-html-mapper: no DOMParser available in this environment');
  }
  const doc = new ParserCtor().parseFromString(html, 'text/html');
  const keys: Keys = {
    block: createKeyGenerator('b'),
    span: createKeyGenerator('s'),
    mark: createKeyGenerator('m'),
  };
  const out: PortableTextDocument = [];
  walkBlocks([...doc.body.children], out, keys);
  return out;
}
