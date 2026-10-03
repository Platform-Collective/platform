import type { FieldSpec } from './types';
/**
 * @public
 */
export interface Suggestion {
    kind: 'field' | 'value';
    label: string;
    insert: string;
}
/**
 * @public
 */
export interface SuggestionResult {
    from: number;
    to: number;
    items: Suggestion[];
}
/**
 * Autocomplete suggestions for the term at the caret: field names (with `has`, `no`, `is`) when the
 * term has no colon yet, otherwise the known values of the typed field.
 * @public
 */
export declare function suggest(text: string, caret: number, schema: readonly FieldSpec[]): SuggestionResult;
/**
 * Applies a suggestion to the input; returns the new text and caret position.
 * @public
 */
export declare function applySuggestion(text: string, result: SuggestionResult, item: Suggestion): {
    text: string;
    caret: number;
};
/**
 * Adds `field:value` as one more AND condition to a filter string (the "click a value to filter" action).
 * A term that is already there is not repeated; a filter with a top level OR is parenthesized first so
 * that the new condition applies to the whole of it.
 * @public
 */
export declare function appendTerm(query: string, field: string, value: string): string;
/**
 * Joins two filter strings with AND; a part with a top level OR is parenthesized so that it keeps its meaning.
 * @public
 */
export declare function joinAnd(a: string, b: string): string;
//# sourceMappingURL=suggest.d.ts.map