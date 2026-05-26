import { useMemo, useState } from 'react';

import { CodeHighlightNode, CodeNode } from '@lexical/code';
import {
  AutoFocusExtension,
  ClearEditorExtension,
  DecoratorTextExtension,
  HorizontalRuleExtension,
  SelectionAlwaysOnDisplayExtension,
} from '@lexical/extension';
import { HashtagExtension } from '@lexical/hashtag';
import { HistoryExtension } from '@lexical/history';
import { AutoLinkExtension, ClickableLinkExtension, LinkExtension } from '@lexical/link';
import { CheckListExtension, ListExtension } from '@lexical/list';
import {
  CHECK_LIST,
  ELEMENT_TRANSFORMERS,
  MULTILINE_ELEMENT_TRANSFORMERS,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
} from '@lexical/markdown';
import { OverflowNode } from '@lexical/overflow';
import { CharacterLimitPlugin } from '@lexical/react/LexicalCharacterLimitPlugin';
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { RichTextExtension } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { configExtension, defineExtension, type EditorState, type SerializedEditorState } from 'lexical';

import { useBlockViewer } from './_block-viewer-stub';
import { ContentEditable } from './editor-ui/content-editable';
import { DateTimeExtension } from './extensions/date-time-extension';
import { DragDropPasteExtension } from './extensions/drag-drop-paste-extension';
import { EmojisExtension } from './extensions/emojis-extension';
import { ImagesExtension } from './extensions/images-extension';
import { KeywordsExtension } from './extensions/keywords-extension';
import { MarkdownShortcutsExtension } from './extensions/markdown-shortcuts-extension';
import { MaxLengthExtension } from './extensions/max-length-extension';
import { AutocompleteNode } from './nodes/autocomplete-node';
import { TweetNode } from './nodes/embeds/tweet-node';
import { YouTubeNode } from './nodes/embeds/youtube-node';
import { EmojiNode } from './nodes/emoji-node';
import { LayoutContainerNode } from './nodes/layout-container-node';
import { LayoutItemNode } from './nodes/layout-item-node';
import { MentionNode } from './nodes/mention-node';
import { SpecialTextNode } from './nodes/special-text-node';
import { ActionsPlugin } from './plugins/actions/actions-plugin';
import { ClearEditorActionPlugin } from './plugins/actions/clear-editor-plugin';
import { CounterCharacterPlugin } from './plugins/actions/counter-character-plugin';
import { EditModeTogglePlugin } from './plugins/actions/edit-mode-toggle-plugin';
import { ImportExportPlugin } from './plugins/actions/import-export-plugin';
import { MarkdownTogglePlugin } from './plugins/actions/markdown-toggle-plugin';
import { ShareContentPlugin } from './plugins/actions/share-content-plugin';
import { SpeechToTextPlugin } from './plugins/actions/speech-to-text-plugin';
import { TreeViewPlugin } from './plugins/actions/tree-view-plugin';
import { AutoCompletePlugin } from './plugins/auto-complete-plugin';
import { CodeActionMenuPlugin } from './plugins/code-action-menu-plugin';
import { CodeHighlightPlugin } from './plugins/code-highlight-plugin';
import { ComponentPickerMenuPlugin } from './plugins/component-picker-menu-plugin';
import { ContextMenuPlugin } from './plugins/context-menu-plugin';
import { DraggableBlockPlugin } from './plugins/draggable-block-plugin';
import { AutoEmbedPlugin } from './plugins/embeds/auto-embed-plugin';
import { TwitterPlugin } from './plugins/embeds/twitter-plugin';
import { YouTubePlugin } from './plugins/embeds/youtube-plugin';
import { EmojiPickerPlugin } from './plugins/emoji-picker-plugin';
import { FloatingLinkEditorPlugin } from './plugins/floating-link-editor-plugin';
import { FloatingTextFormatToolbarPlugin } from './plugins/floating-text-format-plugin';
import { LayoutPlugin } from './plugins/layout-plugin';
import { MentionsPlugin } from './plugins/mentions-plugin';
import { AlignmentPickerPlugin } from './plugins/picker/alignment-picker-plugin';
import { BulletedListPickerPlugin } from './plugins/picker/bulleted-list-picker-plugin';
import { CheckListPickerPlugin } from './plugins/picker/check-list-picker-plugin';
import { CodePickerPlugin } from './plugins/picker/code-picker-plugin';
import { ColumnsLayoutPickerPlugin } from './plugins/picker/columns-layout-picker-plugin';
import { DateTimePickerPlugin } from './plugins/picker/date-time-picker-plugin';
import { DividerPickerPlugin } from './plugins/picker/divider-picker-plugin';
import { EmbedsPickerPlugin } from './plugins/picker/embeds-picker-plugin';
import { HeadingPickerPlugin } from './plugins/picker/heading-picker-plugin';
import { ImagePickerPlugin } from './plugins/picker/image-picker-plugin';
import { NumberedListPickerPlugin } from './plugins/picker/numbered-list-picker-plugin';
import { ParagraphPickerPlugin } from './plugins/picker/paragraph-picker-plugin';
import { QuotePickerPlugin } from './plugins/picker/quote-picker-plugin';
import { DynamicTablePickerPlugin, TablePickerPlugin } from './plugins/picker/table-picker-plugin';
import { SpecialTextPlugin } from './plugins/special-text-plugin';
import { TabFocusPlugin } from './plugins/tab-focus-plugin';
import { BlockFormatDropDown } from './plugins/toolbar/block-format-toolbar-plugin';
import { FormatBulletedList } from './plugins/toolbar/block-format/format-bulleted-list';
import { FormatCheckList } from './plugins/toolbar/block-format/format-check-list';
import { FormatCodeBlock } from './plugins/toolbar/block-format/format-code-block';
import { FormatHeading } from './plugins/toolbar/block-format/format-heading';
import { FormatNumberedList } from './plugins/toolbar/block-format/format-numbered-list';
import { FormatParagraph } from './plugins/toolbar/block-format/format-paragraph';
import { FormatQuote } from './plugins/toolbar/block-format/format-quote';
import { BlockInsertPlugin } from './plugins/toolbar/block-insert-plugin';
import { InsertColumnsLayout } from './plugins/toolbar/block-insert/insert-columns-layout';
import { InsertEmbeds } from './plugins/toolbar/block-insert/insert-embeds';
import { InsertHorizontalRule } from './plugins/toolbar/block-insert/insert-horizontal-rule';
import { InsertImage } from './plugins/toolbar/block-insert/insert-image';
import { InsertTable } from './plugins/toolbar/block-insert/insert-table';
import { ClearFormattingToolbarPlugin } from './plugins/toolbar/clear-formatting-toolbar-plugin';
import { CodeLanguageToolbarPlugin } from './plugins/toolbar/code-language-toolbar-plugin';
import { ElementFormatToolbarPlugin } from './plugins/toolbar/element-format-toolbar-plugin';
import { FontBackgroundToolbarPlugin } from './plugins/toolbar/font-background-toolbar-plugin';
import { FontColorToolbarPlugin } from './plugins/toolbar/font-color-toolbar-plugin';
import { FontFamilyToolbarPlugin } from './plugins/toolbar/font-family-toolbar-plugin';
import { FontFormatToolbarPlugin } from './plugins/toolbar/font-format-toolbar-plugin';
import { FontSizeToolbarPlugin } from './plugins/toolbar/font-size-toolbar-plugin';
import { HistoryToolbarPlugin } from './plugins/toolbar/history-toolbar-plugin';
import { LinkToolbarPlugin } from './plugins/toolbar/link-toolbar-plugin';
import { SubSuperToolbarPlugin } from './plugins/toolbar/subsuper-toolbar-plugin';
import { ToolbarPlugin } from './plugins/toolbar/toolbar-plugin';
import { TypingPerfPlugin } from './plugins/typing-pref-plugin';
import { editorTheme } from './themes/editor-theme';
import { EMOJI } from './transformers/emoji-transformer';
import { HR } from './transformers/hr-transformer';
import { IMAGE } from './transformers/image-transformer';
import { TABLE } from './transformers/table-transformer';
import { TWEET } from './transformers/tweet-transformer';
import { Separator } from './ui/separator';
import { TooltipProvider } from './ui/tooltip';
import { validateUrl } from './utils/url';

