/**
 * Built-in document manipulation tools for AI chat
 *
 * These are CLIENT-SIDE ONLY tools handled by the widget's onToolCall.
 * They have no execute function, so the AI SDK will send them to the client.
 */

import { tool } from 'ai';
import { z } from 'zod';

/**
 * Get the full document data
 * CLIENT-SIDE ONLY - handled by widget's onToolCall
 */
export const getDocumentData = tool({
  description: `Get the complete document data as JSON.

Returns:
- success: boolean
- slug: string - document identifier
- collection: string - collection name
- data: object - the full document data`,
  inputSchema: z.object({}),
  // No execute - client-side only
});

/**
 * JSON Patch operation schema (RFC 6902)
 */
const jsonPatchOperationSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']).describe('The operation to perform'),
  path: z.string().describe('JSON Pointer path (e.g., "/title" or "/blocks/0/content")'),
  value: z.unknown().optional().describe('The value for add/replace/test operations'),
  from: z.string().optional().describe('Source path for move/copy operations'),
});

/**
 * Update document using JSON Patch (RFC 6902)
 * CLIENT-SIDE ONLY - handled by widget's onToolCall
 */
export const updateDocument = tool({
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
  inputSchema: z.object({
    operations: z.array(jsonPatchOperationSchema).describe('Array of JSON Patch operations to apply'),
  }),
  // No execute - client-side only
});

/**
 * Client-side document tools
 * These are handled by the widget's onToolCall handler
 */
export const documentTools = {
  getDocumentData,
  updateDocument,
};

export default documentTools;
