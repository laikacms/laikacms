import { Url } from 'laikacms/core';
import { defaultMessages, type OAuthMessages } from '../i18n/index.js';
import { defaultLogo } from './styles.js';

export const authorizeUrl = Symbol('authorizeUrl');
export const passkeySection = Symbol('passkeySection');
export const passkeyStyles = Symbol('passkeyStyles');
export const passkeyScript = Symbol('passkeyScript');
export const forgotPasswordSection = Symbol('forgotPasswordSection');
export const captchaWidget = Symbol('captchaWidget');
export const captchaScript = Symbol('captchaScript');
export const messages = Symbol('messages');
export const logoHtml = Symbol('logoHtml');

export const templateVars = {
  authorizeUrl,
  passkeySection,
  passkeyStyles,
  passkeyScript,
  forgotPasswordSection,
  captchaWidget,
  captchaScript,
  messages,
  logoHtml,
} as const;

export type TemplateVarsType = typeof templateVars;

export type TemplateVariables = {
  [K in keyof TemplateVarsType as TemplateVarsType[K]]?: K extends 'messages' ? OAuthMessages : string;
};

export type HtmlTemplate = (values: TemplateVariables) => string;

/**
 * Get messages from template variables, falling back to default messages
 */
export function getMessages(values: TemplateVariables): OAuthMessages {
  return (values as Record<symbol, OAuthMessages>)[messages] ?? defaultMessages;
}

/**
 * Tagged template that produces an {@link HtmlTemplate} with symbol-keyed slots.
 *
 * SECURITY: this tag performs NO escaping — every interpolated value is
 * inserted into the output verbatim. Callers MUST escape any value that is
 * not a trusted package constant or deliberately-raw HTML (custom logos,
 * CAPTCHA widgets/scripts) with {@link escapeHtml} / {@link escapeHtmlAttribute}
 * (or {@link jsonForInlineScript} for values embedded in inline scripts)
 * before passing it in.
 */
export function html(strings: TemplateStringsArray, ...keys: (symbol | string | number)[]): HtmlTemplate {
  return (values: TemplateVariables): string => {
    const result: string[] = [strings[0]];
    keys.forEach((key, i) => {
      let value: string;
      if (typeof key === 'symbol') {
        // Special handling for messages symbol - don't stringify it
        if (key === messages) {
          value = ''; // Messages are accessed via getMessages(), not interpolated directly
        } else {
          value = (values as Record<symbol, string>)[key] ?? '';
        }
      } else if (typeof key === 'number') {
        value = String(key);
      } else {
        value = key;
      }
      result.push(value, strings[i + 1]);
    });
    return result.join('');
  };
}

/**
 * Result of processing a custom logo, including the HTML and any CSP img-src additions
 */
export interface ProcessedLogo {
  /** The HTML to render the logo (either raw HTML or an img tag) */
  html: string;
  /** Additional img-src values to add to CSP (empty if logo is inline HTML) */
  imgSrc: string[];
}

/**
 * Process a custom logo value into HTML.
 * - If undefined/empty, returns the built-in default logo
 * - If it's a URL (absolute), wraps it in an <img> tag and returns the origin for CSP
 * - Otherwise, returns the value as-is (assumed to be inline HTML/SVG)
 *
 * @param customLogo - The custom logo value (URL or HTML)
 * @param altText - Alt text for the image (default: 'Logo')
 * @returns ProcessedLogo with html and imgSrc for CSP
 */
export function processCustomLogo(customLogo: string | undefined, altText: string = 'Logo'): ProcessedLogo {
  if (!customLogo) {
    return { html: defaultLogo, imgSrc: [] };
  }

  // Check if it's an absolute URL using the Url utility
  if (Url.isAbsolute(customLogo)) {
    try {
      const url = new URL(customLogo);
      const escapedUrl = escapeHtmlAttribute(customLogo);
      const escapedAlt = escapeHtmlAttribute(altText);
      return {
        html:
          `<img src="${escapedUrl}" alt="${escapedAlt}" style="max-width: 300px; max-height: 80px; height: auto;" />`,
        imgSrc: [url.origin],
      };
    } catch {
      // If URL parsing fails, treat as HTML
      return { html: customLogo, imgSrc: [] };
    }
  }

  // Not a URL, return as-is (assumed to be inline HTML/SVG)
  return { html: customLogo, imgSrc: [] };
}

/**
 * Escape HTML special characters (`&`, `<`, `>`, `"`, `'`) so a string is
 * safe to interpolate into HTML text content.
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Escape a string for use in an HTML attribute.
 * Same character set as {@link escapeHtml} (single implementation); kept as a
 * named alias so call sites document which context they are escaping for.
 */
export function escapeHtmlAttribute(text: string): string {
  return escapeHtml(text);
}

/**
 * Serialize a value to JSON that is safe to embed inside an inline `<script>`.
 * Escapes `<` so a `</script>` (or `<!--`) sequence inside the data cannot
 * terminate the script element early, and U+2028/U+2029 which are line
 * terminators in JavaScript source.
 */
export function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Build a Content-Security-Policy header value with optional custom img-src
 *
 * @param basePolicy - The base CSP policy string
 * @param additionalImgSrc - Additional img-src values to add
 * @returns The complete CSP header value
 */
export function buildCspWithLogo(basePolicy: string, additionalImgSrc: string[]): string {
  if (additionalImgSrc.length === 0) {
    return basePolicy;
  }

  // Find and extend the img-src directive
  const imgSrcMatch = basePolicy.match(/img-src\s+([^;]+)/);
  if (imgSrcMatch) {
    const existingImgSrc = imgSrcMatch[1].trim();
    const newImgSrc = `img-src ${existingImgSrc} ${additionalImgSrc.join(' ')}`;
    return basePolicy.replace(/img-src\s+[^;]+/, newImgSrc);
  }

  // No img-src directive found, add one
  return `${basePolicy}; img-src 'self' data: ${additionalImgSrc.join(' ')}`;
}
