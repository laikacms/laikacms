/**
 * Built-in document manipulation tools for AI chat
 *
 * These are CLIENT-SIDE ONLY tools handled by the widget's onToolCall.
 * They have no execute function, so the AI SDK will send them to the client.
 */

import { jsonSchema, tool } from 'ai';

import type { Tool } from 'ai';

const jsonPatchOperationNames = ['add', 'remove', 'replace', 'move', 'copy', 'test'] as const;
const jsonPatchOperationKeys = ['op', 'path', 'value', 'from'] as const;

type JsonPatchOperation = {
  op: typeof jsonPatchOperationNames[number],
  path: string,
  value?: unknown,
  from?: string,
};

type UpdateDocumentInput = {
  operations: JsonPatchOperation[],
};

const jsonPatchOperations = new Set<JsonPatchOperation['op']>(jsonPatchOperationNames);
const jsonPatchOperationKeySet = new Set<string>(jsonPatchOperationKeys);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateEmptyObject(value: unknown) {
  return isRecord(value) && Object.keys(value).length === 0
    ? { success: true as const, value }
    : { success: false as const, error: new Error('Expected an empty object') };
}

function isJsonPatchOperation(value: unknown): value is JsonPatchOperation {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.every(key => jsonPatchOperationKeySet.has(key))
    && typeof value.op === 'string'
    && jsonPatchOperations.has(value.op as JsonPatchOperation['op'])
    && typeof value.path === 'string'
    && (value.from === undefined || typeof value.from === 'string');
}

function validateUpdateDocumentInput(value: unknown) {
  if (
    isRecord(value)
    && Object.keys(value).every(key => key === 'operations')
    && Array.isArray(value.operations)
    && value.operations.every(isJsonPatchOperation)
  ) {
    return { success: true as const, value: value as UpdateDocumentInput };
  }
  return {
    success: false as const,
    error: new Error('Expected an object containing valid JSON Patch operations'),
  };
}

/**
 * Get the full document data
 * CLIENT-SIDE ONLY - handled by widget's onToolCall
 */
// Explicit Tool annotations keep the emitted declarations from referencing
// @ai-sdk/provider-utils internals (TS2883, "cannot be named").
export const getDocumentData: Tool = tool({
  description: `Get the complete document data as JSON.

Returns:
- success: boolean
- slug: string - document identifier
- collection: string - collection name
- data: object - the full document data`,
  inputSchema: jsonSchema(
    {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    { validate: validateEmptyObject },
  ),
  // No execute - client-side only
});

/**
 * JSON Patch operation schema (RFC 6902)
 */
const jsonPatchOperationSchema = {
  type: 'object' as const,
  properties: {
    op: {
      type: 'string' as const,
      enum: [...jsonPatchOperationNames],
      description: 'The operation to perform',
    },
    path: {
      type: 'string' as const,
      description: 'JSON Pointer path (e.g., "/title" or "/blocks/0/content")',
    },
    value: {
      description: 'The value for add/replace/test operations',
    },
    from: {
      type: 'string' as const,
      description: 'Source path for move/copy operations',
    },
  },
  required: ['op', 'path'],
  additionalProperties: false,
};

/**
 * Update document using JSON Patch (RFC 6902)
 * CLIENT-SIDE ONLY - handled by widget's onToolCall
 */
export const updateDocument: Tool = tool({
  description:
    `Update the document using JSON Patch operations (RFC 6902). This tool modifies the document directly in the CMS.

Operations:
- "add": Add a value at the specified path. Creates intermediate objects/arrays as needed.
- "remove": Remove the value at the specified path.
- "replace": Replace the value at the specified path with a new value.
- "move": Move a value from one path to another.
- "copy": Copy a value from one path to another.
- "test": Test that a value at the specified path equals the given value.

Path format: JSON Pointer (RFC 6901) - e.g., "/title", "/blocks/0/content", "/metadata/author"

Examples:
- Replace title: { "op": "replace", "path": "/title", "value": "New Title" }
- Add to array: { "op": "add", "path": "/tags/-", "value": "new-tag" }
- Remove field: { "op": "remove", "path": "/deprecated_field" }
- Move field: { "op": "move", "from": "/old_path", "path": "/new_path" }

Returns:
- success: boolean - true if patch was applied successfully
- error: string (on failure) - error message describing what went wrong

IMPORTANT: This tool executes on the client and directly modifies the CMS entry.`,
  inputSchema: jsonSchema<UpdateDocumentInput>(
    {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: jsonPatchOperationSchema,
          description: 'Array of JSON Patch operations to apply',
        },
      },
      required: ['operations'],
      additionalProperties: false,
    },
    { validate: validateUpdateDocumentInput },
  ),
  // No execute - client-side only
});

/**
 * Client-side document tools
 * These are handled by the widget's onToolCall handler
 */
export const documentTools: Record<string, Tool> = {
  getDocumentData,
  updateDocument,
};

export default documentTools;
