export default CommandsAndQueries;
declare function CommandsAndQueries({ defaultType }: {
    defaultType: any;
}): {
    queries: {
        atStartOf(editor: any, node: any): any;
        getAncestor(editor: any, firstKey: any, lastKey: any): any;
        getOffset(editor: any, node: any): any;
        getSelectedChildren(editor: any, node: any): any;
        getCommonAncestor(editor: any): any;
        getClosestType(editor: any, node: any, type: any): any;
        getBlockContainer(editor: any, node: any): any;
        isSelected(editor: any, nodes: any): boolean;
        isFirstChild(editor: any, node: any): boolean;
        areSiblings(editor: any, nodes: any): boolean;
        everyBlock(editor: any, type: any): any;
        hasMark(editor: any, type: any): any;
        hasBlock(editor: any, type: any): any;
        hasInline(editor: any, type: any): any;
        hasQuote(editor: any, quoteLabel: any): any;
        hasListItems(editor: any, listType: any): any;
    };
    commands: {
        toggleBlock(editor: any, type: any): any;
        unwrapBlockChildren(editor: any, block: any): void;
        unwrapNodeToDepth(editor: any, node: any, depth: any): void;
        unwrapNodeFromAncestor(editor: any, node: any, ancestor: any): void;
    };
};
