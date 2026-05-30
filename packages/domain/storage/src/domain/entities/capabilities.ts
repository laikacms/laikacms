/**
 * Describes the optional capabilities a StorageRepository backend may support.
 * Clients can query this at startup to skip operations the backend does not handle.
 */
export interface Capabilities {
  /** Whether the backend supports server-side full-text search */
  search: boolean;
  /** Whether the backend supports server-side pagination */
  pagination: boolean;
  /** Whether the backend supports content versioning/history */
  versioning: boolean;
}

export const defaultCapabilities: Capabilities = {
  search: false,
  pagination: false,
  versioning: false,
};
