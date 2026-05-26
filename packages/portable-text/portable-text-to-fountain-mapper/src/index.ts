import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Fountain screenplay <-> Portable Text.
 *
 * Fountain is the plaintext markup for screenplays (https://fountain.io). We
 * model the screenplay block types as custom Portable Text blocks so they
 * round-trip cleanly and can be styled distinctly in the editor:
 *
 *   - `fountain:scene`         scene heading (e.g. `INT. KITCHEN - DAY`)
 *   - `fountain:character`     dialogue speaker name (ALL CAPS line)
 *   - `fountain:dialogue`      a character's line of dialogue
 *   - `fountain:parenthetical` `(beat)` line under a character
 *   - `fountain:transition`    `CUT TO:` style transitions
 *   - block `style: 'h1'..'h6'` for `#`, `##`, ... section headers
 *   - block `style: 'normal'`   action paragraphs
 *   - `hr` block               for `===` page breaks
 *
 * Inline emphasis: `**bold**`, `*italic*`, `***both***`, `_underline_`.
 *
 * Title pages, lyrics, notes (`[[…]]`), boneyard (`/* … * /`), centered text
 * (`> … <`), and synopses (`= …`) are intentionally out of scope for the
 * initial cut.
 */

interface Keys {
  block: () => string;
  span: () => string;
  mark: () => string;
}

function newKeys(): Keys {
  return {
    block: createKeyGenerator('b'),
    span: createKeyGenerator('s'),
    mark: createKeyGenerator('m'),
  };
}

// --- Inline emphasis ------------------------------------------------------

interface InlineToken {
  text: string;
  decorators: string[];
}

function parseInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let buf = '';
  const stack: string[] = [];
  const flushBuf = (): void => {
    if (buf.length) {
      tokens.push({ text: buf, decorators: [...stack] });
      buf = '';
    }
  };

  while (i < input.length) {
    // `***bolditalic***`
    if (input.startsWith('***', i)) {
      const end = input.indexOf('***', i + 3);
      if (end !== -1 && end > i + 3) {
        flushBuf();
        const inner = parseInline(input.slice(i + 3, end));
        for (const t of inner) {
          tokens.push({
            text: t.text,
            decorators: [...stack, 'strong', 'em', ...t.decorators],
          });
        }
        i = end + 3;
        continue;
      }
    }
    // `**bold**`
    if (input.startsWith('**', i)) {
      const end = input.indexOf('**', i + 2);
      if (end !== -1 && end > i + 2) {
        flushBuf();
        const inner = parseInline(input.slice(i + 2, end));
        for (const t of inner) {
          tokens.push({ text: t.text, decorators: [...stack, 'strong', ...t.decorators] });
        }
        i = end + 2;
        continue;
      }
    }
    // `*italic*` — must not match opening `*` followed by space.
    if (input[i] === '*' && input[i + 1] !== ' ' && input[i + 1] !== '*') {
      const end = input.indexOf('*', i + 1);
      if (end !== -1 && input[end - 1] !== ' ' && input[end - 1] !== '*') {
        flushBuf();
        const inner = parseInline(input.slice(i + 1, end));
        for (const t of inner) {
          tokens.push({ text: t.text, decorators: [...stack, 'em', ...t.decorators] });
        }
        i = end + 1;
        continue;
      }
    }
    // `_underline_`
    if (input[i] === '_') {
      const end = input.indexOf('_', i + 1);
      if (end !== -1 && end > i + 1) {
        flushBuf();
        const inner = parseInline(input.slice(i + 1, end));
        for (const t of inner) {
          tokens.push({ text: t.text, decorators: [...stack, 'underline', ...t.decorators] });
        }
        i = end + 1;
        continue;
      }
    }
    buf += input[i];
    i += 1;
  }
  flushBuf();
  return tokens;
}

function tokensToSpans(tokens: InlineToken[], keys: Keys): PortableTextSpan[] {
  return tokens.map(t => ({
    _type: 'span',
    _key: keys.span(),
    text: t.text,
    marks: t.decorators,
  }));
}

// --- Block parser ---------------------------------------------------------

