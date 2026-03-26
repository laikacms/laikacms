import { StorageProvider } from "@laikacms/storage";

export type FileSystemStorageProvider = StorageProvider & 'filesystem';

export const fileSystemStorageProvider: FileSystemStorageProvider = 'filesystem' as FileSystemStorageProvider;
