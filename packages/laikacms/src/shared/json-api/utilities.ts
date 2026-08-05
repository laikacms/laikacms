import * as Exit from 'effect/Exit';
import * as Result from 'effect/Result';
import * as errors from 'laikacms/core';
import { InternalError, LaikaError, ServiceUnavailableError, ValidationError } from 'laikacms/core';
import { decodeJsonApiErrorExit } from './schemas.js';
import type { JsonApiError } from './types.js';

// Type for Effect Schema parse errors
interface SchemaParseError {
  readonly _tag: 'ParseError';
  readonly issues: ReadonlyArray<{
    readonly path: ReadonlyArray<string | number>,
    readonly message: string,
  }>;
}

/** Subset of `Console` accepted anywhere a diagnostic logger is threaded through the JSON:API layer. */
export type JsonApiLogger = Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;

const knownErrorCodes: ReadonlySet<string> = new Set(Object.values(errors.errorCode));

/**
 * Structural check for a {@link LaikaError}, robust to the module resolving
 * `laikacms/core` more than once in the same process (a classic monorepo /
 * vitest "dual package hazard" — one import resolving through `dist/**`,
 * another through source, each instantiating its own copy of the
 * `LaikaError` class). `instanceof LaikaError` only holds when `err` was
 * constructed against the *same* copy of the class that's imported here, so
 * it silently fails across the module-instance boundary even though the
 * error is structurally identical (LCMS-456).
 *
 * Falls back to duck-typing on the stable `code`/`status` pair every
 * `LaikaError` subclass carries — `code` is checked against the known
 * `errorCode` value set so an arbitrary object with a `code` string can't
 * spoof this.
 */
const isLaikaErrorLike = (err: unknown): err is LaikaError<errors.ErrorCode, number> => {
  if (err instanceof LaikaError) return true;
  if (!(err instanceof Error)) return false;
  const { code, status } = err as { code?: unknown, status?: unknown };
  return typeof code === 'string' && knownErrorCodes.has(code) && typeof status === 'number';
};

export const errorToJsonApiMapper = (
  err: unknown,
  logger?: JsonApiLogger,
): JsonApiError & { status: errors.ErrorStatus } => {
  // Unwrap IErrorResult objects (from Result<T> failure cases) first, so the
  // logging decision below is made once against the underlying error rather
  // than once per Result wrapper.
  if (Result.isResult(err) && Result.isFailure(err)) {
    return errorToJsonApiMapper(err.failure, logger);
  }

  const mapped = mapErrorToJsonApi(err);

  // Only surface genuinely unexpected (5xx-class) errors. Routine 4xx
  // responses (404 not-found, 400 validation, ...) are normal control flow —
  // not something an operator needs to see in the logs, and their messages
  // can carry internal filesystem paths / stack traces. Diagnostics route
  // through the caller-supplied `logger`; without one, nothing is logged.
  if (mapped.status >= 500) {
    logger?.error('errorToJsonApiMapper():', err);
  }

  return mapped;
};

const mapErrorToJsonApi = (err: unknown): JsonApiError & { status: errors.ErrorStatus } => {
  const errorObj = typeof err === 'string'
    ? new errors
      .UnknownError() /* explicitly do not show a message since we dont know if the message is internal or not */
    : err;

  // Handle Effect Schema parse errors
  if (typeof err === 'object' && err !== null && '_tag' in err && (err as SchemaParseError)._tag === 'ParseError') {
    const parseError = err as SchemaParseError;
    return {
      errors: parseError.issues.map(issue => ({
        status: '400',
        title: 'Validation Error',
        code: 'validation_error',
        detail: issue.message,
        source: issue.path.length > 0 ? { pointer: '/' + issue.path.join('/') } : undefined,
      })),
      status: ValidationError.STATUS,
    };
  }

  if (isLaikaErrorLike(err)) {
    return {
      errors: [
        {
          title: err.title,
          code: err.code,
          status: '' + err.status,
          detail: err.message,
        },
      ],
      status: err.status as errors.ErrorStatus,
    };
  }

  // Handle AWS SDK errors
  if (
    typeof errorObj === 'object' && errorObj !== null
    && ('name' in errorObj && errorObj.name === 'NetworkingError'
      || 'name' in errorObj && errorObj.name === 'TimeoutError')
  ) {
    return {
      errors: [
        {
          status: '' + ServiceUnavailableError.STATUS,
          code: ServiceUnavailableError.CODE,
          title: ServiceUnavailableError.TITLE,
          detail: `Cannot connect to a required service.`,
        },
      ],
      status: ServiceUnavailableError.STATUS,
    };
  }

  // Return JSON error response
  return {
    errors: [
      {
        status: '' + InternalError.STATUS,
        code: InternalError.CODE,
        title: InternalError.TITLE,
        detail: 'Internal Server Error',
      },
    ],
    status: InternalError.STATUS,
  };
};

/**
 * Map a list of recoverable {@link LaikaError}s to JSON:API error objects
 * suitable for `meta.warnings`. Returns `undefined` for an empty input so the
 * caller can omit the field entirely instead of writing `warnings: []`.
 */
export const recoverableErrorsToWarnings = (
  errs: ReadonlyArray<unknown>,
): JsonApiError['errors'] | undefined => {
  if (errs.length === 0) return undefined;
  return errs.map(e => errorToJsonApiMapper(e).errors[0]!);
};

