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

  // Recoverable-warning translation keys — see
  // docs/concepts/recoverable-warning-translations.md for the naming convention.
  // storage-fs (reference implementation, LCMS-471)
  'storage.fs.fileNotFound': string;
  'storage.fs.directoryNotFound': string;
  'storage.fs.permissionDenied': string;
  'storage.fs.directoryNotEmpty': string;
  'storage.fs.expectedFileFoundDirectory': string;
  'storage.fs.expectedDirectoryFoundFile': string;
  'storage.fs.entryTypeUnsupported': string;
  'storage.fs.pathTraversalRejected': string;
  'storage.fs.entryAlreadyExists': string;
  'storage.fs.contentRequired': string;
  'storage.fs.invalidRequest': string;
  'storage.fs.failedToReadFile': string;
  'storage.fs.failedToGetFileMetadata': string;
  'storage.fs.failedToGetDirectoryMetadata': string;
  'storage.fs.failedToListDirectory': string;
  'storage.fs.failedToListDrives': string;
  'storage.fs.unexpectedFileSystemError': string;
}

export type TranslationKey = keyof Translation;

export type SupportedLocale = 'en' | 'nl';

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return locale === 'en' || locale === 'nl';
}
