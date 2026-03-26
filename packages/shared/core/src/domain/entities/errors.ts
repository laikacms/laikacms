import { ErrorResult, ResultError } from "../types/result.js";
import type { TranslationKey } from '@laikacms/i18n'

type ErrorSource = { pointer: string } | { parameter: string };

// Pass the actual error into the cause field.
export abstract class LaikaError<C extends ErrorCode, S extends number> extends Error {
    public static TITLE: string; // PUBLIC
    public static STATUS: number; // PUBLIC
    public static CODE: ErrorCode; // PUBLIC
    public jsonApiSource?: ErrorSource | undefined; // PUBLIC
    public translation?: { title?: TranslationKey, message?: TranslationKey }; // PUBLIC
    public status: S // PUBLIC
    public code: C; // PUBLIC
    public title: string; // PUBLIC

    constructor(message? /* PUBLIC */: string, options?: { translation?: { title?: TranslationKey | undefined, message?: TranslationKey | undefined } | undefined, jsonApiSource?: ErrorSource | undefined, cause?: Error | undefined /* PRIVATE */ }) {
        super(message, options);
        this.status = new.target.STATUS as S; // PUBLIC
        this.jsonApiSource = options?.jsonApiSource; // PUBLIC
        this.translation = options?.translation; // PUBLIC
        this.code = new.target.CODE as C; // PUBLIC
        this.title = new.target.TITLE // PUBLIC
        Object.setPrototypeOf(this, LaikaError.prototype);
    }

    /**
     * @deprecated Use `toResult`
     */
    public toResultError() {
        return ErrorResult.fromError(this);
    }

