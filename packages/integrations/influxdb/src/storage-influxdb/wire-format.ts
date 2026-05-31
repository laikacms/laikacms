// ---------------------------------------------------------------------------
// InfluxDB v2 wire-format adapters
// ---------------------------------------------------------------------------
//
// Two formats live in this file:
//
//   1. **Line protocol** — InfluxDB's textual write format. Each line is:
//
//          <measurement>,<tag_k>=<tag_v>,<tag_k>=<tag_v> <field_k>=<field_v>,... <ns_timestamp>
//
//      Tags are URL-style (key=value, comma-separated). Fields are
//      SQL-string-style (string values quoted, others not). Tag and
//      field-key values have backslash-escape rules; tag values escape
//      `,`, ` `, `=`; field string values escape `"` and `\`.
//
//   2. **Annotated CSV** — InfluxDB's read response format. Three header
//      rows (`#datatype`, `#group`, `#default`) precede the column-name
//      header. Each subsequent row is one data record. The parser strips
//      the annotations and yields `Record<string, string>` data rows.

// ---------------------------------------------------------------------------
// Line protocol — serialize
// ---------------------------------------------------------------------------

/**
 * Escape a tag key, tag value, or measurement name per the line-protocol
 * spec. Per InfluxDB docs, these chars need backslash-escape:
 *   - tag key/value/measurement: `,`, ` ` (space), `=`
 *   - additionally for measurement: tag separator chars are also special
 */
export const escapeTagValue = (s: string): string => {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (ch === ',' || ch === ' ' || ch === '=') out += `\\${ch}`;
    else out += ch;
  }
  return out;
};

/** Escape a string field value — `"` → `\"`, `\` → `\\`. */
export const escapeFieldStringValue = (s: string): string => {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else out += ch;
  }
  return out;
};

/**
 * Serialize a single point to line protocol. Numbers without a decimal
 * are encoded as `Int`; numbers with a decimal as `Float`; strings are
 * quoted; booleans as `t`/`f`.
 */
export const serializeLineProtocolPoint = (point: {
  measurement: string,
  tags: Readonly<Record<string, string>>,
  fields: Readonly<Record<string, string | number | boolean>>,
  /** Nanoseconds since epoch as a string (JS numbers can't hold ns precision). */
  timestampNs: string,
}): string => {
  const tagPart = Object.entries(point.tags)
    .map(([k, v]) => `${escapeTagValue(k)}=${escapeTagValue(v)}`)
    .join(',');
  const fieldPart = Object.entries(point.fields)
    .map(([k, v]) => {
      const key = escapeTagValue(k);
      if (typeof v === 'string') return `${key}="${escapeFieldStringValue(v)}"`;
      if (typeof v === 'boolean') return `${key}=${v ? 't' : 'f'}`;
      if (Number.isInteger(v)) return `${key}=${v}i`;
      return `${key}=${v}`;
    })
    .join(',');
  const measurement = escapeTagValue(point.measurement);
  return tagPart === ''
    ? `${measurement} ${fieldPart} ${point.timestampNs}`
    : `${measurement},${tagPart} ${fieldPart} ${point.timestampNs}`;
};

// ---------------------------------------------------------------------------
// Line protocol — parse
// ---------------------------------------------------------------------------

export interface LinePoint {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, string | number | boolean>;
  timestampNs: string;
}

const splitUnescaped = (s: string, sep: string): string[] => {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && s[i + 1] !== undefined) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (s[i] === sep) {
      out.push(buf);
      buf = '';
      i += 1;
      continue;
    }
    buf += s[i];
    i += 1;
  }
  out.push(buf);
  return out;
};

