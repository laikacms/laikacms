/**
 * Reference Convex functions for @laikacms/convex StorageRepository.
 *
 * Copy this file and convex/schema.ts into your Convex project, then run
 * `npx convex dev` to deploy. The ConvexStorageRepository in src/laika.ts
 * calls these functions by name (`laika:getFile`, `laika:createFile`, etc.).
 *
 * Function contract — each function's arg/return shape is stable; the
 * ConvexStorageRepository depends on it. Do not rename exported functions
 * unless you also update the `functions` option in ConvexStorageRepository.
 */
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ───────────────────────── queries ─────────────────────────

export const getFile = query({
  args: { parent: v.string(), name: v.string() },
  handler: async (ctx, { parent, name }) =>
    ctx.db
      .query('laika_files')
      .withIndex('by_parent_name', q => q.eq('parent', parent).eq('name', name))
      .unique(),
});

export const getFolder = query({
  args: { path: v.string() },
  handler: async (ctx, { path }) =>
    ctx.db
      .query('laika_folders')
      .withIndex('by_path', q => q.eq('path', path))
      .unique(),
});

export const listChildren = query({
  args: { parent: v.string() },
  handler: async (ctx, { parent }) => {
    const files = await ctx.db
      .query('laika_files')
      .withIndex('by_parent', q => q.eq('parent', parent))
      .collect();
    const folders = await ctx.db
      .query('laika_folders')
      .withIndex('by_parent', q => q.eq('parent', parent))
      .collect();
    return [
      ...files.map(f => ({ ...f, type: 'file' as const })),
      ...folders.map(f => ({ ...f, type: 'folder' as const })),
    ];
  },
});

export const hasDescendants = query({
  args: { parent: v.string() },
  handler: async (ctx, { parent }) => {
    if (parent === '') {
      const anyFile = await ctx.db.query('laika_files').first();
      if (anyFile) return true;
      const anyFolder = await ctx.db.query('laika_folders').first();
      return anyFolder !== null;
    }
    const file = await ctx.db
      .query('laika_files')
      .withIndex('by_parent', q => q.eq('parent', parent))
      .first();
    if (file) return true;
    const folder = await ctx.db
      .query('laika_folders')
      .withIndex('by_parent', q => q.eq('parent', parent))
      .first();
    return folder !== null;
  },
});

// ───────────────────────── mutations ─────────────────────────

export const createFile = mutation({
  args: {
    path: v.string(),
    parent: v.string(),
    name: v.string(),
    extension: v.string(),
    content: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('laika_files')
      .withIndex('by_parent_name', q => q.eq('parent', args.parent).eq('name', args.name))
      .unique();
    if (existing) throw new Error(`File already exists: ${args.path}`);
    const id = await ctx.db.insert('laika_files', args);
    return ctx.db.get(id);
  },
});

export const updateFile = mutation({
  args: { path: v.string(), content: v.string(), updatedAt: v.string() },
  handler: async (ctx, { path, content, updatedAt }) => {
    const file = await ctx.db
      .query('laika_files')
      .withIndex('by_path', q => q.eq('path', path))
      .unique();
    if (!file) throw new Error(`File not found: ${path}`);
    await ctx.db.patch(file._id, { content, updatedAt });
    return ctx.db.get(file._id);
  },
});

export const upsertFile = mutation({
  args: {
    path: v.string(),
    parent: v.string(),
    name: v.string(),
    extension: v.string(),
    content: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('laika_files')
      .withIndex('by_parent_name', q => q.eq('parent', args.parent).eq('name', args.name))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content, updatedAt: args.updatedAt });
      return ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert('laika_files', args);
    return ctx.db.get(id);
  },
});

export const upsertFolder = mutation({
  args: {
    path: v.string(),
    parent: v.string(),
    name: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('laika_folders')
      .withIndex('by_path', q => q.eq('path', args.path))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { updatedAt: args.updatedAt });
      return ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert('laika_folders', args);
    return ctx.db.get(id);
  },
});

/**
 * Atomic batch delete — all paths removed in one transaction.
 * Returns {removed, missing} so the StorageRepository can report skipped keys.
 */
export const removeFiles = mutation({
  args: { paths: v.array(v.string()) },
  handler: async (ctx, { paths }) => {
    const removed: string[] = [];
    const missing: string[] = [];
    for (const path of paths) {
      const file = await ctx.db
        .query('laika_files')
        .withIndex('by_path', q => q.eq('path', path))
        .unique();
      if (file) {
        await ctx.db.delete(file._id);
        removed.push(path);
      } else {
        missing.push(path);
      }
    }
    return { removed, missing };
  },
});
