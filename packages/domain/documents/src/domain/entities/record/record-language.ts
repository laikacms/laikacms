import * as S from 'effect/Schema';

// BCP 47 language tags, automatically defaults to 'und' (undetermined) (valid BCP 47) if not provided
export const DocumentLanguage = S.toStandardSchemaV1(S.String.pipe(
  S.withDecodingDefault(() => 'und', {
    encodingStrategy: 'omit', /* When encoding back to JSON, omit the language if it's 'und' */
  }),
));

export type DocumentLanguage = S.Schema.Type<typeof DocumentLanguage>;
