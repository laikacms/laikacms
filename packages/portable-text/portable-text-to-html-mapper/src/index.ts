import type { Format, PortableTextDocument } from '@laikacloud/portabletext-core';
import { escapeHTML, type PortableTextComponents, type PortableTextOptions, toHTML } from '@portabletext/to-html';

import { htmlToPortableText } from './htmlToPortableText';

export { htmlToPortableText } from './htmlToPortableText';

export interface HtmlFormatOptions {
  /** Format id; defaults to `html`. Use a distinct id for variant serializers. */
  id?: string;
  label?: string;
  /**
   * Extra or overriding Portable Text -> HTML components. This is how a caller
   * customizes how custom blocks are serialized (e.g. as `<script>` tags) —
   * the reason multiple HTML formats can coexist.
   */
  components?: PortableTextComponents;
}

/** Renders a Portable Text `code` block as `<pre><code>`. */
function codeComponent({ value }: { value: { code?: string, language?: string } }): string {
  const language = value.language ? ` data-language="${escapeHTML(value.language)}"` : '';
  return `<pre${language}><code>${escapeHTML(value.code ?? '')}</code></pre>`;
}

function detectHtml(value: string): number {
  if (!/<[a-z!/]/i.test(value)) return 0;
  const blockTags = value.match(/<(p|h[1-6]|ul|ol|li|blockquote|pre|div|table|hr|br)\b/gi);
  return Math.min(1, 0.5 + (blockTags?.length ?? 0) * 0.1);
}

/**
 * Create an HTML {@link Format}. `options.components` lets a caller control how
 * Portable Text — including custom blocks — is serialized to HTML, so several
 * HTML formats (each with a distinct `id`) can be registered side by side.
 */
export function createHtmlFormat(options: HtmlFormatOptions = {}): Format {
  const components = {
    ...options.components,
    types: { code: codeComponent, ...options.components?.types },
  } as PortableTextComponents;

  const htmlOptions: PortableTextOptions = { components, onMissingComponent: false };

  return {
    id: options.id ?? 'html',
    label: options.label ?? 'HTML',
    toPortableText: (value: string): PortableTextDocument => htmlToPortableText(value),
    fromPortableText: (doc: PortableTextDocument): string => toHTML(doc as never, htmlOptions),
    detect: detectHtml,
  };
}

/** The default HTML format. */
export const htmlFormat: Format = createHtmlFormat();

export default htmlFormat;
