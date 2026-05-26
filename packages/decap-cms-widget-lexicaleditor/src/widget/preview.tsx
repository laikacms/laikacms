import { PortableText } from '@portabletext/react';
import type { ReactNode } from 'react';

import { createRichtextValue, type PortableTextDocument, RichtextValue } from 'decap-cms-lexical-core';

import './register-formats';

interface LexicalPreviewProps {
  /** Stored field value — either a live `RichtextValue` proxy or a raw string. */
  value?: string | RichtextValue | PortableTextDocument;
  field?: { format?: string };
}

/**
 * Decap CMS preview component for the Lexical widget.
 *
 * Renders the canonical Portable Text representation via `@portabletext/react`.
 * Works whether Decap passes the live proxy or the original raw string.
 */
export function LexicalPreview({ value, field }: LexicalPreviewProps): ReactNode {
  const hint = field?.format;
  let portableText: PortableTextDocument = [];

  if (value instanceof RichtextValue) {
    portableText = value.portableText;
  } else if (typeof value === 'string') {
    portableText = createRichtextValue(value, { hint }).portableText;
  } else if (Array.isArray(value)) {
    portableText = value;
  }

  return <PortableText value={portableText} />;
}
