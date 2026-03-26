export namespace DecapCmsWidgetMarkdown {
    export { Widget };
    export { controlComponent };
    export { previewComponent };
}
export default DecapCmsWidgetMarkdown;
declare function Widget(opts?: {}): {
    name: string;
    controlComponent: typeof controlComponent;
    previewComponent: typeof previewComponent;
    schema: {
        properties: {
            minimal: {
                type: string;
            };
            buttons: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
            };
            editor_components: {
                type: string;
                items: {
                    type: string;
                };
            };
            modes: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                minItems: number;
            };
        };
    };
};
import controlComponent from "./MarkdownControl";
import previewComponent from "./MarkdownPreview";
