import type { PortableTextDocument } from '../portable-text';

/**
 * A `Mapper` converts between a concrete string representation (markdown,
 * html, contentful-rtf, …) and the canonical Portable Text document.
 *
 * `Mapper` is an interface so multiple serializers for the same logical
 * format can coexist — e.g. a plain `html` mapper and an `html:scripttags`
 * mapper that serialise custom blocks differently. A field's `format`
 * property references a mapper by `id`.
 *
 * Each format package in this monorepo (`portable-text-to-*-mapper`) exports
 * exactly one of these.
 */
export interface Mapper {
  /** Unique id, referenced by a field's `format` property. */
  readonly id: string;
  /** Human-readable label for UIs. */
  readonly label?: string;
  /** Parse a stored string value into a Portable Text document. */
  toPortableText(value: string): PortableTextDocument;
  /** Serialize a Portable Text document back into this mapper's string form. */
  fromPortableText(doc: PortableTextDocument): string;
  /**
   * Confidence in the range 0..1 that `value` is written in this mapper's
   * format. Used by `detectMapper`. Return 0 when the value is clearly not
   * this format.
   */
  detect(value: string): number;
}

/**
 * Backwards-compatibility alias. Older code referred to the interface as
 * `Format`; prefer `Mapper` in new code. Will be removed in a future major.
 *
 * @deprecated Use {@link Mapper} instead.
 */
export type Format = Mapper;
