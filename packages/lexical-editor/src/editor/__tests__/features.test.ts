import { describe, expect, it } from 'vitest';

import { DEFAULT_EDITOR_SCHEMA, defineSchema } from '../../core/schema/schema';
import { schemaToEditorFeatures } from '../schema/features';

describe('schemaToEditorFeatures', () => {
  it('enables every content control for the default schema', () => {
    const f = schemaToEditorFeatures(DEFAULT_EDITOR_SCHEMA);

    expect(f.toolbarItems.fontFormat).toBe(true);
    expect(f.toolbarItems.subSuper).toBe(true);
    expect(f.toolbarItems.link).toBe(true);
    expect(f.blockFormatItems.blockquote).toBe(true);
    expect(f.blockFormatItems.codeBlock).toBe(true);
    expect(f.blockFormatItems.bulletList).toBe(true);
    expect(f.blockFormatItems.checkList).toBe(true);
    expect(f.blockInsertItems.table).toBe(true);
    expect(f.blockInsertItems.image).toBe(true);
    expect(f.blockInsertItems.embeds).toBe(true);
    expect(f.componentPickerItems.dateTime).toBe(true);
    expect(f.pluginItems.floatingLinkToolbar).toBe(true);
  });

  it('restricts controls to the schema vocabulary', () => {
    const f = schemaToEditorFeatures(
      defineSchema({
        decorators: [{ name: 'strong' }, { name: 'em' }],
        styles: [{ name: 'normal' }, { name: 'h1' }],
        lists: [{ name: 'bullet' }],
        annotations: [],
        blockObjects: [],
        inlineObjects: [],
      }),
    );

    // Allowed content
    expect(f.toolbarItems.fontFormat).toBe(true);
    expect(f.blockFormatItems.paragraph).toBe(true);
    expect(f.blockFormatItems.h1).toBe(true);
    expect(f.blockFormatItems.bulletList).toBe(true);

    // Disallowed content
    expect(f.toolbarItems.subSuper).toBe(false);
    expect(f.toolbarItems.link).toBe(false);
    expect(f.pluginItems.floatingLinkToolbar).toBe(false);
    expect(f.blockFormatItems.h2).toBe(false);
    expect(f.blockFormatItems.blockquote).toBe(false);
    expect(f.blockFormatItems.codeBlock).toBe(false);
    expect(f.blockFormatItems.numberList).toBe(false);
    expect(f.blockInsertItems.table).toBe(false);
    expect(f.blockInsertItems.image).toBe(false);
    expect(f.toolbarItems.blockInsert).toBe(false);
    expect(f.componentPickerItems.table).toBe(false);
    expect(f.componentPickerItems.dateTime).toBe(false);
  });

  it('keeps cosmetic/UX affordances on regardless of schema', () => {
    const f = schemaToEditorFeatures(
      defineSchema({
        decorators: [],
        styles: [{ name: 'normal' }],
        lists: [],
        annotations: [],
        blockObjects: [],
        inlineObjects: [],
      }),
    );
    expect(f.toolbarItems.fontFamily).toBe(true);
    expect(f.toolbarItems.fontAlignment).toBe(true);
    expect(f.pluginItems.draggableBlock).toBe(true);
    expect(f.footerItems.characterCount).toBe(true);
  });
});
