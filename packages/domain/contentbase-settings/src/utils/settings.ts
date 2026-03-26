import { JSONSchema7 } from "json-schema";
import { ContentBaseSettings, contentBaseSettingsZ } from "../entities/settings.js";
import { failure, InvalidData, Result, success } from "@laikacms/core";

export const createDefaultSchema = () : JSONSchema7 => ({
  type: 'object',
  properties: { },
  additionalProperties: true,
});

export const createDefaultSettingsFile = (): ContentBaseSettings => ({
  collections: {},
});

export const parseSettingsJSON = <T>(json: string): Result<ContentBaseSettings> => {
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
  
  const settings = parseSettings(data);
  if (!settings.success) {
    return failure(settings.code, settings.messages.concat(validationErrors));
  }
  return success(settings.data, settings.messages.concat(validationErrors));
}
  
export const parseSettings = (
  data: unknown
): Result<ContentBaseSettings> => {
  let validationErrors: string[] = [];

  const valid = contentBaseSettingsZ.safeParse(data);
    
  if (!valid.success) {
    console.log('data', data);
    validationErrors = validationErrors.concat(
      valid.error.issues.map((e) => `Settings validation error at ${e.path.join('.')} : ${e.message} (received ${JSON.stringify(e.input)})`)
    );

    return failure(InvalidData.CODE, validationErrors);
  }

  return success(valid.data!, validationErrors);
};
