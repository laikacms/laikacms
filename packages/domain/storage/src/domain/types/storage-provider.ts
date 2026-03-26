import z from "zod";

export const storageProviderZ = z.string().brand<'StorageProvider'>();

export type StorageProvider = z.infer<typeof storageProviderZ>;
