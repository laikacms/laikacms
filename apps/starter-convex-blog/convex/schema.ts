import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  laika_files: defineTable({
    path: v.string(),
    parent: v.string(),
    name: v.string(),
    extension: v.string(),
    content: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_parent_name', ['parent', 'name'])
    .index('by_parent', ['parent'])
    .index('by_path', ['path']),

  laika_folders: defineTable({
    path: v.string(),
    parent: v.string(),
    name: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_path', ['path'])
    .index('by_parent', ['parent']),
});
