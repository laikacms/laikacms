/**
 * OAuth Error Page Template
 *
 * Displays user-friendly error messages for OAuth authentication failures.
 * Styled to match Decap CMS design system.
 */

import { defaultMessages, type OAuthMessages } from '../i18n/index.js';
import { baseStyles, colors, lengths, logoStyles, shadows } from './decap-styles.js';
import type { HtmlTemplate, TemplateVariables } from './html.js';
import { buildCspWithLogo, html, messages, processCustomLogo } from './html.js';

// Template tag for CSS (enables intellisense)
const css = String.raw;

/**
 * Error page specific styles
 */
const errorPageStyles = css`
  .error-container {
    width: 350px;
    margin-top: -30px;
    text-align: center;
  }
  .error-icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 20px;
    color: ${colors.error};
  }
  .error-title {
    font-size: 18px;
    font-weight: 600;
    color: ${colors.textPrimary};
    margin-bottom: 10px;
  }
  .error-description {
    font-size: 14px;
    color: ${colors.textSecondary};
    margin-bottom: 20px;
    line-height: 1.5;
  }
  .error-code {
    background-color: ${colors.errorLight};
    border: 1px solid ${colors.error};
    border-radius: ${lengths.borderRadius};
    color: ${colors.error};
    font-size: 14px;
    padding: 10px 15px;
    margin-bottom: 20px;
  }
  .back-button {
    display: inline-block;
    background-color: ${colors.buttonPrimary};
    color: ${colors.surface};
    padding: 0 30px;
    height: ${lengths.buttonHeight};
    line-height: ${lengths.buttonHeight};
    border-radius: ${lengths.borderRadius};
    text-decoration: none;
    font-weight: 500;
    font-size: 14px;
    box-shadow: ${shadows.button};
    transition: background-color 0.2s ease;
  }
  .back-button:hover {
    background-color: ${colors.buttonPrimaryHover};
  }
`;

/**
 * Error icon SVG
 */
const errorIcon = `<svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="12" cy="12" r="10"/>
  <path d="M12 8v4" stroke-linecap="round"/>
  <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>
</svg>`;

// Template variable symbols for error page
export const pageTitle = Symbol('pageTitle');
export const logoHtml = Symbol('logoHtml');
export const errorTitle = Symbol('errorTitle');
export const errorDescription = Symbol('errorDescription');
export const errorCode = Symbol('errorCode');
export const goBackButtonText = Symbol('goBackButtonText');
export const goBackHref = Symbol('goBackHref');

// Extended template variables type for error page
type ErrorTemplateVariables = TemplateVariables & {
  [pageTitle]?: string,
  [logoHtml]?: string,
  [errorTitle]?: string,
  [errorDescription]?: string,
  [errorCode]?: string,
  [goBackButtonText]?: string,
  [goBackHref]?: string,
};

/**
 * Error page template
 */
export const errorPageTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>
    ${baseStyles}
    ${logoStyles}
    ${errorPageStyles}
  </style>
</head>
<body>
  <div class="logo">${logoHtml}</div>
  
  <div class="error-container">
    ${errorIcon}
    <h1 class="error-title">${errorTitle}</h1>
    <p class="error-description">${errorDescription}</p>
    <div class="error-code">Error: ${errorCode}</div>
    <a href="${goBackHref}" class="back-button">${goBackButtonText}</a>
  </div>
</body>
</html>`;

/**
 * Options for rendering the error page
 */
export interface ErrorPageOptions {
  /** The error code (e.g., 'invalid_request', 'access_denied') */
  error: string;
  /** Human-readable error description */
  errorDescription?: string;
  /** Optional custom logo HTML */
  customLogo?: string;
  /** Optional URL for the "Go Back" button */
  goBackHref?: string;
  /**
   * Localized messages for user-facing strings.
   * If not provided, defaults to English messages.
   */
  messages?: OAuthMessages;
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
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
 * Format error code as a title (e.g., 'invalid_request' -> 'Invalid Request')
 */
function formatErrorTitle(error: string): string {
  return error
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Result of rendering the error page
 */
export interface ErrorPageResult {
  /** The rendered HTML string */
  html: string;
  /** Additional img-src values to add to CSP (for external logo URLs) */
  imgSrc: string[];
}

/**
 * Render the OAuth error page HTML
 * @returns Object with html string and imgSrc array for CSP
 */
export function renderErrorPage(options: ErrorPageOptions): ErrorPageResult {
  const t = options.messages?.error ?? defaultMessages.error;
  const formattedErrorTitle = formatErrorTitle(options.error);
  const description = options.errorDescription || t.defaultDescription;
  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options.customLogo);
  // Replace {{title}} placeholder in pageTitle
  const formattedPageTitle = t.pageTitle.replace('{{title}}', formattedErrorTitle);

  const html = errorPageTemplate({
    [messages]: options.messages ?? defaultMessages,
    [pageTitle]: escapeHtml(formattedPageTitle),
    [logoHtml]: processedLogo.html,
    [errorTitle]: escapeHtml(formattedErrorTitle),
    [errorDescription]: escapeHtml(description),
    [errorCode]: escapeHtml(options.error),
    [goBackButtonText]: escapeHtml(t.goBackButton),
  } as ErrorTemplateVariables);

  return {
    html,
    imgSrc: processedLogo.imgSrc,
  };
}

/**
 * Create an HTTP Response with the error page HTML
 */
export function oauthErrorResponse(
  error: string,
  errorDescription?: string,
  status: number = 400,
  customLogo?: string,
  goBackHref?: string,
  msgs?: OAuthMessages,
): Response {
  const errorPage = renderErrorPage({
    error,
    errorDescription,
    customLogo,
    goBackHref,
    messages: msgs,
  });

  // Build CSP with logo origins if needed
  const baseCsp = "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:";
  const csp = buildCspWithLogo(baseCsp, errorPage.imgSrc);

  return new Response(errorPage.html, {
    status,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': csp,
    },
  });
}
