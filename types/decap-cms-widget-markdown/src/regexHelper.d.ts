/**
 * Joins an array of regular expressions into a single expression, without
 * altering the received expressions.
 */
export function joinPatternSegments(patterns: any): any;
/**
 * Combines an array of regular expressions into a single expression, wrapping
 * each in a non-capturing group and interposing alternation characters (|) so
 * that each expression is executed separately.
 */
export function combinePatterns(patterns: any): any;
/**
 * Modify substrings within a string if they match a (global) pattern. Can be
 * inverted to only modify non-matches.
 *
 * params:
 * matchPattern - regexp - a regular expression to check for matches
 * replaceFn - function - a replacement function that receives a matched
 *   substring and returns a replacement substring
 * text - string - the string to process
 * invertMatchPattern - boolean - if true, non-matching substrings are modified
 *   instead of matching substrings
 */
export function replaceWhen(matchPattern: any, replaceFn: any, text: any, invertMatchPattern: any): any;
