import * as S from 'effect/Schema';

export const AtomTypeSchema = S.Literals(['document', 'media', 'dir']);

export type AtomType = S.Schema.Type<typeof AtomTypeSchema>;