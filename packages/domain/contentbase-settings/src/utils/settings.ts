import type { LaikaResult} from '@laikacms/core';
import { ValidationError } from '@laikacms/core';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';
import type { JSONSchema7 } from 'json-schema';
import type { ContentBaseSettings} from '../entities/settings.js';
import { ContentBaseSettingsSchema } from '../entities/settings.js';

export const createDefaultSchema = (): JSONSchema7 => ({
  type: 'object',
  properties: {},
  additionalProperties: true,
});

export const createDefaultSettingsFile = (): ContentBaseSettings => ({
  collections: {},
});

export const parseSettingsJSON = <T>(json: string): LaikaResult<ContentBaseSettings> => {
  let data: unknown;
  try {
    data = JSON.parse(json);
     
  } catch (error) {
    console.error(error);
    return Result.fail(
      new ValidationError(
        'The .contentbase/settings.json file is not valid JSON and could not be parsed.',
      ),
    );
  }

  return parseSettings(data);
};

export const parseSettings = (
  data: unknown,
): LaikaResult<ContentBaseSettings> => {
  try {
    const decoded = S.decodeUnknownSync(ContentBaseSettingsSchema)(data);
    return Result.succeed(decoded);
  } catch (error) {
    console.log('data', data);
    const message = error instanceof Error ? error.message : String(error);
    return Result.fail(new ValidationError('Invalid settings data: ' + message));
  }
};
