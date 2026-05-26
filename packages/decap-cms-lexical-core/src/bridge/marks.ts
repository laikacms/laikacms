/**
 * Lexical text-format bitfield <-> Portable Text decorator names.
 *
 * Lexical stores inline formatting as a numeric bitfield on text nodes;
 * Portable Text stores it as an array of decorator strings on spans.
 */

export const FORMAT_BOLD = 1;
export const FORMAT_ITALIC = 2;
export const FORMAT_STRIKETHROUGH = 4;
export const FORMAT_UNDERLINE = 8;
export const FORMAT_CODE = 16;
export const FORMAT_SUBSCRIPT = 32;
export const FORMAT_SUPERSCRIPT = 64;
export const FORMAT_HIGHLIGHT = 128;

/** Portable Text decorator name -> Lexical format bit. */
const DECORATOR_TO_BIT: Record<string, number> = {
  strong: FORMAT_BOLD,
  em: FORMAT_ITALIC,
  'strike-through': FORMAT_STRIKETHROUGH,
  underline: FORMAT_UNDERLINE,
  code: FORMAT_CODE,
  sub: FORMAT_SUBSCRIPT,
  sup: FORMAT_SUPERSCRIPT,
  highlight: FORMAT_HIGHLIGHT,
};

/** Ordered bit -> decorator pairs; order fixes the decorator array order. */
const BIT_TO_DECORATOR: ReadonlyArray<readonly [number, string]> = [
  [FORMAT_BOLD, 'strong'],
  [FORMAT_ITALIC, 'em'],
  [FORMAT_STRIKETHROUGH, 'strike-through'],
  [FORMAT_UNDERLINE, 'underline'],
  [FORMAT_CODE, 'code'],
  [FORMAT_SUBSCRIPT, 'sub'],
  [FORMAT_SUPERSCRIPT, 'sup'],
  [FORMAT_HIGHLIGHT, 'highlight'],
];

/** True when a mark name is a known decorator (rather than an annotation key). */
export function isDecorator(mark: string): boolean {
  return Object.prototype.hasOwnProperty.call(DECORATOR_TO_BIT, mark);
}

/** Combine Portable Text decorator names into a Lexical format bitfield. */
export function decoratorsToFormat(marks: readonly string[]): number {
  let format = 0;
  for (const mark of marks) {
    const bit = DECORATOR_TO_BIT[mark];
    if (bit) format |= bit;
  }
  return format;
}

/** Expand a Lexical format bitfield into ordered Portable Text decorator names. */
export function formatToDecorators(format: number): string[] {
  const decorators: string[] = [];
  for (const [bit, name] of BIT_TO_DECORATOR) {
    if (format & bit) decorators.push(name);
  }
  return decorators;
}
