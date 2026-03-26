import { z } from 'zod';
import { AtomBaseSchema } from '../atom/atom-base.js';

export const folderZ = AtomBaseSchema.extend({
  type: z.literal('folder'),
});

export type Folder = z.infer<typeof folderZ>;