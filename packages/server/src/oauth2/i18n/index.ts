/**
 * OAuth2 Internationalization (i18n) Module
 *
 * This module provides the Translation type and default English messages.
 * Users can provide their own translations by passing a Translation object
 * to the OAuthConfig.translations option.
 *
 * @example
 * ```typescript
 * import { type Translation, defaultMessages } from '@laikacms/server/oauth2/i18n';
 *
 * // Use default English messages
 * const config = { translations: defaultMessages };
 *
 * // Or provide custom translations
 * const customMessages: Translation = {
 *   auth: { ... },
 *   totp: { ... },
 *   // ...
 * };
 * const config = { translations: customMessages };
 * ```
 */

import { en, type Translation } from './translations/en.js';
import { nl } from './translations/nl.js';

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

// Export English and Dutch translations
export { en };
export { nl };

// Default messages (English)
export const defaultMessages: OAuthMessages = en;
