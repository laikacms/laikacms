import { storageObjectContentZ, storageObjectZ } from '@laikacms/storage';
import { z } from 'zod';

export const documentZ = storageObjectZ.extend({
  type: z.literal('published'),
  status: z.literal('published'),
  content: storageObjectContentZ,
});

export type Document = z.infer<typeof documentZ>;

export const documentCodecZ = z.codec(
  storageObjectZ,
  documentZ,
  {
    encode: (data) => ({
      ...data,
      type: 'object' as const
    }),
    decode: (data) => ({
      ...data,
      type: 'published' as const,
      status: 'published' as const,
    }),
  }
);