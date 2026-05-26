import { createRichtextValue, type PortableTextDocument, RichtextValue } from '@laikacloud/portabletext-core';
import { type ReactNode, useMemo, useRef } from 'react';

import { PortableTextEditorView } from '../editor/PortableTextEditorView';
import './register-mappers';

interface DecapField {
  get(key: 'format' | 'placeholder'): string | undefined;
}

interface DecapControlProps {
  /** Stored field value: either a raw string or a live `RichtextValue`. */
  value?: string | RichtextValue;
  /** The field's schema bag — we read `format` and `placeholder`. */
  field: DecapField;
  /** Called with the (mutated) `RichtextValue` on every editor change. */
  onChange: (value: RichtextValue) => void;
}

/**
 * Decap CMS control wrapping `@portabletext/editor`.
 *
 * Builds a `RichtextValue` from the stored string on first render, hands the
 * canonical PT to `PortableTextEditorView`, and writes the editor's PT back
 * onto the proxy whenever the user types — so `toString()` (the expensive
 * serialise step) only fires at file-write time.
 */
export function PortableTextEditorControl({
  value,
  field,
  onChange,
}: DecapControlProps): ReactNode {
  const hint = field.get('format');
  const placeholder = field.get('placeholder');

  const proxyRef = useRef<RichtextValue | null>(null);
  const proxy = useMemo<RichtextValue>(() => {
    if (proxyRef.current !== null) return proxyRef.current;
    proxyRef.current = value instanceof RichtextValue
      ? value
      : createRichtextValue(typeof value === 'string' ? value : '', { hint });
    return proxyRef.current;
  }, [value, hint]);

  const handleChange = (next: PortableTextDocument): void => {
    proxy.setPortableText(next);
    onChange(proxy);
  };

  return (
    <PortableTextEditorView
      initialValue={proxy.portableText}
      onChange={handleChange}
      placeholder={placeholder}
    />
  );
}
