/**
 * Password Reset Page HTML Templates
 *
 * This module provides HTML templates for the password reset flow:
 * - Forgot password page (request reset)
 * - Forgot password success page
 * - Reset password page (set new password)
 * - Reset password success page
 *
 * Styled to match Decap CMS design system.
 */

import { defaultMessages, type OAuthMessages, type PasswordResetTranslation } from '../i18n/index.js';
import { colors, loginPageStyles } from './decap-styles.js';
import { html, type HtmlTemplate, messages, processCustomLogo, type TemplateVariables } from './html.js';

// Additional styles for password reset pages
const passwordResetStyles = `
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
  .password-hint {
    font-size: 12px;
    color: ${colors.textSecondary};
    margin-top: 5px;
  }
`;

// Success checkmark icon
const successIcon = `<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
  <polyline points="22 4 12 14.01 9 11.01"/>
</svg>`;

// Template symbols for forgot password page
const forgotPageTitle = Symbol('forgotPageTitle');
const forgotTitle = Symbol('forgotTitle');
const forgotDescription = Symbol('forgotDescription');
const forgotFormUrl = Symbol('forgotFormUrl');
const sendResetLink = Symbol('sendResetLink');
const backToLogin = Symbol('backToLogin');
const loginUrl = Symbol('loginUrl');
const errorMessage = Symbol('errorMessage');
const logoHtml = Symbol('logoHtml');
const captchaWidgetHtml = Symbol('captchaWidgetHtml');
const captchaScriptHtml = Symbol('captchaScriptHtml');

// Template symbols for check email page
const checkEmailPageTitle = Symbol('checkEmailPageTitle');
const checkEmailTitle = Symbol('checkEmailTitle');
const checkEmailDescription = Symbol('checkEmailDescription');

// Template symbols for reset password page
const resetPageTitle = Symbol('resetPageTitle');
const resetTitle = Symbol('resetTitle');
const resetDescription = Symbol('resetDescription');
const resetFormUrl = Symbol('resetFormUrl');
const resetToken = Symbol('resetToken');
const newPasswordLabel = Symbol('newPasswordLabel');
const newPasswordPlaceholder = Symbol('newPasswordPlaceholder');
const confirmPasswordLabel = Symbol('confirmPasswordLabel');
const confirmPasswordPlaceholder = Symbol('confirmPasswordPlaceholder');
const passwordHint = Symbol('passwordHint');
const resetButton = Symbol('resetButton');

// Template symbols for success page
const successPageTitle = Symbol('successPageTitle');
const successTitle = Symbol('successTitle');
const successDescription = Symbol('successDescription');
const signInLink = Symbol('signInLink');

/**
 * Template variables type for forgot password page
 */
type ForgotPasswordTemplateVariables = TemplateVariables & {
  [forgotPageTitle]: string,
  [forgotTitle]: string,
  [forgotDescription]: string,
  [forgotFormUrl]: string,
  [sendResetLink]: string,
  [backToLogin]: string,
  [loginUrl]: string,
  [errorMessage]: string,
  [logoHtml]: string,
  [captchaWidgetHtml]: string,
  [captchaScriptHtml]: string,
  [messages]: OAuthMessages,
};

/**
 * Template variables type for check email page
 */
type CheckEmailTemplateVariables = TemplateVariables & {
  [checkEmailPageTitle]: string,
  [checkEmailTitle]: string,
  [checkEmailDescription]: string,
  [backToLogin]: string,
  [loginUrl]: string,
  [logoHtml]: string,
  [messages]: OAuthMessages,
};

/**
 * Template variables type for reset password page
 */
type ResetPasswordTemplateVariables = TemplateVariables & {
  [resetPageTitle]: string,
  [resetTitle]: string,
  [resetDescription]: string,
  [resetFormUrl]: string,
  [resetToken]: string,
  [newPasswordLabel]: string,
  [newPasswordPlaceholder]: string,
  [confirmPasswordLabel]: string,
  [confirmPasswordPlaceholder]: string,
  [passwordHint]: string,
  [resetButton]: string,
  [errorMessage]: string,
  [logoHtml]: string,
  [messages]: OAuthMessages,
};

/**
 * Template variables type for success page
 */
type SuccessTemplateVariables = TemplateVariables & {
  [successPageTitle]: string,
  [successTitle]: string,
  [successDescription]: string,
  [signInLink]: string,
  [loginUrl]: string,
  [logoHtml]: string,
  [messages]: OAuthMessages,
};

/**
 * Forgot password page template
 */
const forgotPasswordPageTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${forgotPageTitle}</title>
  <style>${loginPageStyles}${passwordResetStyles}</style>
  ${captchaScriptHtml}
