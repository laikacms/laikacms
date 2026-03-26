export default ToolbarButton;
declare function ToolbarButton({ type, label, icon, onClick, isActive, disabled }: {
    type: any;
    label: any;
    icon: any;
    onClick: any;
    isActive: any;
    disabled: any;
}): React.JSX.Element;
declare namespace ToolbarButton {
    namespace propTypes {
        const type: any;
        const label: any;
        const icon: any;
        const onClick: any;
        const isActive: any;
        const disabled: any;
    }
}
import React from "react";