type LaikaErrorCtor = { new(message?: string): LaikaError, CODE?: unknown };

/**
 * Look up the LaikaError subclass whose static `CODE` matches `code`. Falls
 * back to `UnknownError` for codes the local errors module doesn't know
 * (e.g. a newer upstream emitting an unfamiliar error). Used to round-trip
 * upstream JSON:API error objects back into typed LaikaErrors on the proxy.
 */
const laikaErrorClassForCode = (code: string): LaikaErrorCtor => {
  // The errors module re-exports value constants alongside the classes;
  // filter to constructors with a static CODE that matches.
  const ErrorMap = { ...errors, LaikaError: undefined } as Record<string, unknown>;
  const candidate = Object.values(ErrorMap).find(
    (cls): cls is LaikaErrorCtor =>
      typeof cls === 'function' && 'CODE' in (cls as object) && (cls as LaikaErrorCtor).CODE === code,
  );
  if (!candidate || (candidate as unknown) === LaikaError) return errors.UnknownError;
  return candidate;
};

/**
 * Convert one JSON:API error object back into a typed LaikaError, looking
 * the class up by its `code` field.
 */
export const laikaErrorFromJsonApiError = (
  err: JsonApiError['errors'][number],
): LaikaError => {
  const Cls = laikaErrorClassForCode(err.code);
  return new Cls(err.detail);
};

/**
 * Extract upstream JSON:API `meta.warnings` from a parsed response body and
 * convert each into a typed LaikaError. Used by JSON:API proxy backends to
 * re-emit upstream warnings as local `recoverableError`s so warnings flow
 * end-to-end through a proxy chain instead of dying at every hop.
 *
 * Tolerant: unrecognized shapes return `[]` rather than throw — a proxy
 * should never make its caller's stream blow up just because the upstream
 * meta was malformed.
 */
export const warningsFromMeta = (meta: unknown): ReadonlyArray<LaikaError> => {
  if (!meta || typeof meta !== 'object') return [];
  const warnings = (meta as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings
    .filter((w): w is JsonApiError['errors'][number] =>
      !!w && typeof w === 'object' && typeof (w as { code?: unknown }).code === 'string'
    )
    .map(laikaErrorFromJsonApiError);
};

/**
 * Convert a schema parse error issue to a JSON:API error response
 *
 * @param issue - The parse error issue to convert
 * @returns JSON:API error object
 */
export function schemaIssueFormatter(
  issue: { path: ReadonlyArray<string | number>, message: string },
): JsonApiError['errors'][number] {
  const pointer = issue.path.length > 0
    ? '/' + issue.path.map((p: string | number) => String(p)).join('/')
    : undefined;

  return {
    status: '400',
    title: 'Validation Error',
    code: 'validation_error',
    detail: issue.message,
    source: pointer ? { pointer } : undefined,
  };
}

export const errorFromResponse = async (response: Response) => {
  let isJson = response.headers.get('Content-Type')?.includes('application/json');
  let error: JsonApiError['errors'][number] | undefined;
  let detail: string | undefined;

  if (response.ok) {
    throw new errors.IllegalStateException('errorFromResponse called with ok response');
  }

  if (isJson) {
    try {
      const json = await response.json();
      const parseResult = decodeJsonApiErrorExit(json);
      if (Exit.isSuccess(parseResult)) {
        error = parseResult.value.errors[0];
      } else {
        isJson = false;
        if (typeof json.error === 'string') detail = json.error;
        if (typeof json.message === 'string') detail = json.message;
        if (typeof json.detail === 'string') detail = json.detail;
      }
    } catch {
      isJson = false;
    }
  }

  if (!isJson || !error) {
    switch (response.status) {
      case 400:
        return new errors.BadRequestError(detail);
      case 401:
        return new errors.AuthorizationError(detail);
      case 403:
        return new errors.ForbiddenError(detail);
      case 404:
        return new errors.NotFoundError(detail);
      case 409:
        return new errors.ConflictError(detail);
      case 429:
        return new errors.TooManyRequestsError(detail);
      case 500:
        return new errors.InternalError(detail);
      case 503:
        return new errors.ServiceUnavailableError(detail);
      case 504:
        return new errors.GatewayTimeoutError(detail);
      default:
        return new errors.UnknownError(detail ?? response.statusText);
    }
  }

  const ErrorMap = {
    ...errors,
    LaikaError: undefined,
  };

  const allFuncs = Object.values(ErrorMap).filter(cls => typeof cls === 'function');
  const ErrorClassesWIthCode = allFuncs.filter(cls => 'CODE' in cls);
  const CorrectError = ErrorClassesWIthCode.find(cls => cls.CODE === error.code);

  if (!CorrectError) {
    return new errors.UnknownError(error.detail);
  }

  if (CorrectError === LaikaError) {
    return new errors.UnknownError(error.detail);
  }

  return new CorrectError(error.detail);
};

export const isLaikaError = (error: unknown): error is LaikaError<errors.ErrorCode, number> => {
  return isLaikaErrorLike(error);
};

export const toUserErrorMessage = (error: unknown): string => {
  if (isLaikaError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  // fallback
  if (error !== null && typeof error === 'object') {
    if ('message' in error) return '' + error.message;
    if ('detail' in error) return '' + error.detail;
    if ('error' in error) return '' + error.error;
  }

  return 'An unknown error occurred';
};
