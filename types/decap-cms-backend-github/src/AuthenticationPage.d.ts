export default class GitHubAuthenticationPage extends React.Component<any, any, any> {
    static propTypes: {
        onLogin: any;
        inProgress: any;
        base_url: any;
        siteId: any;
        authEndpoint: any;
        config: any;
        clearHash: any;
        t: any;
    };
    constructor(props: any);
    constructor(props: any, context: any);
    state: {};
    componentDidMount(): void;
    getPermissionToFork: () => Promise<any>;
    loginWithOpenAuthoring(data: any): any;
    handleLogin: (e: any) => void;
    renderLoginButton: () => any;
    getAuthenticationPageRenderArgs(): {
        renderPageContent: ({ LoginButton, TextButton, showAbortButton }: {
            LoginButton: any;
            TextButton: any;
            showAbortButton: any;
        }) => React.JSX.Element;
        renderButtonContent?: undefined;
    } | {
        renderButtonContent: () => any;
        renderPageContent?: undefined;
    };
    render(): React.JSX.Element;
}
import React from "react";
