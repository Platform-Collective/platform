import type { FieldSpec, FieldValue, FilterContext, Node, Scalar } from './types';
/**
 * Raw value of a field in a document.
 * @public
 */
export declare function readFieldValue(field: FieldSpec, doc: any): unknown;
/**
 * A value counts as empty when it is missing, null, an empty string or an empty list.
 * @public
 */
export declare function isEmptyValue(value: unknown): boolean;
/**
 * Option ids a select / user / multi value refers to. A text value is matched against the option
 * labels (`*` wildcards) and, as a fallback, against the ids themselves.
 * @public
 */
export declare function optionIdsFor(field: FieldSpec, scalar: Scalar, ctx: FilterContext): Array<string | number>;
/**
 * Window of numeric / date comparisons for the compiler. Numbers compare exactly (so `>5` is `> 5`),
 * which needs a flag; dates are widened to whole days and need none.
 * @public
 */
export interface NumericMatch {
    lo?: number;
    hi?: number;
    loExclusive?: boolean;
    hiExclusive?: boolean;
}
/**
 * Bounds of a number / date value, or undefined when the value cannot match anything.
 * @public
 */
export declare function numericMatch(field: FieldSpec, value: FieldValue, ctx: FilterContext): NumericMatch | undefined;
/**
 * Whether a document matches one `field:value` term (any of its comma separated values).
 * @public
 */
export declare function matchesField(field: FieldSpec, values: readonly FieldValue[], doc: any, ctx: FilterContext): boolean;
/**
 * Whether a document matches the AST.
 * @public
 */
export declare function evaluate(node: Node, doc: any, ctx: FilterContext): boolean;
/**
 * Predicate for a node, or for "everything" when there is nothing left to evaluate.
 * @public
 */
export declare function createPredicate(node: Node | undefined, ctx: FilterContext): (doc: any) => boolean;
//# sourceMappingURL=evaluate.d.ts.map