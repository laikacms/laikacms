export function getEditorControl(): any;
export function getEditorComponents(): Map<any, any>;
export default class MarkdownControl extends React.Component<any, any, any> {
    static propTypes: {
        onChange: any;
        onAddAsset: any;
        getAsset: any;
        classNameWrapper: any;
        editorControl: any;
        value: any;
        field: Validator<any>;
        getEditorComponents: any;
        t: any;
    };
    static defaultProps: {
        value: string;
    };
    constructor(props: any);
    state: {
        mode: any;
        pendingFocus: boolean;
    };
    componentDidMount(): void;
    handleMode: (mode: any) => void;
    processRef: (ref: any) => any;
    ref: any;
    setFocusReceived: () => void;
    getAllowedModes: () => any;
    focus(): void;
    render(): React.JSX.Element;
}
import { Map } from "immutable";
import React from "react";
