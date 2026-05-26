import { detectMapper } from '../mapper/detect';
import { getMapper } from '../mapper/registry';
import type { PortableTextDocument } from '../portable-text';

export interface RichtextValueOptions {
  /**
   * The field's `format` property: the desired output format and the
   * tie-breaker for input-format detection.
   */
  hint?: string;
  /**
   * Explicit output format. Defaults to `hint`, then to the detected input
   * format.
   */
  outputFormat?: string;
}

/**
 * A lazy rich-text value.
 *
 * This is the editor-agnostic object the widget stores as its field value.
 * The expensive serialised string is produced only when `toString()` /
 * `toJSON()` is called — which Decap CMS does once, at file-write time —
 * not on every keystroke.
 *
 * Flow on construction:
 *   `raw` (string) → detect mapper → Portable Text (held in `portableText`).
 *
 * The editor widget binds to this proxy, mirrors `portableText` to its
 * native model as the user types, and writes the canonical PT back via
 * {@link setPortableText} whenever the user changes the document.
 *
 * `toString()` reverses the flow: PT → the output mapper's string form.
 */
export class RichtextValue {
  /** The original stored string this value was created from. */
  readonly raw: string;
  /** Detected mapper id of `raw`. */
  readonly inputFormat: string;
  /** Mapper id used by `toString()`. Mutable: the user can change it. */
  outputFormat: string;
  /** Canonical Portable Text view; replaced by the editor as the user types. */
  portableText: PortableTextDocument;

  #serialized: string | null = null;
  #serializedFor: PortableTextDocument | null = null;
  #serializedForFormat: string | null = null;

  constructor(raw: string, options: RichtextValueOptions = {}) {
    this.raw = raw;
    this.inputFormat = detectMapper(raw, options.hint);
    this.outputFormat = options.outputFormat ?? options.hint ?? this.inputFormat;
    this.portableText = raw === '' ? [] : getMapper(this.inputFormat).toPortableText(raw);
  }

  /** Replace the canonical PT view. Invalidates the memoised serialisation. */
  setPortableText(doc: PortableTextDocument): void {
    this.portableText = doc;
    this.#serialized = null;
  }

  /** Change the output format. Invalidates the memoised serialisation. */
  setOutputFormat(format: string): void {
    this.outputFormat = format;
    this.#serialized = null;
  }

  /**
   * Serialize to the output format. Computed lazily and memoised until the
   * Portable Text or output format changes.
   */
  toString(): string {
    if (
      this.#serialized !== null
      && this.#serializedFor === this.portableText
      && this.#serializedForFormat === this.outputFormat
    ) {
      return this.#serialized;
    }
    const output = getMapper(this.outputFormat).fromPortableText(this.portableText);
    this.#serialized = output;
    this.#serializedFor = this.portableText;
    this.#serializedForFormat = this.outputFormat;
    return output;
  }

  /** `JSON.stringify` of an entry calls this; yields the serialised string. */
  toJSON(): string {
    return this.toString();
  }
}

/** Create a {@link RichtextValue} from a stored string. */
export function createRichtextValue(
  raw: string,
  options?: RichtextValueOptions,
): RichtextValue {
  return new RichtextValue(raw, options);
}
