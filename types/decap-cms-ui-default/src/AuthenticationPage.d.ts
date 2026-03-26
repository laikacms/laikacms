declare function AuthenticationPage({ onLogin, loginDisabled, loginErrorMessage, renderButtonContent, renderPageContent, logoUrl, logo, siteUrl, t, }: {
    onLogin: any;
    loginDisabled: any;
    loginErrorMessage: any;
    renderButtonContent: any;
    renderPageContent: any;
    logoUrl: any;
    logo: any;
    siteUrl: any;
    t: any;
}): React.JSX.Element;
declare namespace AuthenticationPage {
    namespace propTypes {
        const onLogin: any;
        const logoUrl: any;
        const logo: any;
        const siteUrl: any;
        const loginDisabled: any;
        const loginErrorMessage: any;
        const renderButtonContent: any;
        const renderPageContent: any;
        const t: any;
    }
}
export function renderPageLogo(logoUrl: any): React.JSX.Element;
import React from "react";
export { AuthenticationPage as default };
