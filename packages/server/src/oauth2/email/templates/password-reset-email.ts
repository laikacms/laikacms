/**
 * Password Reset Email Template
 *
 * HTML email template for password reset requests, styled with the built-in design system.
 */

import { defaultMessages, type OAuthMessages } from '../../i18n/index.js';
import { defaultLogoSvgSmall, emailBaseStyles } from './styles.js';

/**
 * Template variables for password reset email
 */
export interface PasswordResetEmailVars {
  resetLink: string;
  userName?: string;
  userEmail: string;
  expiresIn: string;
  appName: string;
  supportEmail: string;
  /** Localized messages for the email. Defaults to English if not provided. */
  messages?: OAuthMessages;
}

/**
 * Generate password reset email HTML
 */
export function renderPasswordResetEmail(vars: PasswordResetEmailVars): string {
  const { resetLink, userName, userEmail, expiresIn, appName, supportEmail, messages } = vars;
  const t = (messages ?? defaultMessages).email;
  const greeting = t.passwordResetGreeting.replace('{{name}}', userName ? ` ${userName}` : '');
  const intro = t.passwordResetIntro.replace('{{email}}', userEmail);
  const warning = t.passwordResetWarning.replace('{{expiresIn}}', expiresIn);
  const footer = t.passwordResetFooter.replace('{{appName}}', appName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.passwordResetSubject}</title>
  <style>${emailBaseStyles}</style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      ${defaultLogoSvgSmall}
    </div>
    <div class="email-body">
      <h1 class="email-title">${t.passwordResetTitle}</h1>
      <p class="email-text">${greeting}</p>
      <p class="email-text">
        ${intro}
      </p>
      <p class="email-text">
        ${t.passwordResetAction}
      </p>
      <p style="text-align: center;">
        <a href="${resetLink}" class="email-button">${t.passwordResetButton}</a>
      </p>
      <p class="email-text email-muted">
        ${t.passwordResetLinkHint}
      </p>
      <div class="email-code">${resetLink}</div>
      <div class="email-warning">
        ${warning}
      </div>
    </div>
    <div class="email-footer">
      <p class="email-footer-text">
        ${footer}<br>
        ${t.passwordResetSupport} <a href="mailto:${supportEmail}" class="email-link">${supportEmail}</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate password reset email plain text
 */
export function renderPasswordResetText(vars: PasswordResetEmailVars): string {
  const { resetLink, userName, userEmail, expiresIn, appName, supportEmail, messages } = vars;
  const t = (messages ?? defaultMessages).email;
  const greeting = t.passwordResetGreeting.replace('{{name}}', userName ? ` ${userName}` : '');
  const intro = t.passwordResetIntro.replace('{{email}}', userEmail).replace(/<\/?strong>/g, '');
  const warning = t.passwordResetWarning.replace('{{expiresIn}}', expiresIn).replace(/<\/?strong>/g, '')
    .replace(/^⚠️\s*/, '');
  const footer = t.passwordResetFooter.replace('{{appName}}', appName);

  return `${t.passwordResetSubject}

${greeting}

${intro}

${t.passwordResetAction}
${resetLink}

${warning}

---
${footer}
${t.passwordResetSupport} ${supportEmail}`;
}
