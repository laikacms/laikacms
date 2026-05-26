// Re-export the editor-agnostic core so consumers can keep importing names
// like `Mapper`, `PortableTextDocument`, `RichtextValue`, `createKeyGenerator`,
// `stripKeys`, etc. directly from `decap-cms-lexical-core`.
export * from '@laikacloud/portabletext-core';

// Custom blocks subsystem (Lexical-specific).
export * from './blocks/BlockNode';
export * from './blocks/blocksContext';
export * from './blocks/types';

// Lexical node set and headless editor.
export * from './lexical/headlessEditor';
export * from './lexical/nodes';

// Portable Text <-> Lexical bridge.
export * from './bridge/empty';
export * from './bridge/lexicalToPortableText';
export * from './bridge/marks';
export * from './bridge/portableTextToLexical';
export * from './bridge/types';

// Lexical-bound `RichtextValue` subclass (carries `editorState` and derives
// canonical PT from it on change).
export * from './value/LexicalRichtextValue';
