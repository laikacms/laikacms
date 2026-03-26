import { z } from 'zod';
import { atomBaseZ } from '../atom/atom-base.js';

export const storageObjectContentZ = z.record(z.string(), z.any());

export type StorageObjectContent = z.infer<typeof storageObjectContentZ>;

export const storageObjectZ = atomBaseZ.extend({
  type: z.literal('object'),
  content: storageObjectContentZ,
});

export type StorageObject = z.infer<typeof storageObjectZ>;
