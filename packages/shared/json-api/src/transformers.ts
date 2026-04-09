/**
 * JSON:API transformers
 *
 * These are plain functions that transform between domain objects and JSON:API format.
 * They don't use schemas since the transformation is just object restructuring.
 */

/**
 * Transforms a domain object to JSON:API resource format (without id)
 * @param data - The domain object
 * @param type - JSON:API resource type
 */
export function toJsonApiNoId<T extends string, O extends Record<string, unknown>>(
  data: O,
  type: T,
): { type: T, attributes: O } {
  return {
    type,
    attributes: data,
  };
}

/**
 * Transforms a domain object to JSON:API resource format
 * @param data - The domain object
 * @param type - JSON:API resource type
 * @param idField - Name of the ID field in the domain object
 */
export function toJsonApi<
  T extends string,
  O extends Record<string, unknown>,
  I extends keyof O,
>(data: O, type: T, idField: I): { type: T, id: string, attributes: Omit<O, I> } {
  const { [idField]: id, ...attributes } = data;

  return {
    type,
    id: id as string,
    attributes: attributes as Omit<O, I>,
  };
}

/**
 * Transforms a JSON:API resource to domain object format
 * @param data - The JSON:API resource
 * @param _type - JSON:API resource type (for type checking, not used at runtime)
 * @param idField - Name of the ID field in the domain object
 */
export function fromJsonApi<
  T extends string,
  I extends string,
  O extends Record<string, unknown>,
>(data: { type: T, id: string, attributes: Omit<O, I> }, _type: T, idField: I): O {
  return {
    [idField]: data.id,
    ...data.attributes,
  } as O;
}

/**
 * Transforms a JSON:API resource to domain object format (without id)
 * @param data - The JSON:API resource
 */
export function fromJsonApiNoId<
  T extends string,
  O extends Record<string, unknown>,
>(data: { type: T, attributes: O }): O {
  return {
    ...data.attributes,
  };
}
