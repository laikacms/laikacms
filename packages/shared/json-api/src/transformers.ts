import { z } from "zod";

export function toJsonApiNoId<T extends string, O extends Record<string, unknown>>(
  dataSchema: z.ZodType<O>,
  type: T
) {
  return dataSchema.transform((data) => {
    return {
      type,
      attributes: data,
    };
  });
}

/**
 * Transforms a domain object to JSON:API resource format
 * @param dataSchema - Zod schema for the domain object
 * @param type - JSON:API resource type
 * @param idField - Name of the ID field in the domain object
 */
export function toJsonApi<
  T extends string,
  O extends Record<string, unknown>,
  I extends keyof O
>(dataSchema: z.ZodType<O>, type: T, idField: I) {
  return dataSchema.transform((data) => {
    const { [idField]: id, ...attributes } = data;

    return {
      type,
      id: id as string,
      attributes,
    };
  });
}

/**
 * Transforms a JSON:API resource to domain object format
 * @param dataSchema - Zod schema for the domain object
 * @param type - JSON:API resource type
 * @param idField - Name of the ID field in the domain object
 */
export function fromJsonApi<
  T extends string,
  I extends string,
  O extends Record<string, unknown>
>(dataSchema: z.ZodType<O> & (z.ZodObject<any>), type: T, idField: I) {
  const attributesZ = dataSchema.omit({ [idField]: true });
  return z
    .object({
      type: z.literal(type),
      id: z.string(),
      attributes: attributesZ,
    })
    .transform((data) => {
      return {
        [idField]: data.id,
        ...data.attributes,
      } as O;
    });
}

export function fromJsonApiNoId<
  T extends string,
  O extends Record<string, unknown>
>(dataSchema: z.ZodType<O>, type: T) {
  const attributesZ = dataSchema;
  return z
    .object({
      type: z.literal(type),
      attributes: attributesZ,
    })
    .transform((data) => {
      return {
        ...data.attributes,
      } as O;
    });
}