import * as S from 'effect/Schema';
import { AtomBaseSchema } from '../atom/atom-base.js';

export const FolderSchema = S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('folder'),
});

export const FolderSchemaStandardV1 = S.toStandardSchemaV1(FolderSchema);

export type Folder = S.Schema.Type<typeof FolderSchema>;