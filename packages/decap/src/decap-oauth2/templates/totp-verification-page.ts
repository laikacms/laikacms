/**
 * TOTP Verification Page Template
 *
 * Displays the two-factor authentication verification form.
 * Users enter their 6-digit TOTP code from their authenticator app.
 * Styled to match Decap CMS design system.
 */

import { defaultMessages, type OAuthMessages } from '../i18n/index.js';
import {
  baseStyles,
  buttonStyles,
  colors,
  containerStyles,
  errorStyles,
  logoStyles,
  totpStyles,
} from './decap-styles.js';
import type { HtmlTemplate, TemplateVariables } from './html.js';
import { html, messages, processCustomLogo } from './html.js';

// Template tag for CSS (enables intellisense)
const css = String.raw;

/**
 * TOTP verification page specific styles
 */
const totpVerificationStyles = css`
  .form-title {
    font-size: 18px;
    font-weight: 600;
    color: ${colors.textPrimary};
    margin-bottom: 10px;
    text-align: center;
  }
  .form-description {
    font-size: 14px;
    color: ${colors.textSecondary};
    margin-bottom: 25px;
    text-align: center;
    line-height: 1.5;
  }
`;

// Template variable symbols for TOTP verification page
export const pageTitle = Symbol('pageTitle');
export const logoHtml = Symbol('logoHtml');
export const authorizeUrl = Symbol('authorizeUrl');
export const errorHtml = Symbol('errorHtml');
export const title = Symbol('title');
export const description = Symbol('description');
export const inputLabel = Symbol('inputLabel');
export const inputPlaceholder = Symbol('inputPlaceholder');
export const sessionId = Symbol('sessionId');
export const verifyButtonText = Symbol('verifyButtonText');

// Extended template variables type for TOTP verification page
type TotpVerificationTemplateVariables = TemplateVariables & {
  [pageTitle]?: string,
  [logoHtml]?: string,
  [authorizeUrl]?: string,
  [errorHtml]?: string,
  [title]?: string,
  [description]?: string,
  [inputLabel]?: string,
  [inputPlaceholder]?: string,
  [sessionId]?: string,
  [verifyButtonText]?: string,
};

/**
 * TOTP verification page template
 */
export const totpVerificationTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>
    ${baseStyles}
    ${logoStyles}
    ${containerStyles}
    ${errorStyles}
    ${buttonStyles}
    ${totpStyles}
    ${totpVerificationStyles}
  </style>
</head>
<body>
  <div class="logo">${logoHtml}</div>
  
  <form id="totp-verification-form" class="auth-container" method="POST" action="${authorizeUrl}">
    ${errorHtml}
    <h2 class="form-title">${title}</h2>
    <p class="form-description">${description}</p>
    <label for="totp-code" class="visually-hidden">${inputLabel}</label>
    <input type="text" class="totp-input" id="totp-code" name="totp_code" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" autofocus placeholder="${inputPlaceholder}" aria-label="${inputLabel}" />
    <input type="hidden" name="totp_session" value="${sessionId}" />
    <button class="button button-primary button-full" type="submit">${verifyButtonText}</button>
  </form>
  
  <script>
    (function() {
      var totpInput = document.getElementById('totp-code');
      if (totpInput) {
        totpInput.addEventListener('input', function(e) {
          // Only allow digits
          this.value = this.value.replace(/[^0-9]/g, '');
        });
      }
    })();
  </script>
</body>
</html>`;

/**
 * Options for rendering the TOTP verification page
 */
export interface TotpVerificationPageOptions {
  /** The form action URL (OAuth authorize endpoint) */
  authorizeUrl: string;
  /** The TOTP session ID to include in the form */
  sessionId: string;
  /** Optional error message to display */
  error?: string;
  /** Optional custom logo HTML */
  customLogo?: string;
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
 * Result of rendering the TOTP verification page
 */
export interface TotpVerificationPageResult {
  /** The rendered HTML string */
  html: string;
  /** Additional img-src values to add to CSP (for external logo URLs) */
  imgSrc: string[];
}

/**
 * Render the TOTP verification page HTML
 * @returns Object with html string and imgSrc array for CSP
 */
export function renderTotpVerificationPage(options: TotpVerificationPageOptions): TotpVerificationPageResult {
  const t = options.messages?.totp ?? defaultMessages.totp;
  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options.customLogo);
  const errorContent = options.error
    ? `<div class="error-message">${escapeHtml(options.error)}</div>`
    : '<div id="error-message" class="error-message"></div>';

  const html = totpVerificationTemplate({
    [messages]: options.messages ?? defaultMessages,
    [pageTitle]: escapeHtml(t.pageTitle),
    [logoHtml]: processedLogo.html,
    [authorizeUrl]: escapeHtml(options.authorizeUrl),
    [errorHtml]: errorContent,
    [title]: escapeHtml(t.title),
    [description]: escapeHtml(t.description),
    [inputLabel]: escapeHtml(t.inputLabel),
    [inputPlaceholder]: escapeHtml(t.inputPlaceholder),
    [sessionId]: escapeHtml(options.sessionId),
    [verifyButtonText]: escapeHtml(t.verifyButton),
  } as TotpVerificationTemplateVariables);

  return {
    html,
    imgSrc: processedLogo.imgSrc,
  };
}
