import { z } from 'zod';
import { atomBaseZ } from '../atom/atom-base.js';

export const folderZ = atomBaseZ.extend({
  type: z.literal('folder'),
});

export type Folder = z.infer<typeof folderZ>;