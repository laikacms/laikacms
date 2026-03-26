/**
 * Removes break nodes that are at the end of a block.
 *
 * When a trailing double space or backslash is encountered at the end of a
 * markdown block, Remark will interpret the character(s) literally, as only
 * break entities followed by text qualify as breaks. A manually created MDAST,
 * however, may have such entities, and users of visual editors shouldn't see
 * these artifacts in resulting markdown.
 */
export default function remarkStripTrailingBreaks(): (node: any) => any;