</head>
<body>
  <div class="logo">${logoHtml}</div>
  
  <div class="auth-container">
    <div id="error-message" class="error-message">${errorMessage}</div>
    
    <form class="auth-form" method="POST" action="${forgotFormUrl}">
      <h2 class="form-title">${forgotTitle}</h2>
      <p class="form-description">${forgotDescription}</p>
      
      <div class="form-group">
        <label class="form-label" for="email">Email</label>
        <input class="form-input" type="email" id="email" name="email" required autocomplete="email" placeholder="Enter your email" />
      </div>
      
      ${captchaWidgetHtml}
      
      <div class="button-group">
        <button class="button button-primary button-full" type="submit">${sendResetLink}</button>
      </div>
      
      <a href="${loginUrl}" class="back-link">${backToLogin}</a>
    </form>
  </div>
</body>
</html>`;

/**
 * Forgot password success page template
 */
const forgotPasswordSuccessTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${checkEmailPageTitle}</title>
  <style>${loginPageStyles}${passwordResetStyles}</style>
</head>
<body>
  <div class="logo">${logoHtml}</div>
  
  <div class="auth-container message-box">
    ${successIcon}
    <h2 class="form-title">${checkEmailTitle}</h2>
    <p class="form-description">${checkEmailDescription}</p>
    <a href="${loginUrl}" class="back-link">${backToLogin}</a>
  </div>
</body>
</html>`;

/**
 * Reset password page template
 */
const resetPasswordPageTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${resetPageTitle}</title>
  <style>${loginPageStyles}${passwordResetStyles}</style>
</head>
<body>
  <div class="logo">${logoHtml}</div>
  
  <div class="auth-container">
    <div id="error-message" class="error-message">${errorMessage}</div>
    
    <form class="auth-form" method="POST" action="${resetFormUrl}">
      <h2 class="form-title">${resetTitle}</h2>
      <p class="form-description">${resetDescription}</p>
      
      <input type="hidden" name="token" value="${resetToken}" />
      
      <div class="form-group">
        <label class="form-label" for="password">${newPasswordLabel}</label>
        <input class="form-input" type="password" id="password" name="password" required autocomplete="new-password" placeholder="${newPasswordPlaceholder}" minlength="8" />
        <p class="password-hint">${passwordHint}</p>
      </div>
      
      <div class="form-group">
        <label class="form-label" for="confirm_password">${confirmPasswordLabel}</label>
        <input class="form-input" type="password" id="confirm_password" name="confirm_password" required autocomplete="new-password" placeholder="${confirmPasswordPlaceholder}" minlength="8" />
      </div>
      
      <div class="button-group">
        <button class="button button-primary button-full" type="submit">${resetButton}</button>
      </div>
    </form>
  </div>
</body>
</html>`;

/**
 * Reset password success page template
 */
const resetPasswordSuccessTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${successPageTitle}</title>
  <style>${loginPageStyles}${passwordResetStyles}</style>
</head>
<body>
  <div class="logo">${logoHtml}</div>
  
  <div class="auth-container message-box">
    ${successIcon}
    <h2 class="form-title">${successTitle}</h2>
    <p class="form-description">${successDescription}</p>
    <a href="${loginUrl}" class="back-link">${signInLink}</a>
  </div>
</body>
</html>`;

/**
 * Options for rendering password reset pages
 */
export interface PasswordResetPageOptions {
  /** Base URL for the OAuth endpoints (e.g., 'https://example.com/api/v1/cms') */
  baseUrl: string;
  /** Optional error message to display */
  error?: string;
  /** Reset token (for reset password page) */
  token?: string;
  /** Custom logo HTML (defaults to Decap CMS logo) */
  customLogo?: string;
  /** Custom login URL (defaults to frontend CMS admin page) */
  loginUrl?: string;
  /** CAPTCHA widget HTML to render in the form */
  captchaWidget?: string;
  /** CAPTCHA script HTML to load in the head */
  captchaScript?: string;
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

// Default login URL uses JavaScript history.back() as a fallback
const DEFAULT_LOGIN_FALLBACK = 'javascript:history.back()';

/**
 * Result of rendering a password reset page
 */
export interface PasswordResetPageResult {
  /** The rendered HTML string */
  html: string;
  /** Additional img-src values to add to CSP (for external logo URLs) */
  imgSrc: string[];
}

/**
 * Render the forgot password page
 * @returns Object with html string and imgSrc array for CSP
 */
export function renderForgotPasswordPage(options: PasswordResetPageOptions): PasswordResetPageResult {
  const msgs = options.messages ?? defaultMessages;
  const t = msgs.passwordReset;

  const formUrl = `${options.baseUrl}/forgot-password`;
  const backUrl = options.loginUrl || DEFAULT_LOGIN_FALLBACK;
  const errorHtml = options.error ? escapeHtml(options.error) : '';
  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options.customLogo);
  const captchaWidgetContent = options.captchaWidget || '';
  const captchaScriptContent = options.captchaScript || '';

