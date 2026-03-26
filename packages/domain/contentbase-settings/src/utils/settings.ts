import { JSONSchema7 } from "json-schema";
import { ContentBaseSettings, contentBaseSettingsZ } from "../entities/settings.js";
import * as Result from "effect/Result";
import { LaikaError, LaikaResult, ValidationError } from "@laikacms/core";

export const createDefaultSchema = () : JSONSchema7 => ({
  type: 'object',
  properties: { },
  additionalProperties: true,
});

export const createDefaultSettingsFile = (): ContentBaseSettings => ({
  collections: {},
});

export const parseSettingsJSON = <T>(json: string): LaikaResult<ContentBaseSettings> => {
  let data: ContentBaseSettings;
  let validationErrors: string[] = [];
  try {
    data = JSON.parse(json);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    console.error(error);
    data = createDefaultSettingsFile();
    validationErrors.push(
      "The .contentbase/settings.json file is not valid JSON and could not be parsed."
    ); 
  }
  
  return parseSettings(data);
}
  
export const parseSettings = (
  data: unknown
): LaikaResult<ContentBaseSettings> => {
  let validationErrors: string[] = [];

  const valid = contentBaseSettingsZ.safeParse(data);
    
  if (!valid.success) {
    console.log('data', data);
    validationErrors = validationErrors.concat(
      valid.error.issues.map((e) => `Settings validation error at ${e.path.join('.')} : ${e.message} (received ${JSON.stringify(e.input)})`)
    );

    return Result.fail(new ValidationError("Invalid settings data: " + validationErrors.join(', ')));
  }

  return Result.succeed(valid.data);
};
