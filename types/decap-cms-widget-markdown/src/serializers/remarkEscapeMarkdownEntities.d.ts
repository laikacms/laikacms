/**
 * A Remark plugin for escaping markdown entities.
 *
 * When markdown entities are entered in raw markdown, they don't appear as
 * characters in the resulting AST; for example, dashes surrounding a piece of
 * text cause the text to be inserted in a special node type, but the asterisks
 * themselves aren't present as text. Therefore, we generally don't expect to
 * encounter markdown characters in text nodes.
 *
 * However, the CMS visual editor does not interpret markdown characters, and
 * users will expect these characters to be represented literally. In that case,
 * we need to escape them, otherwise they'll be interpreted during
 * stringification.
 */
export default function remarkEscapeMarkdownEntities(): (node: any, index: any) => any;
