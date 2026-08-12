/**
 * English translations for core i18n
 */

export const en = {
  ok: 'OK',
  cancel: 'Cancel',
  save: 'Save',
  delete: 'Delete',
  edit: 'Edit',
  create: 'Create',
  loading: 'Loading...',
  error: 'Error',
  success: 'Success',
  confirm: 'Confirm',
  back: 'Back',
  next: 'Next',
  previous: 'Previous',
  search: 'Search',
  filter: 'Filter',
  sort: 'Sort',
  refresh: 'Refresh',
  close: 'Close',
  open: 'Open',
  yes: 'Yes',
  no: 'No',
  notFound: 'Not found',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  serverError: 'Server error',
  networkError: 'Network error',
  validationError: 'Validation error',
  unknownError: 'Unknown error',
  login: 'Log in',
  logout: 'Log out',
  register: 'Register',
  forgotPassword: 'Forgot password?',
  resetPassword: 'Reset password',
  email: 'Email',
  password: 'Password',
  confirmPassword: 'Confirm password',
  rememberMe: 'Remember me',
  required: 'This field is required',
  minLength: 'Must be at least {{min}} characters',
  maxLength: 'Must be at most {{max}} characters',
  invalidEmail: 'Must be a valid email address',
  invalidUrl: 'Must be a valid URL',
  noPermissionAccessDocument: 'You do not have permission to access this document',

  // Recoverable-warning translation keys — see
  // docs/concepts/recoverable-warning-translations.md for the naming convention.
  // storage-fs (reference implementation, LCMS-471)
  'storage.fs.fileNotFound': 'The requested file could not be found.',
  'storage.fs.directoryNotFound': 'The requested folder could not be found.',
  'storage.fs.permissionDenied': 'You do not have the necessary file system permissions for this operation.',
  'storage.fs.directoryNotEmpty': 'The folder could not be deleted because it still contains items.',
  'storage.fs.expectedFileFoundDirectory': 'A file was expected here, but a folder was found instead.',
  'storage.fs.expectedDirectoryFoundFile': 'A folder was expected here, but a file was found instead.',
  'storage.fs.entryTypeUnsupported': 'Only files and folders can be managed here.',
  'storage.fs.pathTraversalRejected': 'The requested path is outside the allowed storage location.',
  'storage.fs.entryAlreadyExists': 'An item with this key already exists.',
  'storage.fs.contentRequired': 'Content is required to create this item.',
  'storage.fs.invalidRequest': 'The request could not be processed.',
  'storage.fs.failedToReadFile': 'The file could not be read.',
  'storage.fs.failedToGetFileMetadata': 'The file metadata could not be retrieved.',
  'storage.fs.failedToGetDirectoryMetadata': 'The folder metadata could not be retrieved.',
  'storage.fs.failedToListDirectory': 'The folder contents could not be listed.',
  'storage.fs.failedToListDrives': 'The available drives could not be listed.',
  'storage.fs.unexpectedFileSystemError': 'An unexpected file system error occurred.',

  // storage-r2 (LCMS-547)
  'storage.r2.fileNotFound': 'The requested file could not be found.',
  'storage.r2.directoryNotFound': 'The requested folder could not be found.',
  'storage.r2.entryAlreadyExists': 'An item with this key already exists.',
  'storage.r2.contentRequired': 'Content is required to create this item.',
  'storage.r2.invalidRequest': 'The request could not be processed.',
  'storage.r2.failedToReadObject': 'The object contents could not be read.',
  'storage.r2.failedToDeleteObject': 'The object could not be deleted.',
  'storage.r2.failedToGetObjectMetadata': 'The object metadata could not be retrieved.',
  'storage.r2.failedToGetDirectoryMetadata': 'The folder metadata could not be retrieved.',
  'storage.r2.failedToListDirectory': 'The folder contents could not be listed.',
  'storage.r2.failedToCreateOrUpdateObject': 'The object could not be created or updated.',

  // storage-drizzle (LCMS-547)
  'storage.drizzle.fileNotFound': 'The requested object could not be found.',
  'storage.drizzle.directoryNotFound': 'The requested folder could not be found.',
  'storage.drizzle.atomNotFound': 'No item was found at this key.',
  'storage.drizzle.entryAlreadyExists': 'An item with this key already exists.',
  'storage.drizzle.contentRequired': 'Content is required to create this item.',
  'storage.drizzle.invalidJsonContent': 'The stored content is not valid JSON.',
  'storage.drizzle.cannotRemoveFolderKey': 'This key cannot be removed because it is a folder with items in it.',
  'storage.drizzle.failedToRemoveAtom': 'The item could not be removed.',

  // storage-webdav (LCMS-547)
  'storage.webdav.fileNotFound': 'The requested file could not be found.',
  'storage.webdav.directoryNotFound': 'The requested folder could not be found.',
  'storage.webdav.atomNotFound': 'No item was found at this key.',
  'storage.webdav.entryAlreadyExists': 'An item with this key already exists.',
  'storage.webdav.contentRequired': 'Content is required to create this item.',
  'storage.webdav.directoryNotEmpty': 'The folder could not be deleted because it still contains items.',
  'storage.webdav.invalidRequest': 'The request could not be processed.',
  'storage.webdav.authenticationFailed': 'Authentication with the WebDAV server failed.',
  'storage.webdav.permissionDenied': 'You do not have the necessary permissions for this operation.',
  'storage.webdav.resourceNotFound': 'The requested resource could not be found.',
  'storage.webdav.methodNotAllowed': 'The WebDAV server does not allow this operation.',
  'storage.webdav.conflict': 'The request conflicts with the current state of the WebDAV server.',
  'storage.webdav.resourceLocked': 'The resource is locked and cannot be modified right now.',
  'storage.webdav.tooManyRequests': 'The WebDAV server is rate-limiting requests. Please try again later.',
  'storage.webdav.serviceUnavailable': 'The WebDAV server is currently unavailable.',
  'storage.webdav.serverUnreachable': 'The WebDAV server could not be reached.',
  'storage.webdav.fetchImplementationMissing': 'No network client is available to talk to the WebDAV server.',
  'storage.webdav.unexpectedError': 'An unexpected error occurred while talking to the WebDAV server.',

  // documents-jsonapi-proxy (LCMS-547)
  'documentsJsonapiProxy.invalidResponse': 'The response from the upstream server could not be processed.',
  'documentsJsonapiProxy.lockAttributesMissing': 'The upstream server returned an incomplete lock.',
  'documentsJsonapiProxy.lockTimestampInvalid': 'The upstream server returned a lock with an invalid timestamp.',
  'documentsJsonapiProxy.networkError': 'The upstream server could not be reached.',
  'documentsJsonapiProxy.syncTokenMissing': 'The upstream server did not return a sync token.',
  'documentsJsonapiProxy.unknownRecordType': 'The upstream server returned a record of an unknown type.',

  // assets-obsidian (LCMS-547)
  'assetsObsidian.fileNotFound': 'The requested asset could not be found in the vault.',
  'assetsObsidian.directoryNotFound': 'The requested folder could not be found in the vault.',
  'assetsObsidian.atomNotFound': 'No asset or folder was found at this key.',
  'assetsObsidian.filesystemError': 'A vault file system error occurred.',
  'assetsObsidian.pathTraversalRejected': 'The requested path is outside the allowed vault location.',
  'assetsObsidian.expectedAssetFoundDocument': 'This key belongs to a document, not an asset.',
  'assetsObsidian.expectedFileFoundDirectory': 'A file was expected here, but a folder was found instead.',
  'assetsObsidian.updateUnsupported':
    'Assets in an Obsidian vault have no metadata to update; replace the file instead.',

  // documents-obsidian (LCMS-547)
  'documentsObsidian.notPublished': 'This note exists but is not a published document.',
  'documentsObsidian.notUnpublished': 'This note exists but is published, not an unpublished draft.',
  'documentsObsidian.revisionsUnsupported': 'The Obsidian backend has no version history; revisions are unsupported.',
};

/**
 * Translation type derived from the English translations structure
 */
export type Translation = typeof en;

export default en;
