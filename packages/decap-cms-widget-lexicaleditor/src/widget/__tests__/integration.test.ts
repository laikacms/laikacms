// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import {
  createLexicalRichtextValue as createRichtextValue,
  getFormat,
  hasFormat,
  LexicalRichtextValue as RichtextValue,
} from 'decap-cms-lexical-core';

import {
  ensureDefaultFormatsRegistered,
  LexicalControl,
  lexicalEditorWidgetSchema,
  LexicalPreview,
  passthroughSerializer,
  Widget,
} from '../index';

ensureDefaultFormatsRegistered();

describe('widget format registration', () => {
  it('registers the four built-in formats on import', () => {
    expect(hasFormat('markdown')).toBe(true);
    expect(hasFormat('html')).toBe(true);
    expect(hasFormat('portabletext')).toBe(true);
    expect(hasFormat('contentful-rtf')).toBe(true);
  });

  it('exposes the same format instances via getFormat', () => {
    expect(getFormat('markdown').id).toBe('markdown');
    expect(getFormat('html').id).toBe('html');
  });
});

describe('Widget()', () => {
  it('returns the Decap definition shape', () => {
    const widget = Widget();
    expect(widget.name).toBe('lexicaleditor');
    expect(widget.controlComponent).toBe(LexicalControl);
    expect(widget.previewComponent).toBe(LexicalPreview);
    expect(widget.schema).toBe(lexicalEditorWidgetSchema);
  });
});

describe('passthroughSerializer', () => {
  it('returns the same value back', () => {
    const v = { a: 1 };
    expect(passthroughSerializer.serialize(v)).toBe(v);
    expect(passthroughSerializer.deserialize(v)).toBe(v);
  });
});

describe('RichtextValue end-to-end with real formats', () => {
  it('detects markdown input and round-trips via toString', () => {
    const value = createRichtextValue('# Hello\n\nWorld', { hint: 'markdown' });
    expect(value.inputFormat).toBe('markdown');
    expect(value.outputFormat).toBe('markdown');
    const out = value.toString();
    expect(out).toContain('# Hello');
    expect(out).toContain('World');
  });

  it('respects field.format as the output format target', () => {
    const md = '# Hello';
    const value = createRichtextValue(md, { hint: 'html', outputFormat: 'html' });
    expect(value.outputFormat).toBe('html');
    expect(value.toString()).toContain('<h1>');
  });

  it('keeps the same proxy identity across editorState changes', () => {
    const value = createRichtextValue('# Hi', { hint: 'markdown' });
    const ref = value;
    value.setEditorState({ ...value.editorState });
    expect(value).toBe(ref);
  });
});
