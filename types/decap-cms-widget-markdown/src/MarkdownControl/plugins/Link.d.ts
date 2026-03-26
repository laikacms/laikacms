export default Link;
declare function Link({ type }: {
    type: any;
}): {
    commands: {
        toggleLink(editor: any, getUrl: any): any;
    };
};
