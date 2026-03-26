/**
 * This module contains all serializers for the Markdown widget.
 *
 * The value of a Markdown widget is transformed to various formats during
 * editing, and these formats are referenced throughout serializer source
 * documentation. Below is brief glossary of the formats used.
 *
 * - Markdown {string}
 *   The stringified Markdown value. The value of the field is persisted
 *   (stored) in this format, and the stringified value is also used when the
 *   editor is in "raw" Markdown mode.
 *
 * - MDAST {object}
 *   Also loosely referred to as "Remark". MDAST stands for MarkDown AST
 *   (Abstract Syntax Tree), and is an object representation of a Markdown
 *   document. Underneath, it's a Unist tree with a Markdown-specific schema.
 *   MDAST syntax is a part of the Unified ecosystem, and powers the Remark
 *   processor, so Remark plugins may be used.
 *
 * - HAST {object}
 *   Also loosely referred to as "Rehype". HAST, similar to MDAST, is an object
 *   representation of an HTML document.  The field value takes this format
 *   temporarily before the document is stringified to HTML.
 *
 * - HTML {string}
 *   The field value is stringified to HTML for preview purposes - the HTML value
 *   is never parsed, it is output only.
 *
 * - Slate Raw AST {object}
 *   Slate's Raw AST is a very simple and unopinionated object representation of
 *   a document in a Slate editor. We define our own Markdown-specific schema
 *   for serialization to/from Slate's Raw AST and MDAST.
 */
/**
 * Deserialize a Markdown string to an MDAST.
 */
export function markdownToRemark(markdown: any, remarkPlugins: any): import("unist").Node<import("unist").Data>;
/**
 * Serialize an MDAST to a Markdown string.
 */
export function remarkToMarkdown(obj: any, remarkPlugins: any): string;
/**
 * Convert Markdown to HTML.
 */
export function markdownToHtml(markdown: any, { getAsset, resolveWidget, remarkPlugins }?: {
    getAsset: any;
    resolveWidget: any;
    remarkPlugins?: any[] | undefined;
}): string;
/**
 * Deserialize an HTML string to Slate's Raw AST. Currently used for HTML
 * pastes.
 */
export function htmlToSlate(html: any): import("unist").Node<import("unist").Data>;
/**
 * Convert Markdown to Slate's Raw AST.
 */
export function markdownToSlate(markdown: any, { voidCodeBlock, remarkPlugins }?: {
    voidCodeBlock: any;
    remarkPlugins?: any[] | undefined;
}): any;
/**
 * Convert a Slate Raw AST to Markdown.
 *
 * Requires shortcode plugins to parse shortcode nodes back to text.
 *
 * Note that Unified is not utilized for the conversion from Slate's Raw AST to
 * MDAST. The conversion is manual because Unified can only operate on Unist
 * trees.
 */
export function slateToMarkdown(raw: any, { voidCodeBlock, remarkPlugins }?: {
    voidCodeBlock: any;
    remarkPlugins?: any[] | undefined;
}): string;
