import { isoDateWithFallbackZ } from "@laikacms/core"
import { z } from "zod"

export const atomBaseZ = z.object({
  key: z.string().max(1023, "Key cannot be longer than 1023 characters"),

  createdAt: isoDateWithFallbackZ().optional(),
  updatedAt: isoDateWithFallbackZ().optional(),
})

export type AtomBase = z.infer<typeof atomBaseZ>