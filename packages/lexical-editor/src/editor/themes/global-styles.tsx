import { css, Global } from '@emotion/react';
import type { ReactNode } from 'react';

/**
 * Design tokens + editor content styles.
 *
 * The shadcn-editor relied on Tailwind's design tokens and a `.css` file. Here
 * those are provided as emotion global styles: a set of CSS custom properties
 * (light + `.dark`) and the editor's structural CSS (code blocks, tables,
 * syntax-highlight token colours, collapsible containers).
 */
const globalStyles = css`
  :root {
    --background: #ffffff;
    --foreground: #020817;
    --card: #ffffff;
    --card-foreground: #020817;
    --popover: #ffffff;
    --popover-foreground: #020817;
    --primary: #0f172a;
    --primary-foreground: #f8fafc;
    --secondary: #f1f5f9;
    --secondary-foreground: #0f172a;
    --muted: #f1f5f9;
    --muted-foreground: #64748b;
    --accent: #f1f5f9;
    --accent-foreground: #0f172a;
    --destructive: #ef4444;
    --destructive-foreground: #f8fafc;
    --border: #e2e8f0;
    --input: #e2e8f0;
    --ring: #0f172a;
    --radius: 0.5rem;
  }

  .dark {
    --background: #020817;
    --foreground: #f8fafc;
    --card: #020817;
    --card-foreground: #f8fafc;
    --popover: #020817;
    --popover-foreground: #f8fafc;
    --primary: #f8fafc;
    --primary-foreground: #0f172a;
    --secondary: #1e293b;
    --secondary-foreground: #f8fafc;
    --muted: #1e293b;
    --muted-foreground: #94a3b8;
    --accent: #1e293b;
    --accent-foreground: #f8fafc;
    --destructive: #7f1d1d;
    --destructive-foreground: #f8fafc;
    --border: #1e293b;
    --input: #1e293b;
    --ring: #cbd5e1;
  }

  .EditorTheme__code {
    background-color: transparent;
    font-family: Menlo, Consolas, Monaco, monospace;
    display: block;
    padding: 8px 8px 8px 52px;
    line-height: 1.53;
    font-size: 13px;
    margin: 8px 0;
    overflow-x: auto;
    border: 1px solid #ccc;
    position: relative;
    border-radius: 8px;
    tab-size: 2;
  }
  .EditorTheme__code:before {
    content: attr(data-gutter);
    position: absolute;
    background-color: transparent;
    border-right: 1px solid #ccc;
    left: 0;
    top: 0;
    padding: 8px;
    color: #777;
    white-space: pre-wrap;
    text-align: right;
    min-width: 25px;
  }
  .EditorTheme__table {
    border-collapse: collapse;
    border-spacing: 0;
    overflow-y: scroll;
    overflow-x: scroll;
    table-layout: fixed;
    width: 100%;
    margin: 0 0 30px 0;
  }
  .EditorTheme__tokenComment {
    color: slategray;
  }
  .EditorTheme__tokenPunctuation {
    color: #999;
  }
  .EditorTheme__tokenProperty {
    color: #905;
  }
  .EditorTheme__tokenSelector {
    color: #690;
  }
  .EditorTheme__tokenOperator {
    color: #9a6e3a;
  }
  .EditorTheme__tokenAttr {
    color: #07a;
  }
  .EditorTheme__tokenVariable {
    color: #e90;
  }
  .EditorTheme__tokenFunction {
    color: #dd4a68;
  }

  .Collapsible__container {
    background-color: var(--background);
    border: 1px solid #ccc;
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .Collapsible__title {
    padding: 0.25rem 0.25rem 0.25rem 1rem;
    position: relative;
    font-weight: bold;
    outline: none;
    cursor: pointer;
    list-style-type: disclosure-closed;
    list-style-position: inside;
  }
  .Collapsible__title p {
    display: inline-flex;
  }
  .Collapsible__title::marker {
    color: lightgray;
  }
  .Collapsible__container[open] > .Collapsible__title {
    list-style-type: disclosure-open;
  }
`;

/** Injects the editor's global design tokens and content styles. */
export function EditorGlobalStyles(): ReactNode {
  return <Global styles={globalStyles} />;
}
