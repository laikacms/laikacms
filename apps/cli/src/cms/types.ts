/**
 * The CMS-adapter seam: everything the CLI needs to know about an admin UI it
 * can scaffold, so that "which CMS" is a value in a registry rather than a
 * hardcoded package name. Decap is the only adapter today (see `./decap.ts`);
 * the `create` wizard therefore skips the CMS question entirely and uses the
 * default, exactly as it skips the starter question while one starter exists.
 *
 * Note the vocabulary clash with `../drivers/types.ts`: a *storage* driver
 * decides where LaikaCMS keeps content, while a *CMS backend* is one of the
 * content sources the admin UI itself can talk to. They are separate axes.
 */

/** One pickable item in an adapter catalog: the name plus a one-line blurb for the wizard. */
export interface CmsExtension {
  /** Name the user selects, and the name the generated module registers it under. */
  readonly name: string;
  /** One-line description shown next to the choice. */
  readonly description: string;
}

/** What the user chose to scaffold: which CMS, and which of its extensions. */
export interface CmsSelection {
  /** Name of the adapter this selection belongs to — see `cmsAdapters`. */
  readonly adapter: string;
  /** Registered backend names (the `backend.name` values a config may use). */
  readonly backends: readonly string[];
  /** Widget names as used in collection `fields[].widget`. */
  readonly widgets: readonly string[];
  /**
   * Entry-file codecs (`markdown`, `yaml`, `toml`, `json`). Git-style
   * backends read raw files and need one per stored format; the laika
   * backend serves entries as JSON and needs none.
   */
  readonly codecs: readonly string[];
  /** Extra UI locales to register. `en` is built into the core app. */
  readonly locales: readonly string[];
}

/** Where a config file was found, and everything that was checked getting there. */
export interface CmsConfigDiscovery {
  /** Absolute path of the first match, or `''` when nothing was found. */
  readonly resolved: string;
  /** Every absolute path that was checked, so callers can list them in an error. */
  readonly searched: ReadonlyArray<string>;
}

/**
 * A CMS whose collection config lives in a file that `laika local generate`
 * can turn into a typed TypeScript module. Adapters whose config is authored
 * in TypeScript to begin with leave `CmsAdapter.config` undefined.
 */
export interface CmsConfigCodegen {
  /** Look for the config file, starting at `cwd`. */
  discover(cwd: string): Promise<CmsConfigDiscovery>;
  /** Where generated output goes when `--output` is omitted, given a resolved input path. */
  defaultOutput(input: string): string;
  /** Read `input`, write the typed module to `output`, and report the absolute paths used. */
  generate(args: { readonly input: string, readonly output: string }): Promise<
    { readonly input: string, readonly output: string }
  >;
}

/**
 * One admin UI the CLI can scaffold. An adapter owns its own catalogs and its
 * own codegen: nothing outside `./decap.ts` knows what a Decap import looks
 * like. A catalog left empty simply drops its wizard question.
 */
export interface CmsAdapter {
  /** Short identifier used in `--cms` and stored in `CmsSelection.adapter`. e.g. 'decap'. */
  readonly name: string;
  /** Display name shown in the wizard. e.g. 'Decap CMS'. */
  readonly title: string;
  /** One-line description shown next to the choice. */
  readonly description: string;
  /** NPM package the admin UI and all of its extensions ship in. */
  readonly packageName: string;
  /** Content sources the admin UI can be pointed at. */
  readonly backends: readonly CmsExtension[];
  /** Field editors available to collections. */
  readonly widgets: readonly CmsExtension[];
  /** Entry-file formats the admin UI can read and write. */
  readonly codecs: readonly CmsExtension[];
  /** Selectable UI translations, as language tags. Excludes the built-in fallback. */
  readonly locales: readonly string[];
  /** Selection used by `--yes` and by non-interactive runs. */
  readonly defaultSelection: CmsSelection;
  /**
   * Subpaths of `packageName` that a selection imports at runtime. Drives the
   * optional-peer install, so it must cover every extension the generated
   * module pulls in.
   */
  extensionSubpaths(selection: CmsSelection): string[];
  /**
   * Emit the starter's `src/cms.ts` — the single module that registers
   * everything the admin uses. Throws on an unknown or unusable selection.
   */
  generateModule(selection: CmsSelection): string;
  /** Typed-config codegen, when this CMS keeps its collections in a config file. */
  readonly config?: CmsConfigCodegen;
}
