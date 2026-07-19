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
 * Transforms a domain object to JSON:API resource format.
 *
 * Per JSON:API §7.2.2, a resource object MUST NOT have an attribute named
 * `type` or `id`. This function strips both `type` and `id` (in addition to
 * the caller-supplied idField) from the attributes bag.
 *
 * @param data - The domain object
 * @param type - JSON:API resource type
 * @param idField - Name of the ID field in the domain object
 */
export function toJsonApi<
  T extends string,
  O extends Record<string, unknown>,
  I extends keyof O,
>(data: O, type: T, idField: I): { type: T, id: string, attributes: Omit<O, I | 'type' | 'id'> } {
  const { [idField]: id, type: _domainType, id: _domainId, ...attributes } = data as O & {
    type?: unknown,
    id?: unknown,
  };

  return {
    type,
    id: id as string,
    attributes: attributes as unknown as Omit<O, I | 'type' | 'id'>,
  };
}

/**
 * Transforms a JSON:API resource back to domain object format.
 *
 * Injects `type` from the resource envelope (it was stripped from attributes
 * by `toJsonApi` to comply with JSON:API §7.2.2) and merges the id back under
 * the caller-supplied idField.
 *
 * @param data - The JSON:API resource
 * @param _type - JSON:API resource type (for type checking, not used at runtime)
 * @param idField - Name of the ID field in the domain object
 */
export function fromJsonApi<
  T extends string,
  I extends string,
  O extends Record<string, unknown>,
>(data: { type: T, id: string, attributes: Omit<O, I | 'type' | 'id'> }, _type: T, idField: I): O {
  return {
    type: data.type,
    [idField]: data.id,
    ...data.attributes,
  } as unknown as O;
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
