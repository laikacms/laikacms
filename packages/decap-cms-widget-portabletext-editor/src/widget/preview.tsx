import { type PortableTextDocument, RichtextValue } from '@laikacloud/portabletext-core';
import { PortableText, type PortableTextComponents } from '@portabletext/react';
import type { ReactNode } from 'react';

interface DecapPreviewProps {
  value?: string | RichtextValue;
}

/**
 * Decap preview pane. Reuses `@portabletext/react` for the actual render —
 * the same library Sanity uses, so what authors see here matches what most
 * portable-text-consuming sites produce.
 */
export function PortableTextEditorPreview({ value }: DecapPreviewProps): ReactNode {
  if (value === undefined || value === null) return null;
  const doc: PortableTextDocument = value instanceof RichtextValue ? value.portableText : [];
  if (doc.length === 0) return null;
  return <PortableText value={doc as Parameters<typeof PortableText>[0]['value']} components={components} />;
}

const components: PortableTextComponents = {
  block: {
    h1: ({ children }) => <h1>{children}</h1>,
    h2: ({ children }) => <h2>{children}</h2>,
    h3: ({ children }) => <h3>{children}</h3>,
    h4: ({ children }) => <h4>{children}</h4>,
    h5: ({ children }) => <h5>{children}</h5>,
    h6: ({ children }) => <h6>{children}</h6>,
    blockquote: ({ children }) => <blockquote>{children}</blockquote>,
    normal: ({ children }) => <p>{children}</p>,
  },
  marks: {
    strong: ({ children }) => <strong>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    underline: ({ children }) => <u>{children}</u>,
    'strike-through': ({ children }) => <s>{children}</s>,
    code: ({ children }) => <code>{children}</code>,
    sub: ({ children }) => <sub>{children}</sub>,
    sup: ({ children }) => <sup>{children}</sup>,
    highlight: ({ children }) => <mark>{children}</mark>,
    link: ({ children, value }) => {
      const href = (value as { href?: string } | undefined)?.href ?? '#';
      return <a href={href} rel="noreferrer noopener" target="_blank">{children}</a>;
    },
  },
};
