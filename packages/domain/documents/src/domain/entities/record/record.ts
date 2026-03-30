import * as S from 'effect/Schema';
import { DocumentSchema } from '../document/document.js';
import { UnpublishedSchema } from '../unpublished/unpublished.js';
import { FolderSchema } from '@laikacms/storage';

export const RecordSchema = S.Union([
  DocumentSchema,
  UnpublishedSchema,
  FolderSchema,
]);

export type Record = S.Schema.Type<typeof RecordSchema>;
