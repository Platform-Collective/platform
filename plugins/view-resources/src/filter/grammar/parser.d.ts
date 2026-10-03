import type { FieldSpec, FieldValue, IsState, Node, ParseError, Result, ValueToken } from './types';
/** Values accepted by `is:`. `issue` and `sub-issue` mirror GitHub's item kinds. */
export declare const IS_VALUES: IsState[];
/** Pseudo fields that are not part of the schema. */
export declare const RESERVED_FIELDS: string[];
type Tagged<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: ParseError;
};
/**
 * Field names that look like `typed`, best matches first, for "unknown field" hints.
 * @public
 */
export declare function similarFieldNames(typed: string, names: readonly string[]): string[];
/**
 * Resolves a typed field name in the schema (case-insensitive).
 * @public
 */
export declare function findField(schema: readonly FieldSpec[], name: string): FieldSpec | undefined;
/**
 * Parses one comma separated value of `field:value` according to the field type.
 * @public
 */
export declare function parseFieldValue(spec: FieldSpec, v: ValueToken): Tagged<FieldValue>;
/**
 * Parses a filter string into an AST. Never throws; errors carry the offending position.
 * An empty string yields an empty AND that matches everything.
 * @public
 */
export declare function parseFilter(input: string, schema: readonly FieldSpec[]): Result<Node>;
export {};
//# sourceMappingURL=parser.d.ts.map