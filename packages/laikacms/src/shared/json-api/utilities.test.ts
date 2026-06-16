import * as errors from 'laikacms/core';
import { describe, expect, it } from 'vitest';

import { errorFromResponse } from './utilities.js';

const makeResponse = (status: number, body = 'error') => new Response(body, { status });

describe('errorFromResponse', () => {
  it('maps HTTP 400 to BadRequestError', async () => {
    const err = await errorFromResponse(makeResponse(400));
    expect(err).toBeInstanceOf(errors.BadRequestError);
  });

  it('maps HTTP 401 to AuthorizationError', async () => {
    const err = await errorFromResponse(makeResponse(401));
    expect(err).toBeInstanceOf(errors.AuthorizationError);
  });

  it('maps HTTP 403 to ForbiddenError', async () => {
    const err = await errorFromResponse(makeResponse(403));
    expect(err).toBeInstanceOf(errors.ForbiddenError);
  });

  it('maps HTTP 404 to NotFoundError', async () => {
    const err = await errorFromResponse(makeResponse(404));
    expect(err).toBeInstanceOf(errors.NotFoundError);
  });
});
