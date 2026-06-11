import type { StorageSerializerRegistry } from 'laikacms/storage';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

/**
 * Same registry the `serve` command uses. Drivers fall back to this when the
 * user hasn't configured a custom set on the BackendSpec.
 */
export const defaultSerializerRegistry: StorageSerializerRegistry = {
  md: markdownSerializer,
  markdown: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
};
