import { z } from "zod";

export const atomTypeZ = z.union([
  z.literal('document'),
  z.literal('media'),
  z.literal('dir')
])

export type AtomType = z.infer<typeof atomTypeZ>