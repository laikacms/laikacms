import type { Map as ImmutableMap, List } from 'immutable';
/**
 * Main entry point for encoding steganographic data into entry values
 * Uses a visitor pattern with caching to handle recursive structures
 */
export declare function encodeEntry(value: unknown, fields: List<ImmutableMap<string, unknown>>): any;
