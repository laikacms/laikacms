/**
 * Ensure that top level 'html' type nodes are wrapped in paragraphs. Html nodes
 * are used for text nodes that we don't want Remark or Rehype to parse.
 */
export default function remarkWrapHtml(): (tree: any) => any;
