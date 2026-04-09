import * as S from 'effect/Schema';

export const AtomTypeSchema = S.toStandardSchemaV1(S.Literals(['document', 'media', 'dir']));

export type AtomType = S.Schema.Type<typeof AtomTypeSchema>;