const SCENE_PREFIXES = /^(INT|EXT|EST|I\/E|INT\.\/EXT|EXT\.\/INT)[. ]/i;
const TRANSITION_RE = /^[A-Z0-9 .'-]+TO:\s*$/;
const FORCED_TRANSITION_RE = /^>\s+(.+?)\s*$/;
const FORCED_SCENE_RE = /^\.([^.\n].*)$/;
const SECTION_RE = /^(#{1,6})\s+(.+)$/;
const PAGE_BREAK_RE = /^={3,}\s*$/;
const FORCED_CHARACTER_RE = /^@(.+?)\s*$/;
const PARENTHETICAL_RE = /^\((.+)\)\s*$/;

function isAllCapsLine(line: string): boolean {
  // ALL CAPS + at least one letter + no lowercase. Allows numbers, punctuation,
  // spaces, and parens (for `(CONT'D)`).
  if (!/[A-Z]/.test(line)) return false;
  if (/[a-z]/.test(line)) return false;
  if (!/^[A-Z0-9 .,'()\-/&!?]+$/.test(line)) return false;
  return true;
}

function pushSpanBlock(
  type: string,
  text: string,
  keys: Keys,
  out: PortableTextDocument,
): void {
  out.push({
    _type: type,
    _key: keys.block(),
    children: tokensToSpans(parseInline(text), keys),
  } as unknown as PortableTextBlock);
}

export function fountainToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  // Strip boneyard `/* ... */` content.
  const cleaned = input.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = cleaned.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Page break.
    if (PAGE_BREAK_RE.test(line)) {
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      i += 1;
      continue;
    }

    // Section header.
    const section = SECTION_RE.exec(line);
    if (section) {
      const level = section[1]!.length;
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: `h${level}`,
        markDefs: [],
        children: tokensToSpans(parseInline(section[2]!), keys),
      } as PortableTextBlock);
      i += 1;
      continue;
    }

    // Forced scene heading (line starts with `.` then a non-dot character).
    const forcedScene = FORCED_SCENE_RE.exec(line);
    if (forcedScene) {
      pushSpanBlock('fountain:scene', forcedScene[1]!, keys, out);
      i += 1;
      continue;
    }

    // Scene heading by prefix.
    if (SCENE_PREFIXES.test(line)) {
      pushSpanBlock('fountain:scene', line.trim(), keys, out);
      i += 1;
      continue;
    }

    // Forced transition.
    const forcedTrans = FORCED_TRANSITION_RE.exec(line);
    if (forcedTrans) {
      pushSpanBlock('fountain:transition', forcedTrans[1]!, keys, out);
      i += 1;
      continue;
    }

    // Transition by convention: ALL CAPS line ending in `TO:`, surrounded by
    // blank lines (Fountain requires blank lines on either side).
    if (
      TRANSITION_RE.test(line)
      && (i === 0 || lines[i - 1]!.trim() === '')
      && (i + 1 >= lines.length || lines[i + 1]!.trim() === '')
    ) {
      pushSpanBlock('fountain:transition', line.trim(), keys, out);
      i += 1;
      continue;
    }

    // Forced character `@Name`.
    const forcedChar = FORCED_CHARACTER_RE.exec(line);
    if (forcedChar && i + 1 < lines.length && lines[i + 1]!.trim() !== '') {
      pushSpanBlock('fountain:character', forcedChar[1]!.trim(), keys, out);
      i += 1;
      while (i < lines.length && lines[i]!.trim() !== '') {
        const sub = lines[i]!;
        const paren = PARENTHETICAL_RE.exec(sub);
        if (paren) {
          pushSpanBlock('fountain:parenthetical', `(${paren[1]})`, keys, out);
        } else {
          pushSpanBlock('fountain:dialogue', sub, keys, out);
        }
        i += 1;
      }
      continue;
    }

    // Character + dialogue: an ALL CAPS line, followed by at least one
    // non-blank line on the next line.
    if (
      isAllCapsLine(line)
      && (i === 0 || lines[i - 1]!.trim() === '')
      && i + 1 < lines.length
      && lines[i + 1]!.trim() !== ''
    ) {
      pushSpanBlock('fountain:character', line.trim(), keys, out);
      i += 1;
      while (i < lines.length && lines[i]!.trim() !== '') {
        const sub = lines[i]!;
        const paren = PARENTHETICAL_RE.exec(sub);
        if (paren) {
          pushSpanBlock('fountain:parenthetical', `(${paren[1]})`, keys, out);
        } else {
          pushSpanBlock('fountain:dialogue', sub, keys, out);
        }
        i += 1;
      }
      continue;
    }

    // Default: action paragraph (collect consecutive non-blank lines).
    const paraLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() !== '') {
      paraLines.push(lines[j]!);
      j += 1;
    }
    out.push({
      _type: 'block',
      _key: keys.block(),
      style: 'normal',
      markDefs: [],
      children: tokensToSpans(parseInline(paraLines.join('\n')), keys),
    } as PortableTextBlock);
    i = j;
  }

  return out;
}

