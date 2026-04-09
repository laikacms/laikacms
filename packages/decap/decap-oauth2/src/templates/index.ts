/**
 * OAuth2 HTML Templates
 *
 * This module exports HTML templates for the OAuth2 authentication flow,
 * including login pages with passkey and TOTP support.
 */

export {
  authorizeUrl,
  buildCspWithLogo,
  forgotPasswordSection,
  html,
  logoHtml,
  passkeyScript,
  passkeySection,
  passkeyStyles,
  processCustomLogo,
  templateVars,
} from './html.js';
export type { HtmlTemplate, ProcessedLogo, TemplateVariables, TemplateVarsType } from './html.js';

// Authorization page template (main login page)
export {
  defaultAuthorizationPageTemplate,
  generatePasskeyScript,
  getAuthorizationPageHTML,
} from './authorization-page.js';

export type {
  AuthorizationPageOptions,
  AuthorizationPageResult,
  AuthPagePasskeyOptions,
} from './authorization-page.js';

// Login page template with passkey and TOTP support
export { generateWebAuthnScript, renderEnhancedLoginPage } from './login-page.js';

export type { EnhancedLoginPageOptions, EnhancedLoginPageResult, PasskeyAuthOptions } from './login-page.js';

// Error page template
export { oauthErrorResponse, renderErrorPage } from './error.js';

// Export types
export type { ErrorPageOptions, ErrorPageResult } from './error.js';

// TOTP verification page template
export { renderTotpVerificationPage } from './totp-verification-page.js';

// Export types
export type { TotpVerificationPageOptions, TotpVerificationPageResult } from './totp-verification-page.js';

// TOTP setup page
export { renderTotpSetupPage } from './totp-setup-page.js';

// Passkey setup page
export { renderPasskeySetupPage } from './passkey-setup-page.js';

// Password reset pages
export {
  renderForgotPasswordPage,
  renderForgotPasswordSuccessPage,
  renderResetPasswordPage,
  renderResetPasswordSuccessPage,
} from './password-reset-pages.js';

// Export types
export type { PasswordResetPageOptions, PasswordResetPageResult } from './password-reset-pages.js';

// Logout pages
export { renderLogoutAllSuccessPage, renderLogoutSuccessPage } from './logout-page.js';

// Export types
export type { LogoutPageOptions, LogoutPageResult } from './logout-page.js';

// Re-export decap styles under a namespace to avoid conflicts with email templates
import * as decapStyles from './decap-styles.js';
export { decapStyles };

// Also export commonly used items directly
export { backIcon, decapLogo, loginPageStyles, passkeyIcon } from './decap-styles.js';
