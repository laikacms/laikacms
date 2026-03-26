export default ObjectWidgetTopBar;
declare class ObjectWidgetTopBar extends React.Component<any, any, any> {
    static propTypes: {
        allowAdd: any;
        types: Requireable<any>;
        onAdd: any;
        onAddType: any;
        onCollapseToggle: any;
        collapsed: any;
        heading: any;
        label: any;
        t: any;
    };
    constructor(props: any);
    constructor(props: any, context: any);
    componentDidMount(): void;
    renderAddUI(): React.JSX.Element | null;
    renderTypesDropdown(types: any): React.JSX.Element;
    renderAddButton(): React.JSX.Element;
    render(): React.JSX.Element;
}
import React from "react";
