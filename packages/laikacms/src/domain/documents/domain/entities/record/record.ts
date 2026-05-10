import { FolderSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentSchema } from '../document/document.js';
import { UnpublishedSchema } from '../unpublished/unpublished.js';

export const RecordSchema = S.Union([
  DocumentSchema,
  UnpublishedSchema,
  FolderSchema,
]);

export type Record = S.Schema.Type<typeof RecordSchema>;
