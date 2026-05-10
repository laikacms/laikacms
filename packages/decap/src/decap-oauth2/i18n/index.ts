/**
 * Decap OAuth2 Internationalization (i18n) Module
 *
 * This module provides the Translation type and default English messages.
 * Users can provide their own translations by passing a Translation object
 * to the OAuthConfig.messages option.
 *
 * @example
 * ```typescript
 * import { type Translation, defaultMessages } from '@laikacms/decap-oauth2/i18n';
 *
 * // Use default English messages
 * const config = { messages: defaultMessages };
 *
 * // Or provide custom translations
 * const customMessages: Translation = {
 *   auth: { ... },
 *   totp: { ... },
 *   // ...
 * };
 * const config = { messages: customMessages };
 * ```
 */

import { en, type Translation } from './translations/en.js';

// Re-export the Translation type from en.ts
export type { Translation };
export type TranslationKey = keyof Translation;

// Namespace types
export type AuthTranslation = Translation['auth'];
export type TotpTranslation = Translation['totp'];
export type PasskeyTranslation = Translation['passkey'];
export type PasswordResetTranslation = Translation['passwordReset'];
export type EmailTranslation = Translation['email'];
export type ErrorTranslation = Translation['error'];
export type LogoutTranslation = Translation['logout'];
export type CommonTranslation = Translation['common'];

/**
 * OAuthMessages type for passing localized messages to the OAuth2 config.
 * This is the same as Translation but exported with a more descriptive name
 * for use in the OAuthConfig interface.
 */
export type OAuthMessages = Translation;

// Export English translations as the default
export { en };

// Default messages (English)
export const defaultMessages: OAuthMessages = en;
