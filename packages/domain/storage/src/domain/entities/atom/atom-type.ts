import * as S from 'effect/Schema';

export const AtomTypeSchema = S.Literals(['document', 'media', 'dir']);

export const AtomTypeSchemaStandardV1 = S.toStandardSchemaV1(AtomTypeSchema);

export type AtomType = S.Schema.Type<typeof AtomTypeSchema>;