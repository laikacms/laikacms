// ---------------------------------------------------------------------------
// Focused Turtle parser
// ---------------------------------------------------------------------------
//
// This is NOT a full RFC 3987 / W3C Turtle implementation. The Linked Data
// Platform (LDP) container-listing format that Solid Pod servers emit uses
// a tractable subset:
//
//   @prefix ldp: <http://www.w3.org/ns/ldp#>.
//   @prefix dc:  <http://purl.org/dc/terms/>.
//
//   <> a ldp:BasicContainer, ldp:Container;
//      dc:modified "2026-05-20T10:00:00Z";
//      ldp:contains <hello.md>, <world.md>, <notes/>.
//
//   <hello.md> a ldp:Resource.
//   <notes/>   a ldp:BasicContainer.
//
// We need to:
//
//   1. Walk every triple — subject, predicate, object — emitted by such a
//      document.
//   2. Resolve relative IRIs (`<hello.md>`) against the document base URL.
//   3. Expand prefixed names (`ldp:contains`) using `@prefix` declarations.
//   4. Recognise the `a` keyword as shorthand for `rdf:type`.
//
// Out of scope (deliberately):
//
//   - Blank-node syntax (`[ ]`, `_:b1`)
//   - Collections (`( ... )`)
//   - Typed/language-tagged literals beyond simple string capture
//   - BASE / SPARQL @base directives (LDP servers always use the response URL)
//
// If your Solid server emits anything outside the LDP subset, swap this
// parser for `n3` / `rdflib.js` in your own data source wrapper.

