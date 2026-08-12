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

  // storage-r2 (LCMS-547)
  'storage.r2.fileNotFound': string;
  'storage.r2.directoryNotFound': string;
  'storage.r2.entryAlreadyExists': string;
  'storage.r2.contentRequired': string;
  'storage.r2.invalidRequest': string;
  'storage.r2.failedToReadObject': string;
  'storage.r2.failedToDeleteObject': string;
  'storage.r2.failedToGetObjectMetadata': string;
  'storage.r2.failedToGetDirectoryMetadata': string;
  'storage.r2.failedToListDirectory': string;
  'storage.r2.failedToCreateOrUpdateObject': string;

  // storage-drizzle (LCMS-547)
  'storage.drizzle.fileNotFound': string;
  'storage.drizzle.directoryNotFound': string;
  'storage.drizzle.atomNotFound': string;
  'storage.drizzle.entryAlreadyExists': string;
  'storage.drizzle.contentRequired': string;
  'storage.drizzle.invalidJsonContent': string;
  'storage.drizzle.cannotRemoveFolderKey': string;
  'storage.drizzle.failedToRemoveAtom': string;

  // storage-webdav (LCMS-547)
  'storage.webdav.fileNotFound': string;
  'storage.webdav.directoryNotFound': string;
  'storage.webdav.atomNotFound': string;
  'storage.webdav.entryAlreadyExists': string;
  'storage.webdav.contentRequired': string;
  'storage.webdav.directoryNotEmpty': string;
  'storage.webdav.invalidRequest': string;
  'storage.webdav.authenticationFailed': string;
  'storage.webdav.permissionDenied': string;
  'storage.webdav.resourceNotFound': string;
  'storage.webdav.methodNotAllowed': string;
  'storage.webdav.conflict': string;
  'storage.webdav.resourceLocked': string;
  'storage.webdav.tooManyRequests': string;
  'storage.webdav.serviceUnavailable': string;
  'storage.webdav.serverUnreachable': string;
  'storage.webdav.fetchImplementationMissing': string;
  'storage.webdav.unexpectedError': string;

  // documents-jsonapi-proxy (LCMS-547)
  'documentsJsonapiProxy.invalidResponse': string;
  'documentsJsonapiProxy.lockAttributesMissing': string;
  'documentsJsonapiProxy.lockTimestampInvalid': string;
  'documentsJsonapiProxy.networkError': string;
  'documentsJsonapiProxy.syncTokenMissing': string;
  'documentsJsonapiProxy.unknownRecordType': string;

  // assets-obsidian (LCMS-547)
  'assetsObsidian.fileNotFound': string;
  'assetsObsidian.directoryNotFound': string;
  'assetsObsidian.atomNotFound': string;
  'assetsObsidian.filesystemError': string;
  'assetsObsidian.pathTraversalRejected': string;
  'assetsObsidian.expectedAssetFoundDocument': string;
  'assetsObsidian.expectedFileFoundDirectory': string;
  'assetsObsidian.updateUnsupported': string;

  // documents-obsidian (LCMS-547)
  'documentsObsidian.notPublished': string;
  'documentsObsidian.notUnpublished': string;
  'documentsObsidian.revisionsUnsupported': string;
}

export type TranslationKey = keyof Translation;

export type SupportedLocale = 'en' | 'nl';

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return locale === 'en' || locale === 'nl';
}
