import type * as Cause from 'effect/Cause';
import type { TranslationKey } from 'laikacms/i18n';

type ErrorSource = { pointer: string } | { parameter: string };

// Pass the actual error into the cause field.
export abstract class LaikaError<C extends ErrorCode = ErrorCode, S extends number = number> extends Error {
  public static TITLE: string; // PUBLIC
  public static STATUS: number; // PUBLIC
  public static CODE: ErrorCode; // PUBLIC
  public jsonApiSource?: ErrorSource | undefined; // PUBLIC
  public translation?: { title?: TranslationKey, message?: TranslationKey }; // PUBLIC
  public status: S; // PUBLIC
  public code: C; // PUBLIC
  public title: string; // PUBLIC

  constructor(
    message?: /* PUBLIC */ string,
    options?: {
      translation?: { title?: TranslationKey | undefined, message?: TranslationKey | undefined } | undefined,
      jsonApiSource?: ErrorSource | undefined,
      cause?: Cause.Cause<unknown> | unknown, /* PRIVATE */
    },
  ) {
    super(message, options);
    this.status = new.target.STATUS as S; // PUBLIC
    this.jsonApiSource = options?.jsonApiSource; // PUBLIC
    this.translation = options?.translation; // PUBLIC
    this.code = new.target.CODE as C; // PUBLIC
    this.title = new.target.TITLE; // PUBLIC
    // Restore the prototype to the *actual* subclass that was constructed
    // (NotFoundError, BadRequestError, …) — `super(message, options)` clobbers
    // it on some runtimes when extending Error. Using `LaikaError.prototype`
    // here used to break every `instanceof NotFoundError` check downstream.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const errorCode = {
  NOT_IMPLEMENTED: 'not_implemented',
  ILLEGAL_STATE: 'illegal_state',
  NOT_FOUND: 'not_found',
  BAD_REQUEST: 'bad_request',
  FORBIDDEN: 'forbidden',
  AUTHENTICATION_ERROR: 'unauthenticated',
  AUTHORIZATION_ERROR: 'unauthorized',
  DIR_INSTEAD_OF_FILE: 'dir_instead_of_file',
  INVALID_DATA: 'invalid_data',
  INTERNAL_ERROR: 'internal_error',
  FILE_INSTEAD_OF_DIR: 'file_instead_of_dir',
  VERSIONING_MISMATCH: 'version_mismatch',
  LOCK_CONFLICT: 'lock_conflict',
  VALIDATION_ERROR: 'validation_error',
  ENTRY_ALREADY_EXISTS: 'entry_already_exists',
  CONFLICT: 'conflict',
  TOO_MANY_REQUESTS: 'too_many_requests',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  GATEWAY_TIMEOUT: 'gateway_timeout',
  UNKNOWN_ERROR: 'unknown_error',
  AUTHORIZER_FAILURE: 'authorizer_failure', // reserved for API Gateway authorizer failures
  // File sanitizer errors
  UNSUPPORTED_FILE_TYPE: 'unsupported_file_type',
  DANGEROUS_FILE_TYPE: 'dangerous_file_type',
  CORRUPTED_FILE: 'corrupted_file',
  EMBEDDED_CONTENT: 'embedded_content',
  FILE_TOO_LARGE: 'file_too_large',
  // Storage capacity errors
  QUOTA_EXCEEDED: 'quota_exceeded',
  // Storage access errors
  PERMISSION_DENIED: 'permission_denied',
  PERMISSION_PROMPT_REQUIRED: 'permission_prompt_required',
  STALE_HANDLE: 'stale_handle',
} as const;

export type ErrorCode = typeof errorCode[keyof typeof errorCode];
export type ErrorKey = keyof typeof errorCode;

export const errorStatus = {
  NOT_IMPLEMENTED: 501,
  ILLEGAL_STATE: 500,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  AUTHORIZATION_ERROR: 401,
  AUTHENTICATION_ERROR: 401,
  DIR_INSTEAD_OF_FILE: 403,
  FILE_INSTEAD_OF_DIR: 403,
  INVALID_DATA: 400,
  INTERNAL_ERROR: 500,
  VERSIONING_MISMATCH: 409,
  // 423 Locked, deliberately distinct from the 409 the version rung uses, so a
  // client can branch on status alone (ADR-007).
  LOCK_CONFLICT: 423,
  VALIDATION_ERROR: 400,
  ENTRY_ALREADY_EXISTS: 409,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  UNKNOWN_ERROR: 500,
  AUTHORIZER_FAILURE: 500,
  // File sanitizer errors
  UNSUPPORTED_FILE_TYPE: 415, // Unsupported Media Type
  DANGEROUS_FILE_TYPE: 415, // Unsupported Media Type
  CORRUPTED_FILE: 422, // Unprocessable Entity
  EMBEDDED_CONTENT: 422, // Unprocessable Entity
  FILE_TOO_LARGE: 413, // Payload Too Large
  // Storage capacity errors
  QUOTA_EXCEEDED: 507, // Insufficient Storage
  // Storage access errors
  PERMISSION_DENIED: 403,
  PERMISSION_PROMPT_REQUIRED: 403,
  STALE_HANDLE: 410, // Gone — the handle's underlying resource no longer exists
} as const satisfies Record<ErrorKey, number>;

export type ErrorStatus = typeof errorStatus[keyof typeof errorStatus];

export class NotImplementedError
  extends LaikaError<typeof errorCode.NOT_IMPLEMENTED, typeof errorStatus.NOT_IMPLEMENTED>
{
  public static override TITLE = 'Not Implemented';
  public static override CODE = errorCode.NOT_IMPLEMENTED;
  public static override STATUS = errorStatus.NOT_IMPLEMENTED;
}
export class IllegalStateException
  extends LaikaError<typeof errorCode.ILLEGAL_STATE, typeof errorStatus.ILLEGAL_STATE>
{
  public static override TITLE = 'Illegal State';
  public static override CODE = errorCode.ILLEGAL_STATE;
  public static override STATUS = errorStatus.ILLEGAL_STATE;
}
export class NotFoundError extends LaikaError<typeof errorCode.NOT_FOUND, typeof errorStatus.NOT_FOUND> {
  public static override TITLE = 'Not Found';
  public static override CODE = errorCode.NOT_FOUND;
  public static override STATUS = errorStatus.NOT_FOUND;
}
export class BadRequestError extends LaikaError<typeof errorCode.BAD_REQUEST, typeof errorStatus.BAD_REQUEST> {
  public static override TITLE = 'Bad Request';
  public static override CODE = errorCode.BAD_REQUEST;
  public static override STATUS = errorStatus.BAD_REQUEST;
}
/**
 * Authenticated, but this principal may not perform this action — HTTP 403.
 * This is the authorization denial: the caller has proven who they are and the
 * answer is still no. Also covers refusals unrelated to identity (deleting a
 * non-empty folder, a method the backend does not allow).
 *
 * Picking between the three auth errors:
 *
 * - {@link AuthenticationError} (401) — the caller has not proven *who* they
 *   are: absent, malformed, or rejected credentials.
 * - `ForbiddenError` (403) — the caller is authenticated but not permitted.
 * - {@link AuthorizationError} (401) — **not** "logged in but no permission".
 *   Despite the name it is the deserialization target for a 401 challenge
 *   received *from a remote server* (see `json-api/utilities.ts`). Do not reach
 *   for it on an authorization denial — that would answer 401 where the caller
 *   is in fact authenticated, telling them to re-authenticate when re-trying
 *   the credential cannot help.
 */
export class ForbiddenError extends LaikaError<typeof errorCode.FORBIDDEN, typeof errorStatus.FORBIDDEN> {
  public static override TITLE = 'Forbidden';
  public static override CODE = errorCode.FORBIDDEN;
  public static override STATUS = errorStatus.FORBIDDEN;
}
export class DirInsteadOfFile
  extends LaikaError<typeof errorCode.DIR_INSTEAD_OF_FILE, typeof errorStatus.DIR_INSTEAD_OF_FILE>
{
  public static override TITLE = 'Directory Instead of File';
  public static override CODE = errorCode.DIR_INSTEAD_OF_FILE;
  public static override STATUS = errorStatus.DIR_INSTEAD_OF_FILE;
}
export class FileInsteadOfDir
  extends LaikaError<typeof errorCode.FILE_INSTEAD_OF_DIR, typeof errorStatus.FILE_INSTEAD_OF_DIR>
{
  public static override TITLE = 'File Instead of Directory';
  public static override CODE = errorCode.FILE_INSTEAD_OF_DIR;
  public static override STATUS = errorStatus.FILE_INSTEAD_OF_DIR;
}
export class InvalidData extends LaikaError<typeof errorCode.INVALID_DATA, typeof errorStatus.INVALID_DATA> {
  public static override TITLE = 'Invalid Data';
  public static override CODE = errorCode.INVALID_DATA;
  public static override STATUS = errorStatus.INVALID_DATA;
}
export class InternalError extends LaikaError<typeof errorCode.INTERNAL_ERROR, typeof errorStatus.INTERNAL_ERROR> {
  public static override TITLE = 'Internal Error';
  public static override CODE = errorCode.INTERNAL_ERROR;
  public static override STATUS = errorStatus.INTERNAL_ERROR;
}
export class VersionMismatchError
  extends LaikaError<typeof errorCode.VERSIONING_MISMATCH, typeof errorStatus.VERSIONING_MISMATCH>
{
  public static override TITLE = 'Version Mismatch';
  public static override CODE = errorCode.VERSIONING_MISMATCH;
  public static override STATUS = errorStatus.VERSIONING_MISMATCH;
}
/**
 * A document is held by a lock the caller does not hold (ADR-007).
 *
 * Status is 423 Locked rather than 409, so a client distinguishes "someone else
 * is editing this" from the version rung's "the record moved under you"
 * ({@link VersionMismatchError}) on status alone. The API layer carries the
 * current public `Lock` in the JSON:API error's `meta.lock`.
 */
export class LockConflictError extends LaikaError<typeof errorCode.LOCK_CONFLICT, typeof errorStatus.LOCK_CONFLICT> {
  public static override TITLE = 'Lock Conflict';
  public static override CODE = errorCode.LOCK_CONFLICT;
  public static override STATUS = errorStatus.LOCK_CONFLICT;
}
export class ValidationError
  extends LaikaError<typeof errorCode.VALIDATION_ERROR, typeof errorStatus.VALIDATION_ERROR>
{
  public static override TITLE = 'Validation Error';
  public static override CODE = errorCode.VALIDATION_ERROR;
  public static override STATUS = errorStatus.VALIDATION_ERROR;
}
export class EntryAlreadyExistsError
  extends LaikaError<typeof errorCode.ENTRY_ALREADY_EXISTS, typeof errorStatus.ENTRY_ALREADY_EXISTS>
{
  public static override TITLE = 'Entry Already Exists';
  public static override CODE = errorCode.ENTRY_ALREADY_EXISTS;
  public static override STATUS = errorStatus.ENTRY_ALREADY_EXISTS;
}
/**
 * A 401 challenge received from a *remote* server, decoded back into a typed
 * error — HTTP 401. Raised by the JSON:API proxy layer when an upstream rejects
 * our credential, not by this server's own auth gate.
 *
 * The name is a long-standing misnomer: this is **not** the "authenticated but
 * not permitted" error. For that use {@link ForbiddenError} (403); for a
 * credential this server itself rejected use {@link AuthenticationError} (401).
 */
export class AuthorizationError
  extends LaikaError<typeof errorCode.AUTHORIZATION_ERROR, typeof errorStatus.AUTHORIZATION_ERROR>
{
  public static override TITLE = 'Authorization Error';
  public static override CODE = errorCode.AUTHORIZATION_ERROR;
  public static override STATUS = errorStatus.AUTHORIZATION_ERROR;
}
export class AuthenticationError
  extends LaikaError<typeof errorCode.AUTHENTICATION_ERROR, typeof errorStatus.AUTHENTICATION_ERROR>
{
  public static override TITLE = 'Authentication Error';
  public static override CODE = errorCode.AUTHENTICATION_ERROR;
  public static override STATUS = errorStatus.AUTHENTICATION_ERROR;
}
export class ConflictError extends LaikaError<typeof errorCode.CONFLICT, typeof errorStatus.CONFLICT> {
  public static override TITLE = 'Conflict';
  public static override CODE = errorCode.CONFLICT;
  public static override STATUS = errorStatus.CONFLICT;
}
export class TooManyRequestsError
  extends LaikaError<typeof errorCode.TOO_MANY_REQUESTS, typeof errorStatus.TOO_MANY_REQUESTS>
{
  public static override TITLE = 'Too Many Requests';
  public static override CODE = errorCode.TOO_MANY_REQUESTS;
  public static override STATUS = errorStatus.TOO_MANY_REQUESTS;
}
export class ServiceUnavailableError
  extends LaikaError<typeof errorCode.SERVICE_UNAVAILABLE, typeof errorStatus.SERVICE_UNAVAILABLE>
{
  public static override TITLE = 'Service Unavailable';
  public static override CODE = errorCode.SERVICE_UNAVAILABLE;
  public static override STATUS = errorStatus.SERVICE_UNAVAILABLE;
}
export class GatewayTimeoutError
  extends LaikaError<typeof errorCode.GATEWAY_TIMEOUT, typeof errorStatus.GATEWAY_TIMEOUT>
{
  public static override TITLE = 'Gateway Timeout';
  public static override CODE = errorCode.GATEWAY_TIMEOUT;
  public static override STATUS = errorStatus.GATEWAY_TIMEOUT;
}
export class UnknownError extends LaikaError<typeof errorCode.UNKNOWN_ERROR, typeof errorStatus.UNKNOWN_ERROR> {
  public static override TITLE = 'Unknown Error';
  public static override CODE = errorCode.UNKNOWN_ERROR;
  public static override STATUS = errorStatus.UNKNOWN_ERROR;
}
export class AuthorizerFailureError
  extends LaikaError<typeof errorCode.AUTHORIZER_FAILURE, typeof errorStatus.INTERNAL_ERROR>
{
  public static override TITLE = 'Authorizer Failure';
  public static override CODE = errorCode.AUTHORIZER_FAILURE;
  public static override STATUS = errorStatus.INTERNAL_ERROR;
}

// File Sanitizer Errors
export class UnsupportedFileTypeError
  extends LaikaError<typeof errorCode.UNSUPPORTED_FILE_TYPE, typeof errorStatus.UNSUPPORTED_FILE_TYPE>
{
  public static override TITLE = 'Unsupported File Type';
  public static override CODE = errorCode.UNSUPPORTED_FILE_TYPE;
  public static override STATUS = errorStatus.UNSUPPORTED_FILE_TYPE;
}
export class DangerousFileTypeError
  extends LaikaError<typeof errorCode.DANGEROUS_FILE_TYPE, typeof errorStatus.DANGEROUS_FILE_TYPE>
{
  public static override TITLE = 'Dangerous File Type';
  public static override CODE = errorCode.DANGEROUS_FILE_TYPE;
  public static override STATUS = errorStatus.DANGEROUS_FILE_TYPE;
}
export class CorruptedFileError extends LaikaError<typeof errorCode.CORRUPTED_FILE, typeof errorStatus.CORRUPTED_FILE> {
  public static override TITLE = 'Corrupted File';
  public static override CODE = errorCode.CORRUPTED_FILE;
  public static override STATUS = errorStatus.CORRUPTED_FILE;
}
export class EmbeddedContentError
  extends LaikaError<typeof errorCode.EMBEDDED_CONTENT, typeof errorStatus.EMBEDDED_CONTENT>
{
  public static override TITLE = 'Embedded Content';
  public static override CODE = errorCode.EMBEDDED_CONTENT;
  public static override STATUS = errorStatus.EMBEDDED_CONTENT;
}
export class FileTooLargeError extends LaikaError<typeof errorCode.FILE_TOO_LARGE, typeof errorStatus.FILE_TOO_LARGE> {
  public static override TITLE = 'File Too Large';
  public static override CODE = errorCode.FILE_TOO_LARGE;
  public static override STATUS = errorStatus.FILE_TOO_LARGE;
}

/**
 * The backing storage medium is full (or over its allotted quota) and refused a write.
 * Storage repositories backed by a capacity-limited medium (e.g. the Web Storage API's
 * `localStorage`/`sessionStorage`, which typically caps out around 5-10MiB per origin)
 * must map the platform's native "storage full" failure (a `QuotaExceededError`
 * `DOMException`, or equivalent) to this typed error rather than letting the raw
 * exception cross the `LaikaTask`/`LaikaStream` boundary.
 */
export class QuotaExceededError extends LaikaError<typeof errorCode.QUOTA_EXCEEDED, typeof errorStatus.QUOTA_EXCEEDED> {
  public static override TITLE = 'Storage Quota Exceeded';
  public static override CODE = errorCode.QUOTA_EXCEEDED;
  public static override STATUS = errorStatus.QUOTA_EXCEEDED;
}

/**
 * Access to the backing storage medium was refused, or revoked mid-session.
 * Storage repositories backed by a permission-gated medium (e.g. a persisted
 * `showDirectoryPicker()` handle restored in a later session) must map the
 * platform's native permission failure (a `NotAllowedError`/`SecurityError`
 * `DOMException`, a `queryPermission()` state of `'denied'`, or equivalent) to
 * this typed error rather than letting the raw exception cross the
 * `LaikaTask`/`LaikaStream` boundary. Re-requesting will not succeed; the user
 * must grant access anew.
 *
 * Repositories never prompt for access themselves — permission requests need
 * a user gesture, so the application catches, re-acquires access, and
 * retries. See also the sibling errors {@link PermissionPromptRequiredError}
 * (recoverable by re-prompting) and {@link StaleHandleError} (the handle
 * itself is dead).
 */
export class PermissionDeniedError
  extends LaikaError<typeof errorCode.PERMISSION_DENIED, typeof errorStatus.PERMISSION_DENIED>
{
  public static override TITLE = 'Permission Denied';
  public static override CODE = errorCode.PERMISSION_DENIED;
  public static override STATUS = errorStatus.PERMISSION_DENIED;
}

/**
 * Access must be (re-)requested before the storage medium can be used — e.g.
 * a persisted `FileSystemDirectoryHandle` whose permission lapsed back to
 * `'prompt'`. Unlike {@link PermissionDeniedError} this is recoverable
 * without re-selection: call the platform's permission request (such as
 * `handle.requestPermission()`) inside a user gesture, then retry.
 */
export class PermissionPromptRequiredError
  extends LaikaError<typeof errorCode.PERMISSION_PROMPT_REQUIRED, typeof errorStatus.PERMISSION_PROMPT_REQUIRED>
{
  public static override TITLE = 'Permission Prompt Required';
  public static override CODE = errorCode.PERMISSION_PROMPT_REQUIRED;
  public static override STATUS = errorStatus.PERMISSION_PROMPT_REQUIRED;
}

/**
 * A stored handle no longer connects to its underlying resource — the
 * directory was deleted or moved, or a persisted handle expired. Neither
 * retrying nor re-prompting will succeed; ask the user to select the resource
 * again and replace the stored handle.
 */
export class StaleHandleError extends LaikaError<typeof errorCode.STALE_HANDLE, typeof errorStatus.STALE_HANDLE> {
  public static override TITLE = 'Stale Handle';
  public static override CODE = errorCode.STALE_HANDLE;
  public static override STATUS = errorStatus.STALE_HANDLE;
}
