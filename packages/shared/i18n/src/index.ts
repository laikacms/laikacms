import { en, type Translation } from "./translations/en";

export type TranslationKey = keyof typeof en;
export type { Translation };

// Export English translations (default)
export { en };

// Default messages (English)
export const defaultMessages = en;
