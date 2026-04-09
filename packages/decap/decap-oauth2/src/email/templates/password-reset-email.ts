/**
 * Password Reset Email Template
 *
 * HTML email template for password reset requests, styled with Decap CMS design system.
 */

import { decapLogoSvgSmall, emailBaseStyles } from './decap-styles.js';

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
}

/**
 * Generate password reset email HTML
 */
export function renderPasswordResetEmail(vars: PasswordResetEmailVars): string {
  const { resetLink, userName, userEmail, expiresIn, appName, supportEmail } = vars;
  const greeting = userName ? ` ${userName}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>${emailBaseStyles}</style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      ${decapLogoSvgSmall}
    </div>
    <div class="email-body">
      <h1 class="email-title">Reset Your Password</h1>
      <p class="email-text">Hi${greeting},</p>
      <p class="email-text">
        We received a request to reset the password for your account associated with <strong>${userEmail}</strong>.
      </p>
      <p class="email-text">
        Click the button below to reset your password:
      </p>
      <p style="text-align: center;">
        <a href="${resetLink}" class="email-button">Reset Password</a>
      </p>
      <p class="email-text email-muted">
        Or copy and paste this link into your browser:
      </p>
      <div class="email-code">${resetLink}</div>
      <div class="email-warning">
        ⚠️ This link will expire in <strong>${expiresIn}</strong>. If you didn't request a password reset, you can safely ignore this email.
      </div>
    </div>
    <div class="email-footer">
      <p class="email-footer-text">
        This email was sent by ${appName}.<br>
        If you have questions, contact <a href="mailto:${supportEmail}" class="email-link">${supportEmail}</a>
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
  const { resetLink, userName, userEmail, expiresIn, appName, supportEmail } = vars;
  const greeting = userName ? ` ${userName}` : '';

  return `Reset Your Password

Hi${greeting},

We received a request to reset the password for your account associated with ${userEmail}.

Click the link below to reset your password:
${resetLink}

This link will expire in ${expiresIn}. If you didn't request a password reset, you can safely ignore this email.

---
This email was sent by ${appName}.
If you have questions, contact ${supportEmail}`;
}
