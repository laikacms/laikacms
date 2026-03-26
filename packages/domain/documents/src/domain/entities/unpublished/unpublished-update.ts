import { z } from "zod";
import { unpublishedZ } from "./unpublished.js";

/**
 * Schema for updating an unpublished document
 * Only key and content are required, status can be changed to transition between states
 */
export const unpublishedUpdateZ = unpublishedZ.pick({
  key: true,
  content: true,
  status: true,
}).partial({
  content: true,
  status: true,
});

export type UnpublishedUpdate = z.infer<typeof unpublishedUpdateZ>;
