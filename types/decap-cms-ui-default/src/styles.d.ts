export namespace fonts {
    const primary: string;
    const mono: string;
}
export namespace colorsRaw {
    const white: string;
    const grayLight: string;
    const gray: string;
    const grayDark: string;
    const blue: string;
    const blueLight: string;
    const green: string;
    const greenLight: string;
    const brown: string;
    const yellow: string;
    const red: string;
    const redDark: string;
    const redLight: string;
    const purple: string;
    const purpleLight: string;
    const teal: string;
    const tealDark: string;
    const tealLight: string;
}
export namespace colors {
    import statusDraftText = colorsRaw.purple;
    export { statusDraftText };
    import statusDraftBackground = colorsRaw.purpleLight;
    export { statusDraftBackground };
    import statusReviewText = colorsRaw.brown;
    export { statusReviewText };
    import statusReviewBackground = colorsRaw.yellow;
    export { statusReviewBackground };
    import statusReadyText = colorsRaw.green;
    export { statusReadyText };
    import statusReadyBackground = colorsRaw.greenLight;
    export { statusReadyBackground };
    import text = colorsRaw.gray;
    export { text };
    import textLight = colorsRaw.white;
    export { textLight };
    import textLead = colorsRaw.grayDark;
    export { textLead };
    import background = colorsRaw.grayLight;
    export { background };
    import foreground = colorsRaw.white;
    export { foreground };
    import active = colorsRaw.blue;
    export { active };
    import activeBackground = colorsRaw.blueLight;
    export { activeBackground };
    import inactive = colorsRaw.gray;
    export { inactive };
    import button = colorsRaw.grayDark;
    export { button };
    import buttonText = colorsRaw.white;
    export { buttonText };
    import inputBackground = colorsRaw.white;
    export { inputBackground };
    import infoText = colorsRaw.blue;
    export { infoText };
    import infoBackground = colorsRaw.blueLight;
    export { infoBackground };
    import successText = colorsRaw.green;
    export { successText };
    import successBackground = colorsRaw.greenLight;
    export { successBackground };
    import warnText = colorsRaw.brown;
    export { warnText };
    import warnBackground = colorsRaw.yellow;
    export { warnBackground };
    import errorText = colorsRaw.red;
    export { errorText };
    import errorBackground = colorsRaw.redLight;
    export { errorBackground };
    export const textFieldBorder: string;
    export const controlLabel: string;
    export const checkerboardLight: string;
    export const checkerboardDark: string;
    import mediaDraftText = colorsRaw.purple;
    export { mediaDraftText };
    import mediaDraftBackground = colorsRaw.purpleLight;
    export { mediaDraftBackground };
}
export namespace lengths {
    const topBarHeight: string;
    const inputPadding: string;
    const borderRadius: string;
    const richTextEditorMinHeight: string;
    const borderWidth: string;
    const topCardWidth: string;
    const pageMargin: string;
    const objectWidgetTopBarContainerPadding: string;
}
export namespace components {
    export { card };
    export const caretDown: import("@emotion/react").SerializedStyles;
    export const caretRight: import("@emotion/react").SerializedStyles;
    export const badge: import("@emotion/react").SerializedStyles;
    export const badgeSuccess: import("@emotion/react").SerializedStyles;
    export const badgeDanger: import("@emotion/react").SerializedStyles;
    export const textBadge: import("@emotion/react").SerializedStyles;
    export const textBadgeSuccess: import("@emotion/react").SerializedStyles;
    export const textBadgeDanger: import("@emotion/react").SerializedStyles;
    export const loaderSize: import("@emotion/react").SerializedStyles;
    export const cardTop: import("@emotion/react").SerializedStyles;
    export const cardTopHeading: import("@emotion/react").SerializedStyles;
    export const cardTopDescription: import("@emotion/react").SerializedStyles;
    export const objectWidgetTopBarContainer: import("@emotion/react").SerializedStyles;
    export const dropdownList: import("@emotion/react").SerializedStyles;
    export const dropdownItem: import("@emotion/react").SerializedStyles;
    export const viewControlsText: import("@emotion/react").SerializedStyles;
}
export namespace buttons {
    const button_1: import("@emotion/react").SerializedStyles;
    export { button_1 as button };
    const _default: import("@emotion/react").SerializedStyles;
    export { _default as default };
    export const widget: import("@emotion/react").SerializedStyles;
    export const medium: import("@emotion/react").SerializedStyles;
    export const small: import("@emotion/react").SerializedStyles;
    const gray_1: import("@emotion/react").SerializedStyles;
    export { gray_1 as gray };
    export const grayText: import("@emotion/react").SerializedStyles;
    const green_1: import("@emotion/react").SerializedStyles;
    export { green_1 as green };
    export const lightRed: import("@emotion/react").SerializedStyles;
    export const lightBlue: import("@emotion/react").SerializedStyles;
    export const lightTeal: import("@emotion/react").SerializedStyles;
    const teal_1: import("@emotion/react").SerializedStyles;
    export { teal_1 as teal };
    export const disabled: import("@emotion/react").SerializedStyles;
}
export namespace text {
    const fieldLabel: import("@emotion/react").SerializedStyles;
}
export namespace shadows {
    const drop: string;
    const dropMain: string;
    const dropMiddle: string;
    const dropDeep: string;
    const inset: string;
}
export namespace borders {
    const textField: string;
}
export namespace transitions {
    const main: string;
}
export namespace effects {
    const checkerboard: import("@emotion/react").SerializedStyles;
}
export namespace zIndex {
    const zIndex0: number;
    const zIndex1: number;
    const zIndex2: number;
    const zIndex10: number;
    const zIndex100: number;
    const zIndex200: number;
    const zIndex299: number;
    const zIndex300: number;
    const zIndex1000: number;
    const zIndex10000: number;
    const zIndex99999: number;
}
export namespace reactSelectStyles {
    function control(styles: any): any;
    function option(styles: any, state: any): any;
    function menu(styles: any): any;
    function container(styles: any): any;
    function indicatorSeparator(styles: any, state: any): any;
    function dropdownIndicator(styles: any): any;
    function clearIndicator(styles: any): any;
    function multiValue(styles: any): any;
    function multiValueLabel(styles: any): any;
    function multiValueRemove(styles: any): any;
}
export function GlobalStyles(): React.JSX.Element;
declare const card: import("@emotion/react").SerializedStyles;
import React from "react";
export {};
