import { storageProviderZ } from "@laikacms/storage";
import z from "zod";

export const filesystemStorageProviderZ = storageProviderZ.refine((val) => val === 'filesystem');

export type FileSystemStorageProvider = z.infer<typeof filesystemStorageProviderZ>;

export const fileSystemStorageProvider: FileSystemStorageProvider = filesystemStorageProviderZ.parse('filesystem');
