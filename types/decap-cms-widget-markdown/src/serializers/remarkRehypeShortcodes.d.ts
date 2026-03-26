/**
 * This plugin doesn't actually transform Remark (MDAST) nodes to Rehype
 * (HAST) nodes, but rather, it prepares an MDAST shortcode node for HAST
 * conversion by replacing the shortcode text with stringified HTML for
 * previewing the shortcode output.
 */
export default function remarkToRehypeShortcodes({ plugins, getAsset, resolveWidget }: {
    plugins: any;
    getAsset: any;
    resolveWidget: any;
}): (root: any) => any;
