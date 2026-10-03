import type { Result, Token } from './types';
/**
 * Splits a filter string into tokens. Never throws: a malformed string yields `{ ok: false, error }`.
 *
 * - `field:a,b` is one term with several comma separated values, `-field:a` is negated
 * - double quotes keep spaces, commas, colons and parentheses inside a value; `\"` is a quote
 * - `AND`, `OR` (upper case, standalone) and parentheses are operators
 * @public
 */
export declare function tokenize(input: string): Result<Token[]>;
//# sourceMappingURL=tokenizer.d.ts.map