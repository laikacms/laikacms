export const HOT_KEY_MAP: {
    bold: string;
    code: string;
    italic: string;
    strikethrough: string;
    'heading-one': string;
    'heading-two': string;
    'heading-three': string;
    'heading-four': string;
    'heading-five': string;
    'heading-six': string;
    link: string;
};
export default Hotkey;
declare function Hotkey(key: any, fn: any): {
    onKeyDown(event: any, editor: any, next: any): any;
};