const placeholder = 'Press / for commands...';
const maxLength = 30;

export function Editor({
  editorState,
  editorSerializedState,
  onChange,
  onSerializedChange,
}: {
  editorState?: EditorState,
  editorSerializedState?: SerializedEditorState,
  onChange?: (editorState: EditorState) => void,
  onSerializedChange?: (editorSerializedState: SerializedEditorState) => void,
}) {
  const {
    toolbarItems,
    footerItems,
    pluginItems,
    blockFormatItems,
    blockInsertItems,
    componentPickerItems,
  } = useBlockViewer();

  const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null);
  const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);

  const onRef = (_floatingAnchorElem: HTMLDivElement) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem);
    }
  };

  const AppExtension = useMemo(
    () =>
      defineExtension({
        dependencies: [
          RichTextExtension,
          ImagesExtension,
          HorizontalRuleExtension,
          configExtension(ListExtension, { shouldPreserveNumbering: false }),
          CheckListExtension,
          configExtension(MarkdownShortcutsExtension, {
            transformers: [
              TABLE,
              HR,
              IMAGE,
              EMOJI,
              TWEET,
              CHECK_LIST,
              ...ELEMENT_TRANSFORMERS,
              ...MULTILINE_ELEMENT_TRANSFORMERS,
              ...TEXT_FORMAT_TRANSFORMERS,
              ...TEXT_MATCH_TRANSFORMERS,
            ],
          }),
          AutoFocusExtension,
          ClearEditorExtension,
          DecoratorTextExtension,
          HistoryExtension,
          KeywordsExtension,
          HashtagExtension,
          DateTimeExtension,
          configExtension(MaxLengthExtension, { disabled: false, maxLength }),
          DragDropPasteExtension,
          EmojisExtension,
          configExtension(LinkExtension, {
            validateUrl,
            attributes: {
              rel: 'noopener noreferrer',
              target: '_blank',
            },
          }),
          AutoLinkExtension,
          ClickableLinkExtension,
          SelectionAlwaysOnDisplayExtension,
        ],
        // html: buildHTMLConfig(),
        name: '@shadcn-editor',
        namespace: 'Playground',
        nodes: [
          OverflowNode,
          TableNode,
          TableCellNode,
          TableRowNode,
          CodeNode,
          CodeHighlightNode,
          MentionNode,
          EmojiNode,
          LayoutContainerNode,
          LayoutItemNode,
          TweetNode,
          YouTubeNode,
          AutocompleteNode,
          SpecialTextNode,
        ],
        $initialEditorState(editor) {
          if (editorSerializedState) {
            editor.parseEditorState(editorSerializedState);
          } else if (editorState) {
            editor.setEditorState(editorState);
          }
        },
        theme: editorTheme,
      }),
    [editorState, editorSerializedState],
  );

  return (
    <div className="bg-background overflow-hidden rounded-lg border shadow w-full">
      <LexicalExtensionComposer extension={AppExtension} contentEditable={null}>
        <TooltipProvider>
          <div className="relative">
            <ToolbarPlugin>
              {({ blockType }) => (
                <div className="vertical-align-middle sticky top-0 z-10 flex items-center gap-2 overflow-auto border-b p-1">
                  {toolbarItems.undoRedo && <HistoryToolbarPlugin />}
                  {toolbarItems.undoRedo && <Separator orientation="vertical" className="h-7!" />}
                  {toolbarItems.blockFormat && (
                    <BlockFormatDropDown>
                      {blockFormatItems.paragraph && <FormatParagraph />}
                      {(() => {
                        const levels = (['h1', 'h2', 'h3'] as const).filter(
                          l => blockFormatItems[l],
                        );
                        return levels.length > 0 ? <FormatHeading levels={levels} /> : null;
                      })()}
                      {blockFormatItems.numberList && <FormatNumberedList />}
                      {blockFormatItems.bulletList && <FormatBulletedList />}
                      {blockFormatItems.checkList && <FormatCheckList />}
                      {blockFormatItems.codeBlock && <FormatCodeBlock />}
                      {blockFormatItems.blockquote && <FormatQuote />}
                    </BlockFormatDropDown>
                  )}
                  {blockType === 'code' ? <CodeLanguageToolbarPlugin /> : (
                    <>
                      {toolbarItems.fontFamily && <FontFamilyToolbarPlugin />}
                      {toolbarItems.fontSize && <FontSizeToolbarPlugin />}
                      {(toolbarItems.fontFamily || toolbarItems.fontSize) && (
                        <Separator orientation="vertical" className="h-7!" />
                      )}
                      {toolbarItems.fontFormat && <FontFormatToolbarPlugin />}
                      {toolbarItems.fontFormat && <Separator orientation="vertical" className="h-7!" />}
                      {toolbarItems.subSuper && <SubSuperToolbarPlugin />}
                      {toolbarItems.link && (
                        <LinkToolbarPlugin
                          setIsLinkEditMode={setIsLinkEditMode}
                        />
                      )}
                      {(toolbarItems.subSuper || toolbarItems.link) && (
                        <Separator orientation="vertical" className="h-7!" />
                      )}
                      {toolbarItems.clearFormatting && <ClearFormattingToolbarPlugin />}
                      {toolbarItems.clearFormatting && <Separator orientation="vertical" className="h-7!" />}
                      {toolbarItems.fontColor && <FontColorToolbarPlugin />}
                      {toolbarItems.fontBackground && <FontBackgroundToolbarPlugin />}
                      {(toolbarItems.fontColor
                        || toolbarItems.fontBackground) && <Separator orientation="vertical" className="h-7!" />}
                      {toolbarItems.fontAlignment && <ElementFormatToolbarPlugin />}
                      {toolbarItems.fontAlignment && <Separator orientation="vertical" className="h-7!" />}
                      {toolbarItems.blockInsert && (
                        <BlockInsertPlugin>
                          {blockInsertItems.divider && <InsertHorizontalRule />}
                          {blockInsertItems.image && <InsertImage />}
                          {blockInsertItems.table && <InsertTable />}
                          {blockInsertItems.columnsLayout && <InsertColumnsLayout />}
                          {blockInsertItems.embeds && <InsertEmbeds />}
                        </BlockInsertPlugin>
                      )}
                    </>
                  )}
                </div>
              )}
            </ToolbarPlugin>
            <div className="relative">
              <div className="">
                <div className="" ref={onRef}>
                  <ContentEditable
                    placeholder={placeholder}
                    placeholderClassName={`${pluginItems.draggableBlock ? 'pl-14' : 'pl-4'}`}
                    className={`h-[calc(100vh-141px)] ${pluginItems.draggableBlock ? 'pl-14' : 'pl-4'}`}
                  />
                </div>
              </div>
              {pluginItems.componentPicker && (
                <ComponentPickerMenuPlugin
                  baseOptions={[
                    ...(componentPickerItems.paragraph
                      ? [ParagraphPickerPlugin()]
                      : []),
                    ...(componentPickerItems.h1
                      ? [HeadingPickerPlugin({ n: 1 })]
                      : []),
                    ...(componentPickerItems.h2
                      ? [HeadingPickerPlugin({ n: 2 })]
                      : []),
                    ...(componentPickerItems.h3
                      ? [HeadingPickerPlugin({ n: 3 })]
                      : []),
                    ...(componentPickerItems.table
                      ? [TablePickerPlugin()]
                      : []),
                    ...(componentPickerItems.checkList
                      ? [CheckListPickerPlugin()]
                      : []),
                    ...(componentPickerItems.numberList
                      ? [NumberedListPickerPlugin()]
                      : []),
                    ...(componentPickerItems.bulletList
                      ? [BulletedListPickerPlugin()]
                      : []),
                    ...(componentPickerItems.blockquote
                      ? [QuotePickerPlugin()]
                      : []),
                    ...(componentPickerItems.codeBlock
                      ? [CodePickerPlugin()]
                      : []),
                    ...(componentPickerItems.divider
                      ? [DividerPickerPlugin()]
                      : []),
                    ...(componentPickerItems.tweetEmbed
                      ? [EmbedsPickerPlugin({ embed: 'tweet' })]
                      : []),
                    ...(componentPickerItems.youtubeEmbed
                      ? [EmbedsPickerPlugin({ embed: 'youtube-video' })]
                      : []),
                    ...(componentPickerItems.image
                      ? [ImagePickerPlugin()]
                      : []),
                    ...(componentPickerItems.columnsLayout
                      ? [ColumnsLayoutPickerPlugin()]
                      : []),
                    ...(componentPickerItems.dateTime
                      ? [DateTimePickerPlugin()]
                      : []),
                    ...(componentPickerItems.alignLeft
                      ? [AlignmentPickerPlugin({ alignment: 'left' })]
                      : []),
                    ...(componentPickerItems.alignCenter
                      ? [AlignmentPickerPlugin({ alignment: 'center' })]
                      : []),
                    ...(componentPickerItems.alignRight
                      ? [AlignmentPickerPlugin({ alignment: 'right' })]
                      : []),
                    ...(componentPickerItems.alignJustify
                      ? [AlignmentPickerPlugin({ alignment: 'justify' })]
                      : []),
                  ]}
                  dynamicOptionsFn={DynamicTablePickerPlugin}
                />
              )}
              {pluginItems.emojiPicker && <EmojiPickerPlugin />}
              {pluginItems.autoEmbed && <AutoEmbedPlugin />}
              {pluginItems.mentions && <MentionsPlugin />}
              {blockFormatItems.codeBlock && <CodeHighlightPlugin />}
              {blockInsertItems.table && <TablePlugin />}

              {(blockInsertItems.embeds || componentPickerItems.tweetEmbed) && <TwitterPlugin />}
              {(blockInsertItems.embeds
                || componentPickerItems.youtubeEmbed) && <YouTubePlugin />}
              {pluginItems.tabFocus && <TabFocusPlugin />}
              {pluginItems.tabIndentation && <TabIndentationPlugin />}
              {blockInsertItems.columnsLayout && <LayoutPlugin />}

              {pluginItems.floatingLinkToolbar && (
                <FloatingLinkEditorPlugin
                  anchorElem={floatingAnchorElem}
                  isLinkEditMode={isLinkEditMode}
                  setIsLinkEditMode={setIsLinkEditMode}
                />
              )}

              {pluginItems.draggableBlock && (
                <DraggableBlockPlugin
                  anchorElem={floatingAnchorElem}
                  baseOptions={[
                    ...(componentPickerItems.paragraph
                      ? [ParagraphPickerPlugin()]
                      : []),
                    ...(componentPickerItems.h1
                      ? [HeadingPickerPlugin({ n: 1 })]
                      : []),
                    ...(componentPickerItems.h2
                      ? [HeadingPickerPlugin({ n: 2 })]
                      : []),
                    ...(componentPickerItems.h3
                      ? [HeadingPickerPlugin({ n: 3 })]
                      : []),
                    ...(componentPickerItems.table
                      ? [TablePickerPlugin()]
                      : []),
                    ...(componentPickerItems.checkList
                      ? [CheckListPickerPlugin()]
                      : []),
                    ...(componentPickerItems.numberList
                      ? [NumberedListPickerPlugin()]
                      : []),
                    ...(componentPickerItems.bulletList
                      ? [BulletedListPickerPlugin()]
                      : []),
                    ...(componentPickerItems.blockquote
                      ? [QuotePickerPlugin()]
                      : []),
                    ...(componentPickerItems.codeBlock
                      ? [CodePickerPlugin()]
                      : []),
                    ...(componentPickerItems.divider
                      ? [DividerPickerPlugin()]
                      : []),
                    ...(componentPickerItems.tweetEmbed
                      ? [EmbedsPickerPlugin({ embed: 'tweet' })]
                      : []),
                    ...(componentPickerItems.youtubeEmbed
                      ? [EmbedsPickerPlugin({ embed: 'youtube-video' })]
                      : []),
                    ...(componentPickerItems.image
                      ? [ImagePickerPlugin()]
                      : []),
                    ...(componentPickerItems.columnsLayout
                      ? [ColumnsLayoutPickerPlugin()]
                      : []),
                    ...(componentPickerItems.dateTime
                      ? [DateTimePickerPlugin()]
                      : []),
                    ...(componentPickerItems.alignLeft
                      ? [AlignmentPickerPlugin({ alignment: 'left' })]
                      : []),
                    ...(componentPickerItems.alignCenter
                      ? [AlignmentPickerPlugin({ alignment: 'center' })]
                      : []),
                    ...(componentPickerItems.alignRight
                      ? [AlignmentPickerPlugin({ alignment: 'right' })]
                      : []),
                    ...(componentPickerItems.alignJustify
                      ? [AlignmentPickerPlugin({ alignment: 'justify' })]
                      : []),
                  ]}
                  dynamicOptionsFn={DynamicTablePickerPlugin}
                />
              )}
              {blockFormatItems.codeBlock && <CodeActionMenuPlugin anchorElem={floatingAnchorElem} />}

              {pluginItems.floatingTextToolbar && (
                <FloatingTextFormatToolbarPlugin
                  anchorElem={floatingAnchorElem}
                  setIsLinkEditMode={setIsLinkEditMode}
                />
              )}
              {pluginItems.autoComplete && <AutoCompletePlugin />}
              {pluginItems.contextMenu && <ContextMenuPlugin />}
              {pluginItems.specialText && <SpecialTextPlugin />}

              <TypingPerfPlugin />
            </div>
            <ActionsPlugin>
              <div className="clear-both flex items-center justify-between gap-2 overflow-auto border-t p-1">
                <div className="flex flex-1 justify-start text-xs text-gray-500">
                  {footerItems.characterCount && (
                    <CharacterLimitPlugin
                      maxLength={maxLength}
                      charset="UTF-16"
                    />
                  )}
                </div>
                <div>
                  {footerItems.characterCount && <CounterCharacterPlugin charset="UTF-16" />}
                </div>
                <div className="flex flex-1 justify-end">
                  {footerItems.speechToText && <SpeechToTextPlugin />}
                  {footerItems.shareContent && <ShareContentPlugin />}
                  {footerItems.exportImport && <ImportExportPlugin />}
                  {footerItems.markdownToggle && (
                    <MarkdownTogglePlugin
                      shouldPreserveNewLinesInMarkdown={true}
                      transformers={[
                        TABLE,
                        HR,
                        IMAGE,
                        EMOJI,
                        TWEET,
                        CHECK_LIST,
                        ...ELEMENT_TRANSFORMERS,
                        ...MULTILINE_ELEMENT_TRANSFORMERS,
                        ...TEXT_FORMAT_TRANSFORMERS,
                        ...TEXT_MATCH_TRANSFORMERS,
                      ]}
                    />
                  )}
                  {footerItems.viewOnly && <EditModeTogglePlugin />}
                  {footerItems.clearEditor && <ClearEditorActionPlugin />}
                  {footerItems.treeView && <TreeViewPlugin />}
                </div>
              </div>
            </ActionsPlugin>
          </div>

          <OnChangePlugin
            ignoreSelectionChange={true}
            onChange={editorState => {
              onChange?.(editorState);
              onSerializedChange?.(editorState.toJSON());
            }}
          />
        </TooltipProvider>
      </LexicalExtensionComposer>
    </div>
  );
}
