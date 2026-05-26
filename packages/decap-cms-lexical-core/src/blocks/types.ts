import type { ReactNode } from 'react';

/** Arbitrary serializable data carried by a custom block. */
export type BlockData = Record<string, unknown>;

/** Resolves an asset reference (e.g. an image path) to a usable URL. */
export type GetAssetFn = (value: string, field?: unknown) => string;

/** A field definition belonging to a custom block / editor component. */
export interface CmsEditorComponentLikeField {
  name: string;
  label?: string;
  widget?: string;
  [key: string]: unknown;
}

/**
 * A custom block / editor-component definition. Mirrors Decap CMS's
 * `editor_components` plugin shape closely enough to interoperate, without
 * depending on `decap-cms-lib-util`.
 */
export interface CmsEditorComponentLike {
  /** Stable identifier; stored as the block's component id. */
  id: string;
  label?: string;
  type?: 'code-block' | 'shortcode';
  icon?: string;
  widget?: string;
  fields?: CmsEditorComponentLikeField[];
  /** Pattern used to recognise this block when parsing text-based formats. */
  pattern?: RegExp;
  /** Parse a pattern match into block data. */
  fromBlock?: (match: RegExpMatchArray) => unknown;
  /** Serialize block data back to its text representation. */
  toBlock?: (data: unknown) => string;
  /** Render a preview of the block. */
  toPreview?: (data: unknown, getAsset: GetAssetFn, fields?: unknown[]) => string | ReactNode;
}

/** Looks up all registered editor components, keyed by id. */
export type GetEditorComponents = () => Record<string, CmsEditorComponentLike>;

/** Configuration supplied to the blocks subsystem via `BlocksProvider`. */
export interface BlocksConfig {
  getEditorComponents?: GetEditorComponents;
  getAsset?: GetAssetFn;
}
