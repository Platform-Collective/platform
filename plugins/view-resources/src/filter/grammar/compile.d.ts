import type { FieldSpec, FilterContext, Node, ParseError } from './types';
/**
 * Server-side part of a filter and what is left for the client.
 * @public
 */
export interface SplitResult {
    query: Record<string, any>;
    residual?: Node;
}
/**
 * Splits a filter into the part a `DocumentQuery` can express and the part the client has to evaluate.
 * The top level AND is taken apart, each conjunct goes to the server when it is a plain condition on
 * an indexed attribute. Anything else, in particular an OR across different fields or across server
 * and client fields, is kept whole in the residual so that the combined result stays correct.
 * Conditions on `reservedKeys` (attributes the host query already constrains) are left to the client too.
 * @public
 */
export declare function splitServerClient(ast: Node, ctx: FilterContext, reservedKeys?: ReadonlySet<string>): SplitResult;
/**
 * Query of a filter that is fully evaluated on the server, or undefined when part of it needs the client.
 * @public
 */
export declare function compileQuery(ast: Node, ctx: FilterContext): Record<string, any> | undefined;
/**
 * A parsed filter ready to be applied.
 * @public
 */
export interface CompiledFilter {
    ast: Node;
    query: Record<string, any>;
    residual?: Node;
    predicate: (doc: any) => boolean;
    matches: (doc: any) => boolean;
}
/**
 * Parses and compiles a filter string. An empty string matches everything.
 * @public
 */
export declare function compileFilter(input: string, schema: readonly FieldSpec[], ctx: FilterContext): {
    ok: true;
    value: CompiledFilter;
} | {
    ok: false;
    error: ParseError;
};
/**
 * Document properties a client evaluation of the node reads, for projecting a scan:
 * attributes by name, plus `customFields` when a user-defined field is involved.
 * @public
 */
export declare function referencedProperties(node: Node | undefined): string[];
//# sourceMappingURL=compile.d.ts.map