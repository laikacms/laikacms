/**
 * Ambient declarations for the WICG File System Access API surface this
 * starter uses beyond what TypeScript's lib.dom ships: the directory picker
 * and the permission methods on handles. Both exist only in Chromium-based
 * browsers; every call site feature-detects before calling.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite',
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker?(options?: {
    id?: string,
    mode?: 'read' | 'readwrite',
    startIn?: string,
  }): Promise<FileSystemDirectoryHandle>;
}