// --- PT -> Fountain -------------------------------------------------------

function spansToFountain(spans: PortableTextSpan[]): string {
  return spans
    .map(s => {
      const marks = new Set(s.marks ?? []);
      let text = s.text;
      // Apply strongest emphasis first so nested wrappers compose cleanly.
      const bold = marks.has('strong');
      const italic = marks.has('em');
      const underline = marks.has('underline');
      if (bold && italic) text = `***${text}***`;
      else if (bold) text = `**${text}**`;
      else if (italic) text = `*${text}*`;
      if (underline) text = `_${text}_`;
      return text;
    })
    .join('');
}

function blockChildrenToText(block: PortableTextBlock): string {
  return spansToFountain((block.children ?? []) as PortableTextSpan[]);
}

export function portableTextToFountain(doc: PortableTextDocument): string {
  const out: string[] = [];
  for (let idx = 0; idx < doc.length; idx += 1) {
    const block = doc[idx]!;
    const t = (block as { _type?: string })._type;
    const prev = doc[idx - 1] as { _type?: string } | undefined;
    const next = doc[idx + 1] as { _type?: string } | undefined;

    if (t === 'hr') {
      out.push('===');
      continue;
    }
    if (t === 'fountain:scene') {
      out.push(blockChildrenToText(block as PortableTextBlock));
      continue;
    }
    if (t === 'fountain:transition') {
      out.push(blockChildrenToText(block as PortableTextBlock));
      continue;
    }
    if (t === 'fountain:character') {
      // A character line must be preceded by a blank line; ensure that.
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(blockChildrenToText(block as PortableTextBlock));
      continue;
    }
    if (t === 'fountain:dialogue' || t === 'fountain:parenthetical') {
      out.push(blockChildrenToText(block as PortableTextBlock));
      // End the dialogue block with a blank line if the next block leaves it.
      const nextType = next?._type;
      if (
        nextType !== 'fountain:dialogue'
        && nextType !== 'fountain:parenthetical'
      ) {
        out.push('');
      }
      continue;
    }
    if (t === 'block') {
      const b = block as PortableTextBlock;
      const style = b.style ?? 'normal';
      const headingMatch = /^h([1-6])$/.exec(style);
      if (headingMatch) {
        out.push(`${'#'.repeat(Number(headingMatch[1]))} ${blockChildrenToText(b)}`);
      } else {
        // Surround a transition/scene -> action transition with a blank line so
        // we don't accidentally turn the action into a continuation.
        if (
          prev
          && (prev._type === 'fountain:character' || prev._type === 'fountain:dialogue'
            || prev._type === 'fountain:parenthetical')
        ) {
          if (out.length && out[out.length - 1] !== '') out.push('');
        }
        out.push(blockChildrenToText(b));
      }
      continue;
    }
  }
  return out.join('\n');
}

// --- Format ---------------------------------------------------------------

export const fountainFormat: Format = {
  id: 'fountain',
  label: 'Fountain (screenplay)',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return fountainToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToFountain(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^(INT|EXT|EST|I\/E)[. ]/m.test(value)) hits += 3; // scene heading
    if (/\b[A-Z0-9 ]+TO:\s*$/m.test(value)) hits += 2; // transition
    if (/^\.[A-Z]/m.test(value)) hits += 1; // forced scene
    if (/^={3,}\s*$/m.test(value)) hits += 1; // page break
    return Math.min(1, hits * 0.22);
  },
};

export default fountainFormat;