  const templateValues: ForgotPasswordTemplateVariables = {
    [forgotPageTitle]: escapeHtml(t.forgotPageTitle),
    [forgotTitle]: escapeHtml(t.forgotTitle),
    [forgotDescription]: escapeHtml(t.forgotDescription),
    [forgotFormUrl]: formUrl,
    [sendResetLink]: escapeHtml(t.sendResetLink),
    [backToLogin]: escapeHtml(t.backToLogin),
    [loginUrl]: backUrl,
    [errorMessage]: errorHtml,
    [logoHtml]: processedLogo.html,
    [captchaWidgetHtml]: captchaWidgetContent,
    [captchaScriptHtml]: captchaScriptContent,
    [messages]: msgs,
  };

  return {
    html: forgotPasswordPageTemplate(templateValues),
    imgSrc: processedLogo.imgSrc,
  };
}

/**
 * Render the forgot password success page
 * @returns Object with html string and imgSrc array for CSP
 */
export function renderForgotPasswordSuccessPage(options: PasswordResetPageOptions): PasswordResetPageResult {
  const msgs = options.messages ?? defaultMessages;
  const t = msgs.passwordReset;

  const backUrl = options.loginUrl || DEFAULT_LOGIN_FALLBACK;
  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options.customLogo);

  const templateValues: CheckEmailTemplateVariables = {
    [checkEmailPageTitle]: escapeHtml(t.checkEmailPageTitle),
    [checkEmailTitle]: escapeHtml(t.checkEmailTitle),
    [checkEmailDescription]: escapeHtml(t.checkEmailDescription),
    [backToLogin]: escapeHtml(t.backToLogin),
    [loginUrl]: backUrl,
    [logoHtml]: processedLogo.html,
    [messages]: msgs,
  };

  return {
    html: forgotPasswordSuccessTemplate(templateValues),
    imgSrc: processedLogo.imgSrc,
  };
}

/**
 * Render the reset password page
 * @returns Object with html string and imgSrc array for CSP
 */
export function renderResetPasswordPage(options: PasswordResetPageOptions): PasswordResetPageResult {
  const msgs = options.messages ?? defaultMessages;
  const t = msgs.passwordReset;

  const formUrl = `${options.baseUrl}/reset-password`;
  const tokenValue = options.token || '';
  const errorHtml = options.error ? escapeHtml(options.error) : '';
  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options.customLogo);

  const templateValues: ResetPasswordTemplateVariables = {
    [resetPageTitle]: escapeHtml(t.resetPageTitle),
    [resetTitle]: escapeHtml(t.resetTitle),
    [resetDescription]: escapeHtml(t.resetDescription),
    [resetFormUrl]: formUrl,
    [resetToken]: tokenValue,
    [newPasswordLabel]: escapeHtml(t.newPasswordLabel),
    [newPasswordPlaceholder]: escapeHtml(t.newPasswordPlaceholder),
    [confirmPasswordLabel]: escapeHtml(t.confirmPasswordLabel),
    [confirmPasswordPlaceholder]: escapeHtml(t.confirmPasswordPlaceholder),
    [passwordHint]: escapeHtml(t.passwordHint),
    [resetButton]: escapeHtml(t.resetButton),
    [errorMessage]: errorHtml,
    [logoHtml]: processedLogo.html,
    [messages]: msgs,
  };

  return {
    html: resetPasswordPageTemplate(templateValues),
    imgSrc: processedLogo.imgSrc,
  };
}

/**
 * Render the reset password success page
 * @returns Object with html string and imgSrc array for CSP
 */
export function renderResetPasswordSuccessPage(options: PasswordResetPageOptions): PasswordResetPageResult {
  const msgs = options.messages ?? defaultMessages;
  const t = msgs.passwordReset;

  const backUrl = options.loginUrl || DEFAULT_LOGIN_FALLBACK;
  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options.customLogo);

  const templateValues: SuccessTemplateVariables = {
    [successPageTitle]: escapeHtml(t.successPageTitle),
    [successTitle]: escapeHtml(t.successTitle),
    [successDescription]: escapeHtml(t.successDescription),
    [signInLink]: escapeHtml(t.signInLink),
    [loginUrl]: backUrl,
    [logoHtml]: processedLogo.html,
    [messages]: msgs,
  };

  return {
    html: resetPasswordSuccessTemplate(templateValues),
    imgSrc: processedLogo.imgSrc,
  };
}
