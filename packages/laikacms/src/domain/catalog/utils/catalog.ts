import * as Result from 'effect/Result';
import * as S from 'effect/Schema';
import type { JSONSchema7 } from 'json-schema';
import type { LaikaResult } from 'laikacms/core';
import { ValidationError } from 'laikacms/core';
import type { Catalog } from '../entities/catalog.js';
import { CatalogSchema } from '../entities/catalog.js';

export const createDefaultSchema = (): JSONSchema7 => ({
  type: 'object',
  properties: {},
  additionalProperties: true,
});

export const createDefaultCatalog = (): Catalog => ({
  collections: {},
});

export const parseCatalogJSON = (json: string): LaikaResult<Catalog> => {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    console.error(error);
    return Result.fail(
      new ValidationError(
        'The .laika/catalog document is not valid JSON and could not be parsed.',
      ),
    );
  }

  return parseCatalog(data);
};

export const parseCatalog = (
  data: unknown,
): LaikaResult<Catalog> => {
  try {
    const decoded = S.decodeUnknownSync(CatalogSchema)(data);
    return Result.succeed(decoded);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.fail(new ValidationError('Invalid settings data: ' + message));
  }
};
