/**
 * The type channel for live collections.
 *
 * A build-time loader can hand Astro a `createSchema()` and get `entry.data`
 * typed from it. A live loader has no such hook — its data type flows only
 * through the `LiveLoader` generic — so the types have to arrive some other
 * way, and the only way that costs a project nothing is module augmentation.
 *
 * The integration reads the catalog at `astro:config:done` and writes exactly
 * that augmentation into `.astro/`, so a collection the CMS config describes is
 * typed without anyone declaring it twice. A collection the catalog cannot
 * describe simply is not a member, and {@link liveDocumentsLoader} falls back to
 * `Record<string, unknown>` for it — the same "unknown rather than wrong"
 * position the Zod and TypeScript renderers take on a widget they don't know.
 *
 * This interface lives in its own module because that is what makes the
 * augmentation merge: `declare module` adds declarations to the module the
 * specifier resolves to, and a re-export is an alias, not a declaration. Target
 * this exact specifier.
 *
 * Overriding a generated member is the same mechanism, and wins — write it
 * yourself when a custom widget resolves to `unknown` and you know better:
 *
 * ```ts
 * declare module '@laikacms/astro/live-collections' {
 *   interface LaikaLiveCollections {
 *     posts: { title: string, tags: string[] };
 *   }
 * }
 * ```
 */

/**
 * Maps a Laika collection key to the shape of one live entry's `data`.
 *
 * Empty by default. The integration fills it in; a project can add to or
 * replace any member by augmenting this module.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the point is for it to be empty until augmented.
export interface LaikaLiveCollections {}

/** The collection keys the augmentation has typed. `never` when there are none. */
export type LiveCollectionKey = keyof LaikaLiveCollections & string;

/** The `data` shape for one typed live collection. */
export type LiveCollectionData<K extends LiveCollectionKey> = LaikaLiveCollections[K] extends Record<string, unknown>
  ? LaikaLiveCollections[K]
  : Record<string, unknown>;
