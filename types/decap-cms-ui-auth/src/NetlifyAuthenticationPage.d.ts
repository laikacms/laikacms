export default class NetlifyAuthenticationPage extends React.Component<any, any, any> {
    static authClient: any;
    static propTypes: {
        onLogin: any;
        inProgress: any;
        error: any;
        config: any;
        t: any;
    };
    constructor(props: any);
    componentDidMount(): void;
    componentWillUnmount(): void;
    handleIdentityLogin: (user: any) => void;
    handleIdentityLogout: () => void;
    handleIdentityError: (err: any) => void;
    handleIdentity: () => void;
    state: {
        email: string;
        password: string;
        errors: {};
    };
    handleChange: (name: any, e: any) => void;
    handleLogin: (e: any) => Promise<void>;
    render(): React.JSX.Element;
}
import React from "react";
