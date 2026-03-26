export default MarkdownPreview;
declare class MarkdownPreview extends React.Component<any, any, any> {
    static propTypes: {
        getAsset: any;
        resolveWidget: any;
        value: any;
    };
    constructor(props: any);
    constructor(props: any, context: any);
    componentDidMount(): void;
    render(): React.JSX.Element | null;
}
import React from "react";
