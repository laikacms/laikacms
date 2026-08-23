/**
 * The page data that lives in `content/`, read once and typed once.
 *
 * `getCollection` is server-only, so it cannot be called from the React
 * components that consume this data. Loading it here — in a module those
 * components import — keeps the call on the server while leaving the component
 * tree untouched.
 *
 * `entry.data` is typed: the loaders describe the YAML they find and Astro
 * generates entry types from that description, so this file asserts the shape
 * against the component prop types rather than inventing it. Where the two
 * disagree, the cast is the place to look.
 */
import { getCollection, getEntry } from 'astro:content';

import type { BackendGroupData } from '../components/BackendGroup';
import type { CodePanelProps } from '../components/CodePanel';
import type { CompareProps } from '../components/Compare';

/* Ordered by entry id, which is the `01-`, `02-` … filename prefix. Reordering
   the page is a rename, not a code change. */
export const LAIKA_GROUPS: BackendGroupData[] = (await getCollection('backends'))
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(entry => entry.data as BackendGroupData);

export const codeSwap: CodePanelProps = (await getEntry('codeSwap', 'hero'))!.data as CodePanelProps;

export const compare: CompareProps = (await getEntry('compare', 'field'))!.data as CompareProps;
