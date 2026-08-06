import * as Result from 'effect/Result';
import { ValidationError } from 'laikacms/core';
import { describe, expect, it } from 'vitest';
import { parseSettings, parseSettingsJSON } from './settings.js';

describe('parseSettingsJSON', () => {
  it('returns parsed settings for a valid JSON string', () => {
    const result = parseSettingsJSON('{}');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({});
    }
  });

  it('returns a failure for malformed JSON', () => {
    const result = parseSettingsJSON('{not valid json}');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ValidationError);
      expect(result.failure.message).toContain('not valid JSON');
    }
  });

  it('passes a complete valid settings JSON to parseSettings', () => {
    const json = JSON.stringify({
      collections: {
        posts: { type: 'document', key: 'posts' },
      },
    });
    const result = parseSettingsJSON(json);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.collections?.['posts']).toMatchObject({ type: 'document', key: 'posts' });
    }
  });
});

describe('parseSettings', () => {
  it('succeeds with an empty object (all fields optional)', () => {
    const result = parseSettings({});
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({});
    }
  });

  it('succeeds with a complete valid settings object', () => {
    const data = {
      collections: {
        posts: {
          type: 'document',
          key: 'posts',
          name: 'Posts',
          directory: 'posts',
          recursive: false,
          unpublishedStatuses: {
            draft: { directory: 'draft', name: 'Draft' },
          },
        },
        media: {
          type: 'media',
          key: 'media',
          name: 'Media',
          directory: 'uploads',
          accept: ['image/png', 'image/jpeg'],
        },
      },
    };
    const result = parseSettings(data);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.collections?.['posts']).toMatchObject({ type: 'document', key: 'posts' });
      expect(result.success.collections?.['media']).toMatchObject({ type: 'media', key: 'media' });
    }
  });

  it('fails when a collection has an invalid type', () => {
    const data = {
      collections: {
        posts: { type: 'unknown-type', key: 'posts' },
      },
    };
    const result = parseSettings(data);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ValidationError);
      expect(result.failure.message).toContain('Invalid settings data');
    }
  });

  it('fails when a collection is missing the required key field', () => {
    const data = {
      collections: {
        posts: { type: 'document' },
      },
    };
    const result = parseSettings(data);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ValidationError);
    }
  });

  it('fails when null is passed', () => {
    const result = parseSettings(null);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ValidationError);
    }
  });

  it('strips unknown top-level keys (effect/Schema default behavior)', () => {
    const data = { unknownKey: 'should-be-stripped' };
    const result = parseSettings(data);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(Object.keys(result.success)).not.toContain('unknownKey');
    }
  });
});
