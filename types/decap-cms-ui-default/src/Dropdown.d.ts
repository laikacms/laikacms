declare function Dropdown({ closeOnSelection, renderButton, dropdownWidth, dropdownPosition, dropdownTopOverlap, className, children, }: {
    closeOnSelection?: boolean | undefined;
    renderButton: any;
    dropdownWidth?: string | undefined;
    dropdownPosition?: string | undefined;
    dropdownTopOverlap?: string | undefined;
    className: any;
    children: any;
}): React.JSX.Element;
declare namespace Dropdown {
    namespace propTypes {
        const renderButton: any;
        const dropdownWidth: any;
        const dropdownPosition: any;
        const dropdownTopOverlap: any;
        const className: any;
        const children: any;
    }
}
export function DropdownItem({ label, icon, iconDirection, iconSmall, isActive, onClick, className }: {
    label: any;
    icon: any;
    iconDirection: any;
    iconSmall: any;
    isActive: any;
    onClick: any;
    className: any;
}): React.JSX.Element;
export namespace DropdownItem {
    export namespace propTypes_1 {
        export const label: any;
        export const icon: any;
        export const iconDirection: any;
        export const onClick: any;
        const className_1: any;
        export { className_1 as className };
    }
    export { propTypes_1 as propTypes };
}
export function DropdownCheckedItem({ label, id, checked, onClick }: {
    label: any;
    id: any;
    checked: any;
    onClick: any;
}): React.JSX.Element;
export namespace DropdownCheckedItem {
    export namespace propTypes_2 {
        const label_1: any;
        export { label_1 as label };
        export const id: any;
        export const checked: any;
        const onClick_1: any;
        export { onClick_1 as onClick };
    }
    export { propTypes_2 as propTypes };
}
export const StyledDropdownButton: import("@emotion/styled").StyledComponent<any, {}, {
    ref?: React.Ref<any> | undefined;
}>;
import React from "react";
export { Dropdown as default, DropdownButton };
