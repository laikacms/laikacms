import { css } from '@emotion/css';
import type { EditorThemeClasses } from 'lexical';

/**
 * The editor theme, ported from shadcn-editor's Tailwind-based theme to emotion.
 *
 * Lexical's `EditorThemeClasses` expects CSS class-name strings, so each entry
 * uses `@emotion/css`'s `css()` (which returns a generated class name). Entries
 * that reference structural CSS defined in `global-styles.tsx` keep their
 * `EditorTheme__*` literal class and append the emotion class.
 */

/** A focus ring matching shadcn's `ring-2 ring-primary ring-offset-2`. */
const RING = '0 0 0 2px var(--background), 0 0 0 4px var(--primary)';

/** Combine a literal class name with a generated emotion class. */
function cx(literal: string, generated: string): string {
  return `${literal} ${generated}`;
}

export const editorTheme: EditorThemeClasses = {
  ltr: css`
    text-align: left;
  `,
  rtl: css`
    text-align: right;
  `,
  heading: {
    h1: css`
      scroll-margin: 5rem;
      font-size: 2.25rem;
      line-height: 2.5rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      @media (min-width: 1024px) {
        font-size: 3rem;
        line-height: 1;
      }
    `,
    h2: css`
      scroll-margin: 5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
      font-size: 1.875rem;
      line-height: 2.25rem;
      font-weight: 600;
      letter-spacing: -0.025em;
      &:first-child {
        margin-top: 0;
      }
    `,
    h3: css`
      scroll-margin: 5rem;
      font-size: 1.5rem;
      line-height: 2rem;
      font-weight: 600;
      letter-spacing: -0.025em;
    `,
    h4: css`
      scroll-margin: 5rem;
      font-size: 1.25rem;
      line-height: 1.75rem;
      font-weight: 600;
      letter-spacing: -0.025em;
    `,
    h5: css`
      scroll-margin: 5rem;
      font-size: 1.125rem;
      line-height: 1.75rem;
      font-weight: 600;
      letter-spacing: -0.025em;
    `,
    h6: css`
      scroll-margin: 5rem;
      font-size: 1rem;
      line-height: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.025em;
    `,
  },
  paragraph: css`
    line-height: 1.75rem;
    &:not(:first-child) {
      margin-top: 1.5rem;
    }
  `,
  quote: css`
    margin-top: 1.5rem;
    border-left: 2px solid var(--border);
    padding-left: 1.5rem;
    font-style: italic;
  `,
  link: css`
    color: #2563eb;
    &:hover {
      text-decoration: underline;
      cursor: pointer;
    }
  `,
  list: {
    checklist: css`
      position: relative;
    `,
    listitem: css`
      margin: 0 2rem;
    `,
    listitemChecked: css`
      position: relative;
      margin: 0 0.5rem;
      padding: 0 1.5rem;
      list-style: none;
      outline: none;
      text-decoration: line-through;
      &::before {
        content: '';
        width: 1rem;
        height: 1rem;
        top: 0.125rem;
        left: 0;
        cursor: pointer;
        display: block;
        background-size: cover;
        position: absolute;
        border: 1px solid var(--primary);
        border-radius: 0.25rem;
        background-color: var(--primary);
        background-repeat: no-repeat;
      }
      &::after {
        content: '';
        cursor: pointer;
        border-color: #fff;
        border-style: solid;
        position: absolute;
        display: block;
        top: 6px;
        width: 3px;
        left: 7px;
        right: 7px;
        height: 6px;
        transform: rotate(45deg);
        border-width: 0 2px 2px 0;
      }
    `,
    listitemUnchecked: css`
      position: relative;
      margin: 0 0.5rem;
      padding: 0 1.5rem;
      list-style: none;
      outline: none;
      &::before {
        content: '';
        width: 1rem;
        height: 1rem;
        top: 0.125rem;
        left: 0;
        cursor: pointer;
        display: block;
        background-size: cover;
        position: absolute;
        border: 1px solid var(--primary);
        border-radius: 0.25rem;
      }
    `,
    nested: {
      listitem: css`
        list-style: none;
        &::before,
        &::after {
          display: none;
        }
      `,
    },
    ol: css`
      margin: 0;
      padding: 0;
      list-style-type: decimal;
      & > li {
        margin-top: 0.5rem;
      }
    `,
    olDepth: [
      css`
        list-style-position: outside;
        list-style-type: decimal !important;
      `,
      css`
        list-style-position: outside;
        list-style-type: upper-roman !important;
      `,
      css`
        list-style-position: outside;
        list-style-type: lower-roman !important;
      `,
      css`
        list-style-position: outside;
        list-style-type: upper-alpha !important;
      `,
      css`
        list-style-position: outside;
        list-style-type: lower-alpha !important;
      `,
    ],
    ul: css`
      margin: 0;
      padding: 0;
      list-style-position: outside;
      & > li {
        margin-top: 0.5rem;
      }
    `,
    ulDepth: [
      css`
        list-style-position: outside;
        list-style-type: disc !important;
      `,
      css`
        list-style-position: outside;
        list-style-type: disc !important;
      `,
      css`
        list-style-position: outside;
        list-style-type: disc !important;
      `,
      css`
        list-style-position: outside;
        list-style-type: disc !important;
      `,
      css`
        list-style-position: outside;
        list-style-type: disc !important;
      `,
    ],
  },
  hashtag: css`
    color: #2563eb;
    background-color: #dbeafe;
    border-radius: 0.375rem;
    padding: 0 0.25rem;
  `,
  text: {
    bold: css`
      font-weight: 700;
    `,
    code: css`
      background-color: #f3f4f6;
      padding: 0.25rem;
      border-radius: 0.375rem;
    `,
    italic: css`
      font-style: italic;
    `,
    strikethrough: css`
      text-decoration: line-through;
    `,
    subscript: css`
      vertical-align: sub;
      font-size: smaller;
    `,
    superscript: css`
      vertical-align: super;
      font-size: smaller;
    `,
    underline: css`
      text-decoration: underline;
    `,
    underlineStrikethrough: css`
      text-decoration: underline line-through;
    `,
  },
  image: cx(
    'editor-image',
    css`
      position: relative;
      display: inline-block;
      user-select: none;
      cursor: default;
    `,
  ),
  inlineImage: cx(
    'inline-editor-image',
    css`
      position: relative;
      display: inline-block;
      user-select: none;
      cursor: default;
    `,
  ),
  keyword: css`
    color: #581c87;
    font-weight: 700;
  `,
  code: 'EditorTheme__code',
  codeHighlight: {
    atrule: 'EditorTheme__tokenAttr',
    attr: 'EditorTheme__tokenAttr',
    boolean: 'EditorTheme__tokenProperty',
    builtin: 'EditorTheme__tokenSelector',
    cdata: 'EditorTheme__tokenComment',
    char: 'EditorTheme__tokenSelector',
    class: 'EditorTheme__tokenFunction',
    'class-name': 'EditorTheme__tokenFunction',
    comment: 'EditorTheme__tokenComment',
    constant: 'EditorTheme__tokenProperty',
    deleted: 'EditorTheme__tokenProperty',
    doctype: 'EditorTheme__tokenComment',
    entity: 'EditorTheme__tokenOperator',
    function: 'EditorTheme__tokenFunction',
    important: 'EditorTheme__tokenVariable',
    inserted: 'EditorTheme__tokenSelector',
    keyword: 'EditorTheme__tokenAttr',
    namespace: 'EditorTheme__tokenVariable',
    number: 'EditorTheme__tokenProperty',
    operator: 'EditorTheme__tokenOperator',
    prolog: 'EditorTheme__tokenComment',
    property: 'EditorTheme__tokenProperty',
    punctuation: 'EditorTheme__tokenPunctuation',
    regex: 'EditorTheme__tokenVariable',
    selector: 'EditorTheme__tokenSelector',
    string: 'EditorTheme__tokenSelector',
    symbol: 'EditorTheme__tokenProperty',
    tag: 'EditorTheme__tokenProperty',
    url: 'EditorTheme__tokenOperator',
    variable: 'EditorTheme__tokenVariable',
  },
  characterLimit: css`
    background-color: color-mix(in srgb, var(--destructive), transparent 50%) !important;
  `,
  table: cx(
    'EditorTheme__table',
    css`
      width: fit-content;
      overflow: scroll;
      border-collapse: collapse;
    `,
  ),
  tableCell: cx(
    'EditorTheme__tableCell',
    css`
      width: 6rem;
      position: relative;
      border: 1px solid var(--border);
      padding: 0.5rem 1rem;
      text-align: left;
      &[align='center'] {
        text-align: center;
      }
      &[align='right'] {
        text-align: right;
      }
    `,
  ),
  tableCellActionButton: cx(
    'EditorTheme__tableCellActionButton',
    css`
      background-color: var(--background);
      display: block;
      border: 0;
      border-radius: 1rem;
      width: 1.25rem;
      height: 1.25rem;
      color: var(--foreground);
      cursor: pointer;
    `,
  ),
  tableCellActionButtonContainer: cx(
    'EditorTheme__tableCellActionButtonContainer',
    css`
      display: block;
      right: 0.25rem;
      top: 0.375rem;
      position: absolute;
      z-index: 10;
      width: 1.25rem;
      height: 1.25rem;
    `,
  ),
  tableCellEditing: cx(
    'EditorTheme__tableCellEditing',
    css`
      border-radius: 0.125rem;
      box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    `,
  ),
  tableCellHeader: cx(
    'EditorTheme__tableCellHeader',
    css`
      background-color: var(--muted);
      border: 1px solid var(--border);
      padding: 0.5rem 1rem;
      text-align: left;
      font-weight: 700;
      &[align='center'] {
        text-align: center;
      }
      &[align='right'] {
        text-align: right;
      }
    `,
  ),
  tableCellPrimarySelected: cx(
    'EditorTheme__tableCellPrimarySelected',
    css`
      border: 1px solid var(--primary);
      display: block;
      height: calc(100% - 2px);
      width: calc(100% - 2px);
      position: absolute;
      left: -1px;
      top: -1px;
      z-index: 10;
    `,
  ),
  tableCellResizer: cx(
    'EditorTheme__tableCellResizer',
    css`
      position: absolute;
      right: -0.25rem;
      height: 100%;
      width: 0.5rem;
      cursor: ew-resize;
      z-index: 10;
      top: 0;
    `,
  ),
  tableCellSelected: cx(
    'EditorTheme__tableCellSelected',
    css`
      background-color: var(--muted);
    `,
  ),
  tableCellSortedIndicator: cx(
    'EditorTheme__tableCellSortedIndicator',
    css`
      display: block;
      opacity: 0.5;
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 0.25rem;
      background-color: var(--muted);
    `,
  ),
  tableResizeRuler: cx(
    'EditorTheme__tableCellResizeRuler',
    css`
      display: block;
      position: absolute;
      width: 1px;
      height: 100%;
      background-color: var(--primary);
      top: 0;
    `,
  ),
  tableRowStriping: cx(
    'EditorTheme__tableRowStriping',
    css`
      margin: 0;
      border-top: 1px solid var(--border);
      padding: 0;
      &:nth-of-type(even) {
        background-color: var(--muted);
      }
    `,
  ),
  tableSelected: cx(
    'EditorTheme__tableSelected',
    css`
      box-shadow: ${RING};
    `,
  ),
  tableSelection: cx(
    'EditorTheme__tableSelection',
    css`
      background-color: transparent;
    `,
  ),
  layoutItem: css`
    border: 1px dashed var(--border);
    padding: 0.5rem 1rem;
  `,
  layoutContainer: css`
    display: grid;
    gap: 0.625rem;
    margin: 0.625rem 0;
  `,
  autocomplete: css`
    color: var(--muted-foreground);
  `,
  blockCursor: '',
  embedBlock: {
    base: css`
      user-select: none;
    `,
    focus: css`
      box-shadow: ${RING};
    `,
  },
  hr: css`
    padding: 0.125rem;
    border: none;
    margin: 0.25rem 0;
    cursor: pointer;
    &::after {
      content: '';
      display: block;
      height: 0.125rem;
      background-color: var(--muted);
    }
    &.selected {
      box-shadow: ${RING};
      user-select: none;
    }
  `,
  indent: css`
    --lexical-indent-base-value: 40px;
  `,
  mark: '',
  markOverlap: '',
};
