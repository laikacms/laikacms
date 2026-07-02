import * as Result from 'effect/Result';
import {
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  GatewayTimeoutError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnknownError,
  ValidationError,
} from 'laikacms/core';
import { describe, expect, it, vi } from 'vitest';
import {
  errorFromResponse,
  errorToJsonApiMapper,
  isLaikaError,
  laikaErrorFromJsonApiError,
  recoverableErrorsToWarnings,
  schemaIssueFormatter,
  toUserErrorMessage,
  warningsFromMeta,
} from './utilities.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeResponse(status: number, body?: unknown, contentType = 'application/json'): Response {
  const init: ResponseInit = { status, headers: { 'Content-Type': contentType } };
  return new Response(body !== undefined ? JSON.stringify(body) : null, init);
}

function makeJsonApiErrorResponse(status: number, code: string, detail: string, title = 'Error'): Response {
  return makeResponse(status, { errors: [{ status: String(status), code, detail, title }] });
}

// ---------------------------------------------------------------------------
// errorFromResponse
// ---------------------------------------------------------------------------

describe('errorFromResponse', () => {
  it('throws IllegalStateException when the response is ok', async () => {
    const res = new Response('{}', { status: 200 });
    await expect(errorFromResponse(res)).rejects.toThrow();
  });

  it('400 without JSON body returns BadRequestError (LCMS-167 regression)', async () => {
    // Before LCMS-167 was fixed this returned NotFoundError — assert the correct class.
    const res = makeResponse(400, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('401 without JSON body returns AuthorizationError', async () => {
    const res = makeResponse(401, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(AuthorizationError);
  });

  it('403 without JSON body returns ForbiddenError', async () => {
    const res = makeResponse(403, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('404 without JSON body returns NotFoundError', async () => {
    const res = makeResponse(404, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('409 without JSON body returns ConflictError', async () => {
    const res = makeResponse(409, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('429 without JSON body returns TooManyRequestsError', async () => {
    const res = makeResponse(429, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(TooManyRequestsError);
  });

  it('500 without JSON body returns InternalError', async () => {
    const res = makeResponse(500, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(InternalError);
  });

  it('503 without JSON body returns ServiceUnavailableError', async () => {
    const res = makeResponse(503, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
  });

  it('504 without JSON body returns GatewayTimeoutError', async () => {
    const res = makeResponse(504, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(GatewayTimeoutError);
  });

  it('unknown status without JSON body returns UnknownError', async () => {
    const res = makeResponse(418, undefined, 'text/plain');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(UnknownError);
  });

  it('uses detail from plain-text-ish JSON body when JSON:API shape is absent', async () => {
    const res = makeResponse(404, { message: 'thing not found' });
    const err = await errorFromResponse(res);
    expect(err.message).toBe('thing not found');
  });

  it('resolves to the typed error class when JSON:API error body is valid', async () => {
    const res = makeJsonApiErrorResponse(404, NotFoundError.CODE, 'item missing');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe('item missing');
  });

  it('falls back to UnknownError for an unrecognised code in a valid JSON:API body', async () => {
    const res = makeJsonApiErrorResponse(400, 'this_code_does_not_exist', 'weird error', 'Strange Error');
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(UnknownError);
    expect(err.message).toBe('weird error');
  });
});

// ---------------------------------------------------------------------------
// errorToJsonApiMapper
// ---------------------------------------------------------------------------

describe('errorToJsonApiMapper', () => {
  it('maps NotFoundError to status 404 with correct code', () => {
    const result = errorToJsonApiMapper(new NotFoundError('not here'));
    expect(result.status).toBe(404);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe(NotFoundError.CODE);
    expect(result.errors[0]!.status).toBe('404');
    expect(result.errors[0]!.detail).toBe('not here');
  });

  it('maps BadRequestError to status 400 with correct code', () => {
    const result = errorToJsonApiMapper(new BadRequestError('bad input'));
    expect(result.status).toBe(400);
    expect(result.errors[0]!.code).toBe(BadRequestError.CODE);
    expect(result.errors[0]!.status).toBe('400');
  });

  it('maps ForbiddenError to status 403', () => {
    const result = errorToJsonApiMapper(new ForbiddenError());
    expect(result.status).toBe(403);
    expect(result.errors[0]!.code).toBe(ForbiddenError.CODE);
  });

  it('maps AuthenticationError to status 401', () => {
    const result = errorToJsonApiMapper(new AuthenticationError());
    expect(result.status).toBe(401);
    expect(result.errors[0]!.code).toBe(AuthenticationError.CODE);
  });

  it('maps AuthorizationError to status 401', () => {
    const result = errorToJsonApiMapper(new AuthorizationError());
    expect(result.status).toBe(401);
    expect(result.errors[0]!.code).toBe(AuthorizationError.CODE);
  });

  it('maps ConflictError to status 409', () => {
    const result = errorToJsonApiMapper(new ConflictError());
    expect(result.status).toBe(409);
    expect(result.errors[0]!.code).toBe(ConflictError.CODE);
  });

  it('maps TooManyRequestsError to status 429', () => {
    const result = errorToJsonApiMapper(new TooManyRequestsError());
    expect(result.status).toBe(429);
    expect(result.errors[0]!.code).toBe(TooManyRequestsError.CODE);
  });

  it('maps InternalError to status 500', () => {
    const result = errorToJsonApiMapper(new InternalError());
    expect(result.status).toBe(500);
    expect(result.errors[0]!.code).toBe(InternalError.CODE);
  });

  it('maps a plain string to InternalError (hides unknown message)', () => {
    const result = errorToJsonApiMapper('some internal string');
    expect(result.status).toBe(InternalError.STATUS);
    expect(result.errors[0]!.code).toBe(InternalError.CODE);
  });

  it('maps an AWS NetworkingError to ServiceUnavailableError', () => {
    const awsErr = { name: 'NetworkingError', message: 'ECONNREFUSED' };
    const result = errorToJsonApiMapper(awsErr);
    expect(result.status).toBe(ServiceUnavailableError.STATUS);
    expect(result.errors[0]!.code).toBe(ServiceUnavailableError.CODE);
  });

  it('maps a ParseError (Effect schema) to 400 validation_error per issue', () => {
    const parseError = {
      _tag: 'ParseError',
      issues: [
        { path: ['name'], message: 'Expected string' },
        { path: ['age'], message: 'Expected number' },
      ],
    };
    const result = errorToJsonApiMapper(parseError);
    expect(result.status).toBe(ValidationError.STATUS);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.code).toBe('validation_error');
    expect(result.errors[0]!.source).toEqual({ pointer: '/name' });
    expect(result.errors[1]!.source).toEqual({ pointer: '/age' });
  });

  it('maps a ParseError with empty path (root issue) without a source pointer', () => {
    const parseError = {
      _tag: 'ParseError',
      issues: [{ path: [], message: 'Missing body' }],
    };
    const result = errorToJsonApiMapper(parseError);
    expect(result.errors[0]!.source).toBeUndefined();
  });

  // LCMS-262: errorToJsonApiMapper() unconditionally called console.error on
  // every mapped error — including routine 4xx — leaking internal stack
  // traces/paths and ignoring the caller-supplied logger.
  describe('LCMS-262: logging behaviour', () => {
    it('does not call console.error for a routine 404, with no logger passed', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      errorToJsonApiMapper(new NotFoundError('notes/nope'));
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not call console.error for a routine 400, with no logger passed', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      errorToJsonApiMapper(new BadRequestError('bad input'));
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('never calls console.error directly, even for a 5xx', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      errorToJsonApiMapper(new InternalError('boom'));
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not invoke logger.error for a routine 404', () => {
      const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
      errorToJsonApiMapper(new NotFoundError('notes/nope'), logger);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('invokes logger.error for a genuinely unexpected 5xx error', () => {
      const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
      const err = new InternalError('disk on fire');
      errorToJsonApiMapper(err, logger);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('errorToJsonApiMapper():', err);
    });

    it('a silent logger suppresses output entirely for a 5xx error', () => {
      const silentLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
      expect(() => errorToJsonApiMapper(new InternalError('boom'), silentLogger)).not.toThrow();
      expect(silentLogger.error).toHaveBeenCalledTimes(1);
    });

    it('logs a Result-wrapped 5xx failure exactly once, not once per wrapper layer', () => {
      const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
      const failure = Result.fail(new InternalError('wrapped boom'));
      errorToJsonApiMapper(failure, logger);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('does not log a Result-wrapped 404 failure', () => {
      const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
      const failure = Result.fail(new NotFoundError('notes/nope'));
      errorToJsonApiMapper(failure, logger);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// recoverableErrorsToWarnings
// ---------------------------------------------------------------------------

describe('recoverableErrorsToWarnings', () => {
  it('returns undefined for an empty array', () => {
    expect(recoverableErrorsToWarnings([])).toBeUndefined();
  });

  it('maps each error to a JSON:API error object', () => {
    const warnings = recoverableErrorsToWarnings([new NotFoundError('warn'), new InternalError('x')]);
    expect(warnings).toHaveLength(2);
    expect(warnings![0]!.code).toBe(NotFoundError.CODE);
    expect(warnings![1]!.code).toBe(InternalError.CODE);
  });
});

// ---------------------------------------------------------------------------
// laikaErrorFromJsonApiError
// ---------------------------------------------------------------------------

describe('laikaErrorFromJsonApiError', () => {
  it('reconstructs a NotFoundError from a JSON:API error object', () => {
    const err = laikaErrorFromJsonApiError({ code: NotFoundError.CODE, detail: 'gone', status: '404' });
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe('gone');
  });

  it('falls back to UnknownError for unrecognised code', () => {
    const err = laikaErrorFromJsonApiError({ code: 'completely_unknown' as never, detail: 'hmm', status: '500' });
    expect(err).toBeInstanceOf(UnknownError);
  });
});

// ---------------------------------------------------------------------------
// warningsFromMeta
// ---------------------------------------------------------------------------

describe('warningsFromMeta', () => {
  it('returns [] for null meta', () => {
    expect(warningsFromMeta(null)).toEqual([]);
  });

  it('returns [] for meta without warnings field', () => {
    expect(warningsFromMeta({ other: true })).toEqual([]);
  });

  it('returns [] when warnings is not an array', () => {
    expect(warningsFromMeta({ warnings: 'bad' })).toEqual([]);
  });

  it('converts valid warning entries into LaikaErrors', () => {
    const meta = {
      warnings: [
        { code: NotFoundError.CODE, detail: 'soft miss', status: '404' },
      ],
    };
    const result = warningsFromMeta(meta);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(NotFoundError);
  });

  it('silently skips malformed entries', () => {
    const meta = { warnings: [null, 42, { notCode: true }, { code: NotFoundError.CODE, detail: 'ok', status: '404' }] };
    const result = warningsFromMeta(meta);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// schemaIssueFormatter
// ---------------------------------------------------------------------------

describe('schemaIssueFormatter', () => {
  it('produces a validation_error with pointer when path is non-empty', () => {
    const out = schemaIssueFormatter({ path: ['data', 'attributes', 'title'], message: 'Required' });
    expect(out.status).toBe('400');
    expect(out.code).toBe('validation_error');
    expect(out.title).toBe('Validation Error');
    expect(out.detail).toBe('Required');
    expect(out.source).toEqual({ pointer: '/data/attributes/title' });
  });

  it('omits source when path is empty', () => {
    const out = schemaIssueFormatter({ path: [], message: 'Root issue' });
    expect(out.source).toBeUndefined();
  });

  it('handles numeric path segments', () => {
    const out = schemaIssueFormatter({ path: ['items', 0, 'name'], message: 'String expected' });
    expect(out.source).toEqual({ pointer: '/items/0/name' });
  });
});

// ---------------------------------------------------------------------------
// isLaikaError
// ---------------------------------------------------------------------------

describe('isLaikaError', () => {
  it('returns true for a LaikaError subclass', () => {
    expect(isLaikaError(new NotFoundError())).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isLaikaError(new Error('nope'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isLaikaError(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toUserErrorMessage
// ---------------------------------------------------------------------------

describe('toUserErrorMessage', () => {
  it('returns the error message from a LaikaError', () => {
    expect(toUserErrorMessage(new NotFoundError('missing'))).toBe('missing');
  });

  it('returns the message from a plain Error', () => {
    expect(toUserErrorMessage(new Error('plain error'))).toBe('plain error');
  });

  it('returns the message field from an object', () => {
    expect(toUserErrorMessage({ message: 'from object' })).toBe('from object');
  });

  it('returns the detail field when no message field', () => {
    expect(toUserErrorMessage({ detail: 'from detail' })).toBe('from detail');
  });

  it('returns the error field when no message or detail', () => {
    expect(toUserErrorMessage({ error: 'from error' })).toBe('from error');
  });

  it('returns fallback for null/undefined', () => {
    expect(toUserErrorMessage(null)).toBe('An unknown error occurred');
    expect(toUserErrorMessage(undefined)).toBe('An unknown error occurred');
  });
});