    public toResult() {
        return ErrorResult.fromError(this);
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
    DANGEROUS_FILE_TYPE: 415,   // Unsupported Media Type
    CORRUPTED_FILE: 422,        // Unprocessable Entity
    EMBEDDED_CONTENT: 422,      // Unprocessable Entity
    FILE_TOO_LARGE: 413,        // Payload Too Large
} as const satisfies Record<ErrorKey, number>

export type ErrorStatus = typeof errorStatus[keyof typeof errorStatus];

export class NotImplementedError extends LaikaError<typeof errorCode.NOT_IMPLEMENTED, typeof errorStatus.NOT_IMPLEMENTED> {
    public static override TITLE = "Not Implemented";
    public static override CODE = errorCode.NOT_IMPLEMENTED;
    public static override STATUS = errorStatus.NOT_IMPLEMENTED;
}
export class IllegalStateException extends LaikaError<typeof errorCode.ILLEGAL_STATE, typeof errorStatus.ILLEGAL_STATE> {
    public static override TITLE = "Illegal State"
    public static override CODE = errorCode.ILLEGAL_STATE;
    public static override STATUS = errorStatus.ILLEGAL_STATE;
}
export class NotFoundError extends LaikaError<typeof errorCode.NOT_FOUND, typeof errorStatus.NOT_FOUND> {
    public static override TITLE = "Not Found"
    public static override CODE = errorCode.NOT_FOUND;
    public static override STATUS = errorStatus.NOT_FOUND;
}
export class BadRequestError extends LaikaError<typeof errorCode.BAD_REQUEST, typeof errorStatus.BAD_REQUEST> {
    public static override TITLE = "Bad Request"
    public static override CODE = errorCode.BAD_REQUEST;
    public static override STATUS = errorStatus.BAD_REQUEST;
}
export class ForbiddenError extends LaikaError<typeof errorCode.FORBIDDEN, typeof errorStatus.FORBIDDEN> {
    /*
    use UnauthorizedError if user is not logged in at all
    use ForbiddenError if user is logged in but lacks permissions
    */
    public static override TITLE = "Forbidden"
    public static override CODE = errorCode.FORBIDDEN;
    public static override STATUS = errorStatus.FORBIDDEN;
}
export class DirInsteadOfFile extends LaikaError<typeof errorCode.DIR_INSTEAD_OF_FILE, typeof errorStatus.DIR_INSTEAD_OF_FILE> {
    public static override TITLE = "Directory Instead of File"
    public static override CODE = errorCode.DIR_INSTEAD_OF_FILE;
    public static override STATUS = errorStatus.DIR_INSTEAD_OF_FILE;
}
export class FileInsteadOfDir extends LaikaError<typeof errorCode.FILE_INSTEAD_OF_DIR, typeof errorStatus.FILE_INSTEAD_OF_DIR> {
    public static override TITLE = "File Instead of Directory"
    public static override CODE = errorCode.FILE_INSTEAD_OF_DIR;
    public static override STATUS = errorStatus.FILE_INSTEAD_OF_DIR;
}
export class InvalidData extends LaikaError<typeof errorCode.INVALID_DATA, typeof errorStatus.INVALID_DATA> {
    public static override TITLE = "Invalid Data"
    public static override CODE = errorCode.INVALID_DATA;
    public static override STATUS = errorStatus.INVALID_DATA;
}
export class InternalError extends LaikaError<typeof errorCode.INTERNAL_ERROR, typeof errorStatus.INTERNAL_ERROR> {
    public static override TITLE = "Internal Error"
    public static override CODE = errorCode.INTERNAL_ERROR;
    public static override STATUS = errorStatus.INTERNAL_ERROR;
}
export class VersionMismatchError extends LaikaError<typeof errorCode.VERSIONING_MISMATCH, typeof errorStatus.VERSIONING_MISMATCH> {
    public static override TITLE = "Version Mismatch"
    public static override CODE = errorCode.VERSIONING_MISMATCH;
    public static override STATUS = errorStatus.VERSIONING_MISMATCH;
}
export class ValidationError extends LaikaError<typeof errorCode.VALIDATION_ERROR, typeof errorStatus.VALIDATION_ERROR> {
    public static override TITLE = "Validation Error"
    public static override CODE = errorCode.VALIDATION_ERROR;
    public static override STATUS = errorStatus.VALIDATION_ERROR;
}
export class EntryAlreadyExistsError extends LaikaError<typeof errorCode.ENTRY_ALREADY_EXISTS, typeof errorStatus.ENTRY_ALREADY_EXISTS> {
    public static override TITLE = "Entry Already Exists"
    public static override CODE = errorCode.ENTRY_ALREADY_EXISTS;
    public static override STATUS = errorStatus.ENTRY_ALREADY_EXISTS;
}       
export class AuthorizationError extends LaikaError<typeof errorCode.AUTHORIZATION_ERROR, typeof errorStatus.AUTHORIZATION_ERROR> {
    public static override TITLE = "Authorization Error"
    public static override CODE = errorCode.AUTHORIZATION_ERROR;
    public static override STATUS = errorStatus.AUTHORIZATION_ERROR;
}
export class AuthenticationError extends LaikaError<typeof errorCode.AUTHENTICATION_ERROR, typeof errorStatus.AUTHENTICATION_ERROR> {
    public static override TITLE = "Authentication Error"
    public static override CODE = errorCode.AUTHENTICATION_ERROR;
    public static override STATUS = errorStatus.AUTHENTICATION_ERROR;
}
export class ConflictError extends LaikaError<typeof errorCode.CONFLICT, typeof errorStatus.CONFLICT> {
    public static override TITLE = "Conflict"
    public static override CODE = errorCode.CONFLICT;
    public static override STATUS = errorStatus.CONFLICT;
}       
export class TooManyRequestsError extends LaikaError<typeof errorCode.TOO_MANY_REQUESTS, typeof errorStatus.TOO_MANY_REQUESTS> {
    public static override TITLE = "Too Many Requests"
    public static override CODE = errorCode.TOO_MANY_REQUESTS;
    public static override STATUS = errorStatus.TOO_MANY_REQUESTS;
}       
export class ServiceUnavailableError extends LaikaError<typeof errorCode.SERVICE_UNAVAILABLE, typeof errorStatus.SERVICE_UNAVAILABLE> {
    public static override TITLE = "Service Unavailable"
    public static override CODE = errorCode.SERVICE_UNAVAILABLE;
    public static override STATUS = errorStatus.SERVICE_UNAVAILABLE;
}       
export class GatewayTimeoutError extends LaikaError<typeof errorCode.GATEWAY_TIMEOUT, typeof errorStatus.GATEWAY_TIMEOUT> {
    public static override TITLE = "Gateway Timeout"
    public static override CODE = errorCode.GATEWAY_TIMEOUT;
    public static override STATUS = errorStatus.GATEWAY_TIMEOUT;
}
export class UnknownError extends LaikaError<typeof errorCode.UNKNOWN_ERROR, typeof errorStatus.UNKNOWN_ERROR> {
    public static override TITLE = "Unknown Error"
    public static override CODE = errorCode.UNKNOWN_ERROR;
    public static override STATUS = errorStatus.UNKNOWN_ERROR;
}
export class AuthorizerFailureError extends LaikaError<typeof errorCode.AUTHORIZER_FAILURE, typeof errorStatus.INTERNAL_ERROR> {
    public static override TITLE = "Authorizer Failure"
    public static override CODE = errorCode.AUTHORIZER_FAILURE;
    public static override STATUS = errorStatus.INTERNAL_ERROR;
}

// File Sanitizer Errors
export class UnsupportedFileTypeError extends LaikaError<typeof errorCode.UNSUPPORTED_FILE_TYPE, typeof errorStatus.UNSUPPORTED_FILE_TYPE> {
    public static override TITLE = "Unsupported File Type"
    public static override CODE = errorCode.UNSUPPORTED_FILE_TYPE;
    public static override STATUS = errorStatus.UNSUPPORTED_FILE_TYPE;
}
export class DangerousFileTypeError extends LaikaError<typeof errorCode.DANGEROUS_FILE_TYPE, typeof errorStatus.DANGEROUS_FILE_TYPE> {
    public static override TITLE = "Dangerous File Type"
    public static override CODE = errorCode.DANGEROUS_FILE_TYPE;
    public static override STATUS = errorStatus.DANGEROUS_FILE_TYPE;
}
export class CorruptedFileError extends LaikaError<typeof errorCode.CORRUPTED_FILE, typeof errorStatus.CORRUPTED_FILE> {
    public static override TITLE = "Corrupted File"
    public static override CODE = errorCode.CORRUPTED_FILE;
    public static override STATUS = errorStatus.CORRUPTED_FILE;
}
export class EmbeddedContentError extends LaikaError<typeof errorCode.EMBEDDED_CONTENT, typeof errorStatus.EMBEDDED_CONTENT> {
    public static override TITLE = "Embedded Content"
    public static override CODE = errorCode.EMBEDDED_CONTENT;
    public static override STATUS = errorStatus.EMBEDDED_CONTENT;
}
export class FileTooLargeError extends LaikaError<typeof errorCode.FILE_TOO_LARGE, typeof errorStatus.FILE_TOO_LARGE> {
    public static override TITLE = "File Too Large"
    public static override CODE = errorCode.FILE_TOO_LARGE;
    public static override STATUS = errorStatus.FILE_TOO_LARGE;
}