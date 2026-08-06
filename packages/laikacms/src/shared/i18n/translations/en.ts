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
};

/**
 * Translation type derived from the English translations structure
 */
export type Translation = typeof en;

export default en;
