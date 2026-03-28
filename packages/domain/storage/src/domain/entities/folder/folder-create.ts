import * as S from 'effect/Schema';

export const FolderCreateSchema = S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('folder'),
});

export const FolderCreateSchemaStandardV1 = S.toStandardSchemaV1(FolderCreateSchema);

export type FolderCreate = S.Schema.Type<typeof FolderCreateSchema>;