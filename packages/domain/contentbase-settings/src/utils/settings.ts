import { JSONSchema7 } from "json-schema";
import { ContentBaseSettings, ContentBaseSettingsSchema } from "../entities/settings.js";
import * as Result from "effect/Result";
import * as S from "effect/Schema";
import { LaikaResult, ValidationError } from "@laikacms/core";

export const createDefaultSchema = () : JSONSchema7 => ({
  type: 'object',
  properties: { },
  additionalProperties: true,
});

export const createDefaultSettingsFile = (): ContentBaseSettings => ({
  collections: {},
});

export const parseSettingsJSON = <T>(json: string): LaikaResult<ContentBaseSettings> => {
  let data: unknown;
  try {
    data = JSON.parse(json);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    console.error(error);
    return Result.fail(new ValidationError(
      "The .contentbase/settings.json file is not valid JSON and could not be parsed."
    ));
  }
  
  return parseSettings(data);
}
  
export const parseSettings = (
  data: unknown
): LaikaResult<ContentBaseSettings> => {
  try {
    const decoded = S.decodeUnknownSync(ContentBaseSettingsSchema)(data);
    return Result.succeed(decoded);
  } catch (error) {
    console.log('data', data);
    const message = error instanceof Error ? error.message : String(error);
    return Result.fail(new ValidationError("Invalid settings data: " + message));
  }
};
