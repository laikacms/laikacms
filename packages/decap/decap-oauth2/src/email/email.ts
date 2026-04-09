/**
 * Email module for Decap CMS API
 *
 * Provides a simple, provider-agnostic email interface that works in both
 * Cloudflare Workers and Node.js environments.
 *
 * @module @laikacms/decap-api/email
 */

import { TemplateLiteral as TL } from '@laikacms/core';
import { addTimingJitter, generateSecureRandomString, hashPassword } from '@laikacms/crypto';
import {
  type PasswordResetEmailVars,
  renderPasswordResetEmail,
  renderPasswordResetText,
} from './templates/password-reset-email.js';

// Re-export templates under namespace to avoid conflicts
import type { User } from '../oauth2.js';
import * as emailStyles from './templates/decap-styles.js';
export { emailStyles };

// Re-export password reset email template
export * from './templates/password-reset-email.js';

// ============================================================================
// Email Provider Interface
// ============================================================================

/**
 * Email message structure
 */
export interface EmailMessage {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

/**
 * Email send result
 */
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Email provider interface.
 * Implement this interface to integrate with any email service.
 *
 * Works in both Cloudflare Workers and Node.js environments.
 *
 * @example
 * ```typescript
 * // Cloudflare Workers with MailChannels
 * const mailChannelsProvider: EmailProvider = {
 *   async send(message) {
 *     const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({
 *         personalizations: [{ to: [{ email: message.to }] }],
 *         from: { email: message.from },
 *         subject: message.subject,
 *         content: [
 *           { type: 'text/plain', value: message.text },
 *           { type: 'text/html', value: message.html },
 *         ],
 *       }),
 *     });
 *     return { success: response.ok };
 *   },
 * };
 *
 * // Node.js with Nodemailer
 * const nodemailerProvider: EmailProvider = {
 *   async send(message) {
 *     const info = await transporter.sendMail({
 *       from: message.from,
 *       to: message.to,
 *       subject: message.subject,
 *       text: message.text,
 *       html: message.html,
 *     });
 *     return { success: true, messageId: info.messageId };
 *   },
 * };
 * ```
 */
export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

// ============================================================================
// Password Reset Token Management
// ============================================================================

/**
 * Password reset token data
 */
export interface PasswordResetToken {
  token: string;
  userId: string;
  email: string;
  expiresAt: number;
  createdAt: number;
}

/**
 * Callbacks for password reset functionality
 */
export interface PasswordResetCallbacks {
  /** Store a password reset token */
  storeResetToken(token: PasswordResetToken): Promise<void>;

  /** Get a password reset token by token string */
  getResetToken(token: string): Promise<PasswordResetToken | null>;

  /** Delete a password reset token (after use or expiration) */
  deleteResetToken(token: string): Promise<void>;

  /** Update user's password hash */
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
}

/**
 * Password reset configuration
 */
export interface PasswordResetConfig {
  /** Email provider for sending reset emails */
  emailProvider: EmailProvider;

  /** Callbacks for token and user management */
  callbacks: PasswordResetCallbacks;

  /** Base URL for reset links (e.g., 'https://example.com/reset-password') */
  resetBaseUrl: string | undefined; // defaults to /reset-password under the same base path if not provided

  /** From email address */
  fromEmail: string;

  /** Application name for email templates */
  appName?: string;

  /** Support email for email templates */
  supportEmail?: string;

  /** Token expiration in seconds (default: 3600 = 1 hour) */
  tokenExpiration?: number;

  /** Custom HTML email renderer (optional) */
  renderHtml?: (vars: PasswordResetEmailVars) => string;

