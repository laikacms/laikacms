import { ConflictError, ForbiddenError, InternalError, LaikaError, NotFoundError } from 'laikacms/core';
import { describe, expect, it } from 'vitest';
import { mapFsErrorToLaikaError } from './utilities.js';

function fsError(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe('mapFsErrorToLaikaError', () => {
  it('maps EACCES (single-S) to ForbiddenError', () => {
    const result = mapFsErrorToLaikaError(fsError('EACCES'));
    expect(result).toBeInstanceOf(ForbiddenError);
  });

  it('maps ENOENT to NotFoundError', () => {
    const result = mapFsErrorToLaikaError(fsError('ENOENT'));
    expect(result).toBeInstanceOf(NotFoundError);
  });

  it('maps EEXIST to ConflictError', () => {
    const result = mapFsErrorToLaikaError(fsError('EEXIST'));
    expect(result).toBeInstanceOf(ConflictError);
  });

  it('maps EPERM to ForbiddenError', () => {
    const result = mapFsErrorToLaikaError(fsError('EPERM'));
    expect(result).toBeInstanceOf(ForbiddenError);
  });

  it('maps unknown codes to InternalError', () => {
    const result = mapFsErrorToLaikaError(fsError('EUNKNOWN_CUSTOM'));
    expect(result).toBeInstanceOf(InternalError);
  });

  it('passes through an existing LaikaError unchanged', () => {
    const original = new NotFoundError('already a laika error');
    const result = mapFsErrorToLaikaError(original);
    expect(result).toBe(original);
  });

  it('maps a plain Error with no code to InternalError', () => {
    const result = mapFsErrorToLaikaError(new Error('oops'));
    expect(result).toBeInstanceOf(InternalError);
  });

  it('maps a non-Error value to InternalError', () => {
    const result = mapFsErrorToLaikaError('something went wrong');
    expect(result).toBeInstanceOf(InternalError);
  });
});
