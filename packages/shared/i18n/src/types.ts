// This file defines the translation type without importing JSON
// so it can be consumed by any module resolution strategy

export interface Translation {
  ok: string;
  cancel: string;
  save: string;
  delete: string;
  edit: string;
  create: string;
  loading: string;
  error: string;
  success: string;
  confirm: string;
  back: string;
  next: string;
  previous: string;
  search: string;
  filter: string;
  sort: string;
  refresh: string;
  close: string;
  open: string;
  yes: string;
  no: string;
  notFound: string;
  unauthorized: string;
  forbidden: string;
  serverError: string;
  networkError: string;
  validationError: string;
  unknownError: string;
  login: string;
  logout: string;
  register: string;
  forgotPassword: string;
  resetPassword: string;
  email: string;
  password: string;
  confirmPassword: string;
  rememberMe: string;
  required: string;
  minLength: string;
  maxLength: string;
  invalidEmail: string;
  invalidUrl: string;
  noPermissionAccessDocument: string;
}

export type TranslationKey = keyof Translation;

export type SupportedLocale = "en" | "nl";

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return locale === "en" || locale === "nl";
}
