export default ForceInsert;
declare function ForceInsert({ defaultType }: {
    defaultType: any;
}): {
    queries: {
        canInsertBeforeNode(editor: any, node: any): boolean;
        canInsertAfterNode(editor: any, node: any): any;
    };
    commands: {
        forceInsertBeforeNode(editor: any, node: any): any;
        forceInsertAfterNode(editor: any, node: any): any;
        moveToEndOfDocument(editor: any): any;
    };
};