/** Parse one line of line protocol into a {@link LinePoint}. */
export const parseLineProtocolPoint = (line: string): LinePoint => {
  // Find the unescaped space after the tag block, then the unescaped
  // space after the field block.
  let depth = 0;
  let measAndTagsEnd = -1;
  let fieldsEnd = -1;
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"' && depth === 1) inQuote = !inQuote;
    if (ch === ' ' && !inQuote) {
      if (measAndTagsEnd === -1) {
        measAndTagsEnd = i;
        depth = 1;
      } else if (fieldsEnd === -1) {
        fieldsEnd = i;
        break;
      }
    }
  }
  if (measAndTagsEnd === -1 || fieldsEnd === -1) {
    throw new Error(`Invalid line protocol: ${line}`);
  }
  const measAndTags = line.slice(0, measAndTagsEnd);
  const fields = line.slice(measAndTagsEnd + 1, fieldsEnd);
  const timestamp = line.slice(fieldsEnd + 1);

  const tagParts = splitUnescaped(measAndTags, ',');
  const measurement = tagParts[0]!;
  const tags: Record<string, string> = {};
  for (let i = 1; i < tagParts.length; i += 1) {
    const [k, v] = splitUnescaped(tagParts[i]!, '=');
    if (k !== undefined && v !== undefined) tags[k] = v;
  }

  const fieldsMap: Record<string, string | number | boolean> = {};
  // Parse field assignments, respecting quoted string values.
  let pos = 0;
  while (pos < fields.length) {
    const eq = fields.indexOf('=', pos);
    if (eq === -1) break;
    const key = fields.slice(pos, eq);
    pos = eq + 1;
    let value: string | number | boolean;
    if (fields[pos] === '"') {
      pos += 1;
      let str = '';
      while (pos < fields.length && fields[pos] !== '"') {
        if (fields[pos] === '\\' && fields[pos + 1] !== undefined) {
          str += fields[pos + 1];
          pos += 2;
        } else {
          str += fields[pos];
          pos += 1;
        }
      }
      pos += 1; // closing quote
      value = str;
    } else {
      let raw = '';
      while (pos < fields.length && fields[pos] !== ',') {
        raw += fields[pos];
        pos += 1;
      }
      if (raw === 't' || raw === 'T' || raw === 'true') value = true;
      else if (raw === 'f' || raw === 'F' || raw === 'false') value = false;
      else if (raw.endsWith('i')) value = parseInt(raw.slice(0, -1), 10);
      else value = parseFloat(raw);
    }
    fieldsMap[key] = value;
    if (fields[pos] === ',') pos += 1;
  }

  return { measurement, tags, fields: fieldsMap, timestampNs: timestamp };
};

// ---------------------------------------------------------------------------
// Annotated CSV — parse
// ---------------------------------------------------------------------------

/**
 * Parse InfluxDB's annotated-CSV response into an array of data rows.
 * Annotation rows (lines starting with `#`) are processed for type info
 * but not surfaced. Each data row maps column name → string value.
 */
export const parseAnnotatedCsv = (text: string): Array<Record<string, string>> => {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  let header: string[] | null = null;
  const rows: Array<Record<string, string>> = [];

  for (const line of lines) {
    if (line.startsWith('#')) continue; // annotation row — skip
    const cells = parseCsvRow(line);
    if (header === null) {
      header = cells;
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) {
      const colName = header[i]!;
      if (colName === '' || colName === 'result' || colName === 'table') continue;
      row[colName] = cells[i] ?? '';
    }
    rows.push(row);
  }
  return rows;
};

/** Parse one CSV row, honouring `""` escape inside quoted strings. */
const parseCsvRow = (line: string): string[] => {
  const cells: string[] = [];
  let pos = 0;
  while (pos < line.length) {
    if (line[pos] === '"') {
      pos += 1;
      let str = '';
      while (pos < line.length) {
        if (line[pos] === '"' && line[pos + 1] === '"') {
          str += '"';
          pos += 2;
        } else if (line[pos] === '"') {
          pos += 1;
          break;
        } else {
          str += line[pos];
          pos += 1;
        }
      }
      cells.push(str);
    } else {
      let raw = '';
      while (pos < line.length && line[pos] !== ',') {
        raw += line[pos];
        pos += 1;
      }
      cells.push(raw);
    }
    if (line[pos] === ',') pos += 1;
  }
  return cells;
};

// ---------------------------------------------------------------------------
// Annotated CSV — serialize (for the test mock)
// ---------------------------------------------------------------------------

/**
 * Serialize an array of column-keyed records to InfluxDB's annotated-CSV
 * format. Used by the test mock; production code only consumes CSV.
 */
/** Quote a CSV cell value if it contains commas, double-quotes, or newlines. */
const quoteCsvCell = (value: string): string => {
  if (!/[,"\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
};

export const serializeAnnotatedCsv = (
  columns: ReadonlyArray<{ name: string, datatype: string }>,
  rows: ReadonlyArray<Record<string, string>>,
): string => {
  const cols = ['', 'result', 'table', ...columns.map(c => c.name)];
  const datatypeRow = ['#datatype', 'string', 'long', ...columns.map(c => c.datatype)];
  const groupRow = ['#group', 'false', 'false', ...columns.map(() => 'false')];
  const defaultRow = ['#default', '_result', '', ...columns.map(() => '')];

  const lines = [
    datatypeRow.join(','),
    groupRow.join(','),
    defaultRow.join(','),
    cols.join(','),
  ];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const cells = ['', '_result', String(i), ...columns.map(c => quoteCsvCell(row[c.name] ?? ''))];
    lines.push(cells.join(','));
  }
  return lines.join('\r\n') + '\r\n';
};