/** A single subject-predicate-object triple, fully expanded to absolute URIs. */
export interface TurtleTriple {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  /** True when `object` is a plain literal (was `"..."`), not an IRI. */
  readonly objectIsLiteral?: boolean;
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/**
 * Resolve a relative IRI reference against a base. Implements the
 * subset of RFC 3986 we actually need — Solid LDP containers always use
 * either fully-absolute IRIs or relative paths.
 */
export const resolveIri = (base: string, ref: string): string => {
  if (ref === '') return base;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref; // already absolute
  if (ref.startsWith('//')) {
    // protocol-relative — borrow the base's scheme
    const schemeEnd = base.indexOf(':');
    return base.slice(0, schemeEnd + 1) + ref;
  }
  if (ref.startsWith('/')) {
    // root-relative
    const schemeEnd = base.indexOf('://');
    const authorityEnd = base.indexOf('/', schemeEnd + 3);
    return (authorityEnd === -1 ? base : base.slice(0, authorityEnd)) + ref;
  }
  // path-relative — strip the base's last segment, append `ref`
  const lastSlash = base.lastIndexOf('/');
  return lastSlash === -1 ? base + ref : base.slice(0, lastSlash + 1) + ref;
};

/**
 * Parse a Turtle document. Returns every triple in document order with
 * IRIs fully resolved against `baseIri`.
 */
export const parseTurtle = (input: string, baseIri: string): TurtleTriple[] => {
  let pos = 0;
  const prefixes: Record<string, string> = {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  };
  const triples: TurtleTriple[] = [];

  const skipWsAndComments = (): void => {
    while (pos < input.length) {
      const ch = input[pos]!;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') pos += 1;
      else if (ch === '#') {
        while (pos < input.length && input[pos] !== '\n') pos += 1;
      } else break;
    }
  };

  const peek = (n = 0): string => input[pos + n] ?? '';

  const consume = (s: string): boolean => {
    if (input.startsWith(s, pos)) {
      pos += s.length;
      return true;
    }
    return false;
  };

  const readIriRef = (): string | null => {
    if (peek() !== '<') return null;
    pos += 1;
    let raw = '';
    while (pos < input.length && input[pos] !== '>') {
      const ch = input[pos]!;
      if (ch === '\\') {
        // \uXXXX or \UXXXXXXXX
        if (peek(1) === 'u') {
          const hex = input.slice(pos + 2, pos + 6);
          raw += String.fromCharCode(parseInt(hex, 16));
          pos += 6;
        } else {
          raw += peek(1);
          pos += 2;
        }
      } else {
        raw += ch;
        pos += 1;
      }
    }
    if (input[pos] !== '>') throw new Error(`Unterminated IRI ref at ${pos}`);
    pos += 1;
    return resolveIri(baseIri, raw);
  };

  const readPrefixedName = (): string | null => {
    const start = pos;
    let prefix = '';
    while (pos < input.length && /[a-zA-Z0-9_-]/.test(input[pos]!)) {
      prefix += input[pos];
      pos += 1;
    }
    if (input[pos] !== ':') { pos = start; return null; }
    pos += 1;
    let local = '';
    while (pos < input.length && /[a-zA-Z0-9_./%-]/.test(input[pos]!)) {
      local += input[pos];
      pos += 1;
    }
    if (!(prefix in prefixes)) {
      throw new Error(`Undefined prefix "${prefix}" at ${start}`);
    }
    return prefixes[prefix] + local;
  };

  const readLiteral = (): string | null => {
    if (peek() !== '"') return null;
    pos += 1;
    let raw = '';
    while (pos < input.length && input[pos] !== '"') {
      const ch = input[pos]!;
      if (ch === '\\') {
        const next = peek(1);
        if (next === 'n') raw += '\n';
        else if (next === 't') raw += '\t';
        else if (next === 'r') raw += '\r';
        else if (next === '"') raw += '"';
        else if (next === '\\') raw += '\\';
        else raw += next;
        pos += 2;
      } else {
        raw += ch;
        pos += 1;
      }
    }
    if (input[pos] !== '"') throw new Error(`Unterminated literal at ${pos}`);
    pos += 1;
    // Optional language tag (`@en`) or datatype IRI (`^^<...>`) — we drop them.
    if (input[pos] === '@') {
      while (pos < input.length && /[a-zA-Z0-9-]/.test(input[pos]!)) pos += 1;
    } else if (input[pos] === '^' && input[pos + 1] === '^') {
      pos += 2;
      readIriRef() ?? readPrefixedName();
    }
    return raw;
  };

  const readTerm = (): { value: string; isLiteral: boolean } | null => {
    skipWsAndComments();
    // `a` keyword — shorthand for rdf:type. Only valid in predicate position;
    // the caller knows when it's expected.
    if (input.startsWith('a', pos)
        && (pos + 1 === input.length || /[\s.,;(<]/.test(input[pos + 1]!))) {
      pos += 1;
      return { value: RDF_TYPE, isLiteral: false };
    }
    const literal = readLiteral();
    if (literal !== null) return { value: literal, isLiteral: true };
    const iri = readIriRef();
    if (iri !== null) return { value: iri, isLiteral: false };
    const prefixed = readPrefixedName();
    if (prefixed !== null) return { value: prefixed, isLiteral: false };
    return null;
  };

  // ---- @prefix declarations -------------------------------------------
  while (pos < input.length) {
    skipWsAndComments();
    if (pos >= input.length) break;

    if (consume('@prefix') || consume('PREFIX')) {
      skipWsAndComments();
      let prefix = '';
      while (pos < input.length && input[pos] !== ':') {
        prefix += input[pos];
        pos += 1;
      }
      pos += 1; // consume `:`
      skipWsAndComments();
      const uri = readIriRef();
      if (uri === null) throw new Error(`Bad @prefix at ${pos}`);
      prefixes[prefix.trim()] = uri;
      skipWsAndComments();
      consume('.');
      continue;
    }

    // ---- Subject -----------------------------------------------------
    const subject = readTerm();
    if (subject === null) break;

    // ---- Predicate-object list ---------------------------------------
    while (true) {
      skipWsAndComments();
      const predicate = readTerm();
      if (predicate === null) break;
      // Object list (comma-separated).
      while (true) {
        skipWsAndComments();
        const object = readTerm();
        if (object === null) break;
        triples.push({
          subject: subject.value,
          predicate: predicate.value,
          object: object.value,
          objectIsLiteral: object.isLiteral,
        });
        skipWsAndComments();
        if (peek() === ',') { pos += 1; continue; }
        break;
      }
      skipWsAndComments();
      if (peek() === ';') { pos += 1; continue; }
      break;
    }
    skipWsAndComments();
    consume('.');
  }

  return triples;
};

/**
 * Serialize a list of triples to Turtle. Used by the test mock; production
 * code only consumes Turtle.
 */
export const serializeTurtle = (
  triples: ReadonlyArray<TurtleTriple>,
  options: { baseIri: string; prefixes?: Record<string, string> } = { baseIri: '' },
): string => {
  const prefixes: Record<string, string> = {
    ldp: 'http://www.w3.org/ns/ldp#',
    dc: 'http://purl.org/dc/terms/',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    ...(options.prefixes ?? {}),
  };
  const relativise = (iri: string): string => {
    if (options.baseIri && iri.startsWith(options.baseIri)) {
      return `<${iri.slice(options.baseIri.length)}>`;
    }
    for (const [prefix, ns] of Object.entries(prefixes)) {
      if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`;
    }
    return `<${iri}>`;
  };
  const obj = (t: TurtleTriple): string => {
    if (t.objectIsLiteral) return `"${t.object.replace(/"/g, '\\"')}"`;
    return relativise(t.object);
  };
  const prefixLines = Object.entries(prefixes).map(
    ([p, ns]) => `@prefix ${p}: <${ns}>.`,
  ).join('\n');
  const triplesLines = triples.map(
    t => `${relativise(t.subject)} ${relativise(t.predicate)} ${obj(t)} .`,
  ).join('\n');
  return `${prefixLines}\n\n${triplesLines}\n`;
};

/** Convenience: `rdf:type`. */
export const RDF_TYPE_IRI = RDF_TYPE;
