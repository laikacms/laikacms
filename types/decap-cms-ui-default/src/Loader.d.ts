export class Loader extends React.Component<any, any, any> {
    static propTypes: {
        children: any;
        className: any;
    };
    constructor(props: any);
    constructor(props: any, context: any);
    state: {
        currentItem: number;
    };
    componentDidMount(): void;
    componentWillUnmount(): void;
    setAnimation: () => void;
    interval: NodeJS.Timeout | undefined;
    renderChild: () => React.JSX.Element | null | undefined;
    render(): React.JSX.Element;
}
export default StyledLoader;
import React from "react";
declare const StyledLoader: import("@emotion/styled").StyledComponent<any, {}, {
    ref?: React.Ref<Loader> | undefined;
}>;
