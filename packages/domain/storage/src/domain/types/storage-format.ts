import z from "zod";

export const storageFormatZ = z.string().brand<'StorageFormat'>();

export type StorageFormat = z.infer<typeof storageFormatZ>;
