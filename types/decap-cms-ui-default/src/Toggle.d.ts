declare const StyledToggle: import("@emotion/styled").StyledComponent<{
    id: any;
    active: any;
    onChange: any;
    onFocus: any;
    onBlur: any;
    className: any;
    Container?: import("@emotion/styled").StyledComponent<{
        theme?: import("@emotion/react").Theme | undefined;
        as?: React.ElementType<any, keyof React.JSX.IntrinsicElements> | undefined;
    }, React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>, {}> | undefined;
    Background?: import("@emotion/styled").StyledComponent<{
        theme?: import("@emotion/react").Theme | undefined;
        as?: React.ElementType<any, keyof React.JSX.IntrinsicElements> | undefined;
    }, React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>, {}> | undefined;
    Handle?: import("@emotion/styled").StyledComponent<{
        theme?: import("@emotion/react").Theme | undefined;
        as?: React.ElementType<any, keyof React.JSX.IntrinsicElements> | undefined;
    }, React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>, {}> | undefined;
} & {
    theme?: import("@emotion/react").Theme | undefined;
}, {}, {}>;
export const ToggleContainer: import("@emotion/styled").StyledComponent<{
    theme?: import("@emotion/react").Theme | undefined;
    as?: React.ElementType<any, keyof React.JSX.IntrinsicElements> | undefined;
}, React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>, {}>;
export const ToggleBackground: import("@emotion/styled").StyledComponent<{
    theme?: import("@emotion/react").Theme | undefined;
    as?: React.ElementType<any, keyof React.JSX.IntrinsicElements> | undefined;
}, React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>, {}>;
export const ToggleHandle: import("@emotion/styled").StyledComponent<{
    theme?: import("@emotion/react").Theme | undefined;
    as?: React.ElementType<any, keyof React.JSX.IntrinsicElements> | undefined;
}, React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>, {}>;
import React from "react";
export { StyledToggle as default };
