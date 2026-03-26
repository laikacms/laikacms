/**
 * Convert leading and trailing spaces in a link to single spaces outside of the
 * link. MDASTs derived from pasted Google Docs HTML require this treatment.
 *
 * Note that, because we're potentially replacing characters in a link node's
 * children with character's in a link node's siblings, we have to operate on a
 * parent (link) node and its children at once, rather than just processing
 * children one at a time.
 */
export default function remarkPaddedLinks(): (node: any) => any;
