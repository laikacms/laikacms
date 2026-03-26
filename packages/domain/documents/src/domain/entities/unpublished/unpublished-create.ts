import { z } from "zod";
import { unpublishedZ } from "./unpublished.js";

/**
 * Schema for creating a new unpublished document
 */
export const unpublishedCreateZ = unpublishedZ.omit({
  createdAt: true,
  updatedAt: true,
});

export type UnpublishedCreate = z.infer<typeof unpublishedCreateZ>;
