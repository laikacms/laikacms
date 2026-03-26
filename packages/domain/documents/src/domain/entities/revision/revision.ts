import { isoDateWithFallbackZ } from '@laikacms/core';
import { atomBaseZ, storageObjectContentZ, storageObjectZ } from '@laikacms/storage';
import { z } from 'zod';

export const revisionZ = storageObjectZ.extend({
  type: z.literal('revision'),
  content: storageObjectContentZ,
  revision: z.string(),
  createdAt: isoDateWithFallbackZ(),
});

export type Revision = z.infer<typeof revisionZ>;
