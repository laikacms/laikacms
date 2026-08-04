import type { LaikaNamespace } from '../protocol.js';

/**
 * A single content-change notification. `kind` is `upsert` when an item was
 * created or modified (regenerate its types) and `delete` when it was removed
 * (drop its types).
 */
export interface ContentChangeEvent {
  readonly namespace: LaikaNamespace;
  readonly key: string;
  readonly kind: 'upsert' | 'delete';
}

/**
 * Minimal push channel the typegen consumes to regenerate incrementally. The
 * plugin (or any host) implements this over whatever its underlying repository
 * exposes — the typegen deliberately does NOT watch the filesystem itself.
 *
 * `subscribe` returns an unsubscribe function.
 */
export interface ContentChangeChannel {
  subscribe(listener: (event: ContentChangeEvent) => void): () => void;
}
