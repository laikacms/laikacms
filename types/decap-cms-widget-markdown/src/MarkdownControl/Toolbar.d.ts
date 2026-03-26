export default class Toolbar extends React.Component<any, any, any> {
    static propTypes: {
        buttons: Requireable<any>;
        editorComponents: Requireable<any>;
        onToggleMode: any;
        rawMode: any;
        isShowModeToggle: any;
        plugins: Requireable<any>;
        onSubmit: any;
        onAddAsset: any;
        getAsset: any;
        disabled: any;
        onMarkClick: any;
        onBlockClick: any;
        onLinkClick: any;
        hasMark: any;
        hasInline: any;
        hasBlock: any;
        t: any;
    };
    constructor(props: any);
    constructor(props: any, context: any);
    componentDidMount(): void;
    isVisible: (button: any) => any;
    handleBlockClick: (event: any, type: any) => void;
    handleMarkClick: (event: any, type: any) => void;
    render(): React.JSX.Element;
}
import React from "react";
