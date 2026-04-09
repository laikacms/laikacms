/**
 * Logout Page HTML Templates
 *
 * This module provides HTML templates for the logout flow:
 * - Logout success page (single session)
 * - Logout all success page (all sessions)
 *
 * Styled to match Decap CMS design system.
 */

import { defaultMessages, type OAuthMessages } from '../i18n/index.js';
import { colors, loginPageStyles } from './decap-styles.js';
import { getMessages, html, HtmlTemplate, messages, processCustomLogo, TemplateVariables } from './html.js';

// Additional styles for logout pages
const logoutStyles = `
  .message-box {
    text-align: center;
  }
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
  .success-icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 20px;
    color: #38a169;
  }
  .back-link {
    display: block;
    text-align: center;
    margin-top: 20px;
    font-size: 14px;
    color: ${colors.blue};
    text-decoration: none;
  }
  .back-link:hover {
    text-decoration: underline;
  }
`;

// Success checkmark icon
const successIcon = `<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
  <polyline points="22 4 12 14.01 9 11.01"/>
</svg>`;

// Template variable symbols for logout pages
export const loginUrl = Symbol('loginUrl');
export const logoHtml = Symbol('logoHtml');
export const pageTitle = Symbol('pageTitle');
export const title = Symbol('title');
export const description = Symbol('description');
export const backToLoginText = Symbol('backToLoginText');

// Extended template variables type for logout pages
type LogoutTemplateVariables = TemplateVariables & {
  [loginUrl]?: string,
  [logoHtml]?: string,
  [pageTitle]?: string,
  [title]?: string,
  [description]?: string,
  [backToLoginText]?: string,
};

/**
 * Logout success page template
 */
export const logoutSuccessTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>${loginPageStyles}${logoutStyles}</style>
</head>
<body>
  <div class="logo">${logoHtml}</div>
  
  <div class="auth-container message-box">
    ${successIcon}
    <h2 class="form-title">${title}</h2>
    <p class="form-description">${description}</p>
    <a href="${loginUrl}" class="back-link">${backToLoginText}</a>
  </div>
</body>
</html>`;

/**
 * Logout all success page template
 */
export const logoutAllSuccessTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>${loginPageStyles}${logoutStyles}</style>
</head>
<body>
  <div class="logo">${logoHtml}</div>
  
  <div class="auth-container message-box">
    ${successIcon}
    <h2 class="form-title">${title}</h2>
    <p class="form-description">${description}</p>
    <a href="${loginUrl}" class="back-link">${backToLoginText}</a>
  </div>
</body>
</html>`;

/**
 * Options for rendering logout pages
 */
export interface LogoutPageOptions {
  /** Custom logo HTML (defaults to Decap CMS logo) */
  customLogo?: string;
  /** Custom login URL (defaults to JavaScript history.back()) */
  loginUrl?: string;
  /** Localized messages for the logout pages */
  messages?: OAuthMessages;
}

// Default login URL uses JavaScript history.back() as a fallback
const DEFAULT_LOGIN_FALLBACK = 'javascript:history.back()';

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Result of rendering a logout page
 */
export interface LogoutPageResult {
  /** The rendered HTML string */
  html: string;
  /** Additional img-src values to add to CSP (for external logo URLs) */
  imgSrc: string[];
}

/**
 * Render the logout success page
 * @returns Object with html string and imgSrc array for CSP
 */
export function renderLogoutSuccessPage(options: LogoutPageOptions): LogoutPageResult {
  const t = (options.messages ?? defaultMessages).logout;
  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options.customLogo);

  const html = logoutSuccessTemplate({
    [messages]: options.messages ?? defaultMessages,
    [loginUrl]: options.loginUrl || DEFAULT_LOGIN_FALLBACK,
    [logoHtml]: processedLogo.html,
    [pageTitle]: escapeHtml(t.pageTitle),
    [title]: escapeHtml(t.title),
    [description]: escapeHtml(t.description),
    [backToLoginText]: escapeHtml(t.backToLogin),
  } as LogoutTemplateVariables);

  return {
    html,
    imgSrc: processedLogo.imgSrc,
  };
}

/**
 * Render the logout all success page
 * @returns Object with html string and imgSrc array for CSP
 */
export function renderLogoutAllSuccessPage(options: LogoutPageOptions): LogoutPageResult {
  const t = (options.messages ?? defaultMessages).logout;
  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options.customLogo);

  const html = logoutAllSuccessTemplate({
    [messages]: options.messages ?? defaultMessages,
    [loginUrl]: options.loginUrl || DEFAULT_LOGIN_FALLBACK,
    [logoHtml]: processedLogo.html,
    [pageTitle]: escapeHtml(t.allPageTitle),
    [title]: escapeHtml(t.allTitle),
    [description]: escapeHtml(t.allDescription),
    [backToLoginText]: escapeHtml(t.backToLogin),
  } as LogoutTemplateVariables);

  return {
    html,
    imgSrc: processedLogo.imgSrc,
  };
}