  /** Custom plain text email renderer (optional) */
  renderText?: (vars: PasswordResetEmailVars) => string;
}

// Security constants
const RESET_TOKEN_LENGTH = 64; // 384 bits with base62

/**
 * Format duration for display (e.g., "1 hour", "30 minutes")
 */
function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * Request a password reset for a user.
 * Generates a secure token, stores it, and sends a reset email.
 *
 * @param email - User's email address
 * @param config - Password reset configuration
 * @returns Result indicating success or failure
 *
 * @example
 * ```typescript
 * const result = await requestPasswordReset('user@example.com', {
 *   emailProvider: myEmailProvider,
 *   callbacks: myCallbacks,
 *   resetBaseUrl: 'https://example.com/reset-password',
 *   fromEmail: 'noreply@example.com',
 *   appName: 'My CMS',
 * });
 *
 * if (result.success) {
 *   console.log('Reset email sent');
 * }
 * ```
 */
export async function requestPasswordReset(
  user: User,
  config: PasswordResetConfig,
): Promise<{ success: boolean, error?: string }> {
  const {
    emailProvider,
    callbacks,
    resetBaseUrl,
    fromEmail,
    appName = 'Decap CMS',
    supportEmail = fromEmail,
    tokenExpiration = 3600,
    renderHtml = renderPasswordResetEmail,
    renderText = renderPasswordResetText,
  } = config;

  // Generate secure reset token
  const token = generateSecureRandomString(RESET_TOKEN_LENGTH);
  const now = Date.now();

  const resetToken: PasswordResetToken = {
    token,
    userId: user.id,
    email: user.email,
    expiresAt: now + tokenExpiration * 1000,
    createdAt: now,
  };

  // Store the token
  await callbacks.storeResetToken(resetToken);

  // Build reset link
  const resetLink = TL.url`${resetBaseUrl}` + `?token=${encodeURIComponent(token)}`;

  // Render email templates
  const templateVars: PasswordResetEmailVars = {
    resetLink,
    userEmail: user.email,
    expiresIn: formatDuration(tokenExpiration),
    appName,
    supportEmail,
  };

  const html = renderHtml(templateVars);
  const text = renderText(templateVars);

  // Send email
  const result = await emailProvider.send({
    to: user.email,
    from: fromEmail,
    subject: `Reset your ${appName} password`,
    html,
    text,
  });

  if (!result.success) {
    // Delete the token if email failed
    await callbacks.deleteResetToken(token);
    return { success: false, error: result.error || 'Failed to send email' };
  }

  return { success: true };
}

/**
 * Reset a user's password using a valid reset token.
 *
 * @param token - The reset token from the email link
 * @param newPassword - The new password to set
 * @param config - Password reset configuration
 * @param hashPassword - Function to hash the new password
 * @returns Result indicating success or failure
 *
 * @example
 * ```typescript
 * import { resetPassword } from '@laikacms/decap-api/email';
 * import { hashPassword } from '@laikacms/decap-api/oauth2';
 *
 * const result = await resetPassword(
 *   'abc123token',
 *   'newSecurePassword123',
 *   config,
 *   hashPassword
 * );
 *
 * if (result.success) {
 *   console.log('Password reset successfully');
 * }
 * ```
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  config: PasswordResetConfig,
): Promise<{ success: boolean, error?: string }> {
  const { callbacks } = config;

  // Validate inputs
  if (!token || token.length < 32) {
    return { success: false, error: 'Invalid reset token' };
  }

  if (!newPassword || newPassword.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  // Get the reset token
  const resetToken = await callbacks.getResetToken(token);

  if (!resetToken) {
    await addTimingJitter(200);
    return { success: false, error: 'Invalid or expired reset token' };
  }

  // Check if token has expired
  if (resetToken.expiresAt < Date.now()) {
    await callbacks.deleteResetToken(token);
    return { success: false, error: 'Reset token has expired' };
  }

  // Hash the new password
  const passwordHash = await hashPassword(newPassword);

  // Update the user's password
  await callbacks.updateUserPassword(resetToken.userId, passwordHash);

  // Delete the used token
  await callbacks.deleteResetToken(token);

  return { success: true };
}
