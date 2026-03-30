import * as S from 'effect/Schema';
import { AtomBaseSchema } from '../atom/atom-base.js';

export const FolderSchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('folder'),
}));

export type Folder = S.Schema.Type<typeof FolderSchema>;