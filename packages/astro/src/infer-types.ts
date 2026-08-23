/**
 * Inferring TypeScript types from the content itself.
 *
 * Not every collection has a schema to derive from. Storage objects have no
 * catalog fields at all, and a convention catalog describes a document
 * collection only permissively. Those collections would otherwise reach a
 * template as `unknown`, which is where the Vite plugin's typegen earns its
 * keep — it types `laika:store/*` imports from the real data on disk.
 *
 * This is that idea for the Content Layer: read what is actually there, and
 * describe it. The result is a union across every entry in the collection, so a
 * field present in only some of them comes out optional — which is both honest
 * and what a template needs to be forced to handle.
 *
 * These types describe the content as it exists *now*, not a contract it must
 * keep. Editors add fields; the types follow on the next build. Where a real
 * contract matters, declare it in the CMS config and the catalog-derived schema
 * takes over, validation included.
 */

/** How a value looked across the entries that had it. */
interface Observed {
  /** Number of entries in which this key was present. */
  seen: number;
  types: Set<string>;
  /** Merged shape, when the value was an object in at least one entry. */
  object?: Map<string, Observed>;
  /** Element observations, when the value was an array. */
  element?: Observed;
}

/**
 * Render a TypeScript type describing every entry in `values`.
 *
 * Returns `Record<string, unknown>` for an empty collection: there is nothing
 * to observe, and inventing a shape would be worse than admitting that.
 */
export function inferTypeScript(values: readonly Record<string, unknown>[]): string {
  if (values.length === 0) return 'Record<string, unknown>';

  const shape = observeAll(values);
  return renderObject(shape, values.length, 0);
}

function observeAll(values: readonly Record<string, unknown>[]): Map<string, Observed> {
  const shape = new Map<string, Observed>();
  for (const value of values) {
    for (const [key, item] of Object.entries(value)) {
      observe(shape, key, item);
    }
  }
  return shape;
}

function observe(shape: Map<string, Observed>, key: string, value: unknown): void {
  let entry = shape.get(key);
  if (entry === undefined) {
    entry = { seen: 0, types: new Set() };
    shape.set(key, entry);
  }
  entry.seen += 1;
  record(entry, value);
}

function record(entry: Observed, value: unknown): void {
  if (value === null) {
    entry.types.add('null');
    return;
  }
  if (Array.isArray(value)) {
    entry.types.add('array');
    entry.element ??= { seen: 0, types: new Set() };
    for (const item of value) {
      entry.element.seen += 1;
      record(entry.element, item);
    }
    return;
  }
  // A serializer may hand back a Date for a date-typed field.
  if (value instanceof Date) {
    entry.types.add('Date');
    return;
  }
  if (typeof value === 'object') {
    entry.types.add('object');
    entry.object ??= new Map();
    const nested = entry.object;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      observe(nested, key, item);
    }
    return;
  }
  entry.types.add(typeof value);
}

function renderObject(shape: Map<string, Observed>, total: number, depth: number): string {
  if (shape.size === 0) return 'Record<string, unknown>';

  const indent = '  '.repeat(depth + 1);
  const closing = '  '.repeat(depth);
  const lines = [...shape.entries()].map(([key, observed]) => {
    // Present in every entry → required. Present in some → optional, because a
    // template that reads it must handle the entries that lack it.
    const optional = observed.seen < total ? '?' : '';
    return `${indent}${propertyName(key)}${optional}: ${renderObserved(observed, depth + 1)};`;
  });
  return `{\n${lines.join('\n')}\n${closing}}`;
}

function renderObserved(observed: Observed, depth: number): string {
  const parts: string[] = [];
  for (const type of observed.types) {
    switch (type) {
      case 'object':
        parts.push(
          observed.object === undefined
            ? 'Record<string, unknown>'
            : renderObject(observed.object, countObjectOccurrences(observed), depth),
        );
        break;
      case 'array':
        parts.push(
          observed.element === undefined || observed.element.seen === 0
            ? 'unknown[]'
            : `Array<${renderObserved(observed.element, depth)}>`,
        );
        break;
      case 'string':
      case 'number':
      case 'boolean':
      case 'null':
      case 'Date':
        parts.push(type);
        break;
      default:
        parts.push('unknown');
    }
  }
  if (parts.length === 0) return 'unknown';
  const unique = [...new Set(parts)];
  return unique.length === 1 ? unique[0]! : unique.join(' | ');
}

/**
 * How many entries contributed to a nested object's shape.
 *
 * Only the occurrences where the value *was* an object count: a key that is
 * sometimes a string and sometimes an object must not mark the object's own
 * fields optional just because the string occurrences lacked them.
 */
function countObjectOccurrences(observed: Observed): number {
  if (observed.object === undefined) return observed.seen;
  let most = 0;
  for (const nested of observed.object.values()) most = Math.max(most, nested.seen);
  return most;
}

/** Quote a key that is not a valid bare identifier. */
function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}
