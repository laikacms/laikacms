/**
 * Map an {@link EditorSchema} to the boolean feature records the {@link Editor}
 * uses to decide which toolbar / footer / plugin / picker pieces to mount.
 *
 * Two kinds of flags live here:
 *  - **Content-driven** flags map to Portable Text vocabulary (decorators,
 *    styles, lists, the `link` annotation, block objects) and are turned on only
 *    when the schema declares the corresponding type.
 *  - **Cosmetic / UX** flags (font family/size/color, alignment, drag handles,
 *    dev tools, …) have no Portable Text representation, so they default to
 *    `true` to preserve the editor's full-featured authoring chrome.
 *
 * Passing {@link DEFAULT_EDITOR_SCHEMA} reproduces the editor's original
 * "everything enabled" behavior.
 */
import {
  type EditorSchema,
  schemaBlockObjectNames,
  schemaDecoratorNames,
  schemaHasAnnotation,
  schemaListNames,
  schemaStyleNames,
} from '../../core/schema/schema';

export interface ToolbarItems {
  undoRedo: boolean;
  blockFormat: boolean;
  fontFamily: boolean;
  fontSize: boolean;
  fontFormat: boolean;
  subSuper: boolean;
  link: boolean;
  clearFormatting: boolean;
  fontColor: boolean;
  fontBackground: boolean;
  fontAlignment: boolean;
  blockInsert: boolean;
}

export interface FooterItems {
  characterCount: boolean;
  speechToText: boolean;
  shareContent: boolean;
  exportImport: boolean;
  markdownToggle: boolean;
  viewOnly: boolean;
  clearEditor: boolean;
  treeView: boolean;
}

export interface PluginItems {
  draggableBlock: boolean;
  componentPicker: boolean;
  emojiPicker: boolean;
  autoEmbed: boolean;
  mentions: boolean;
  tabFocus: boolean;
  tabIndentation: boolean;
  floatingLinkToolbar: boolean;
  floatingTextToolbar: boolean;
  autoComplete: boolean;
  contextMenu: boolean;
  specialText: boolean;
}

export interface BlockFormatItems {
  paragraph: boolean;
  h1: boolean;
  h2: boolean;
  h3: boolean;
  numberList: boolean;
  bulletList: boolean;
  checkList: boolean;
  codeBlock: boolean;
  blockquote: boolean;
}

export interface BlockInsertItems {
  divider: boolean;
  image: boolean;
  table: boolean;
  columnsLayout: boolean;
  embeds: boolean;
}

export interface ComponentPickerItems {
  paragraph: boolean;
  h1: boolean;
  h2: boolean;
  h3: boolean;
  table: boolean;
  checkList: boolean;
  numberList: boolean;
  bulletList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  divider: boolean;
  tweetEmbed: boolean;
  youtubeEmbed: boolean;
  image: boolean;
  columnsLayout: boolean;
  dateTime: boolean;
  alignLeft: boolean;
  alignCenter: boolean;
  alignRight: boolean;
  alignJustify: boolean;
}

export interface EditorFeatures {
  toolbarItems: ToolbarItems;
  footerItems: FooterItems;
  pluginItems: PluginItems;
  blockFormatItems: BlockFormatItems;
  blockInsertItems: BlockInsertItems;
  componentPickerItems: ComponentPickerItems;
}

const FORMAT_DECORATORS = ['strong', 'em', 'underline', 'strike-through', 'code', 'highlight'];

/** Derive editor feature flags from a schema's allowed vocabulary. */
export function schemaToEditorFeatures(schema: EditorSchema): EditorFeatures {
  const decorators = schemaDecoratorNames(schema);
  const styles = schemaStyleNames(schema);
  const lists = schemaListNames(schema);
  const blocks = schemaBlockObjectNames(schema);
  const hasLink = schemaHasAnnotation(schema, 'link');

  const blockFormatItems: BlockFormatItems = {
    paragraph: styles.has('normal'),
    h1: styles.has('h1'),
    h2: styles.has('h2'),
    h3: styles.has('h3'),
    numberList: lists.has('number'),
    bulletList: lists.has('bullet'),
    checkList: lists.has('check'),
    codeBlock: blocks.has('code'),
    blockquote: styles.has('blockquote'),
  };

  const blockInsertItems: BlockInsertItems = {
    divider: blocks.has('divider'),
    image: blocks.has('image'),
    table: blocks.has('table'),
    columnsLayout: blocks.has('columnsLayout'),
    embeds: blocks.has('tweet') || blocks.has('youtube'),
  };

  const componentPickerItems: ComponentPickerItems = {
    paragraph: styles.has('normal'),
    h1: styles.has('h1'),
    h2: styles.has('h2'),
    h3: styles.has('h3'),
    table: blocks.has('table'),
    checkList: lists.has('check'),
    numberList: lists.has('number'),
    bulletList: lists.has('bullet'),
    blockquote: styles.has('blockquote'),
    codeBlock: blocks.has('code'),
    divider: blocks.has('divider'),
    tweetEmbed: blocks.has('tweet'),
    youtubeEmbed: blocks.has('youtube'),
    image: blocks.has('image'),
    columnsLayout: blocks.has('columnsLayout'),
    dateTime: blocks.has('dateTime'),
    // Alignment is text formatting, not a Portable Text type — always offered.
    alignLeft: true,
    alignCenter: true,
    alignRight: true,
    alignJustify: true,
  };

  const fontFormat = FORMAT_DECORATORS.some(name => decorators.has(name));
  const subSuper = decorators.has('sub') || decorators.has('sup');
  const anyBlockFormat = Object.values(blockFormatItems).some(Boolean);
  const anyBlockInsert = Object.values(blockInsertItems).some(Boolean);
  const anyComponentPicker = Object.values(componentPickerItems).some(Boolean);

  const toolbarItems: ToolbarItems = {
    undoRedo: true,
    blockFormat: anyBlockFormat,
    fontFamily: true,
    fontSize: true,
    fontFormat,
    subSuper,
    link: hasLink,
    clearFormatting: true,
    fontColor: true,
    fontBackground: true,
    fontAlignment: true,
    blockInsert: anyBlockInsert,
  };

  const footerItems: FooterItems = {
    characterCount: true,
    speechToText: true,
    shareContent: true,
    exportImport: true,
    markdownToggle: true,
    viewOnly: true,
    clearEditor: true,
    treeView: true,
  };

  const pluginItems: PluginItems = {
    draggableBlock: true,
    componentPicker: anyComponentPicker,
    emojiPicker: true,
    autoEmbed: blockInsertItems.embeds,
    mentions: true,
    tabFocus: true,
    tabIndentation: true,
    floatingLinkToolbar: hasLink,
    floatingTextToolbar: true,
    autoComplete: true,
    contextMenu: true,
    specialText: true,
  };

  return {
    toolbarItems,
    footerItems,
    pluginItems,
    blockFormatItems,
    blockInsertItems,
    componentPickerItems,
  };
}
