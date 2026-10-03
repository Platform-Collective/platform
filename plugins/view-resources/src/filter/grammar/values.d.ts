import type { IterationInfo, Scalar } from './types';
/** Start of the local calendar day containing the timestamp. */
export declare function startOfDay(ts: number): number;
/** Last millisecond of the local calendar day containing the timestamp. */
export declare function endOfDay(ts: number): number;
/**
 * Parses `YYYY-MM-DD`, `@today` or `@today[+-]N(d|w|m|y)`. Returns undefined for anything else,
 * including calendar dates that do not exist (2024-02-31).
 * @public
 */
export declare function parseDateScalar(text: string): Scalar | undefined;
/**
 * Start of the day a date scalar refers to.
 * @public
 */
export declare function resolveDate(scalar: Extract<Scalar, {
    kind: 'date';
}>, now: number): number;
/**
 * Parses `@current`, `@next`, `@previous` with optional `+N` / `-N` arithmetic.
 * @public
 */
export declare function parseIterationScalar(text: string): Scalar | undefined;
/**
 * Resolves an iteration keyword against the iterations of a field. `@current` is the iteration that
 * contains `now`, `@next` and `@previous` its neighbours (in a gap between iterations the closest
 * upcoming / finished one), `+N` / `-N` steps over further iterations. Undefined when there is none.
 * @public
 */
export declare function resolveIteration(scalar: Extract<Scalar, {
    kind: 'iteration';
}>, iterations: readonly IterationInfo[], now: number): IterationInfo | undefined;
/**
 * Case-insensitive match of a label against a pattern where `*` matches any run of characters.
 * Without a wildcard the whole label has to be equal.
 * @public
 */
export declare function matchGlob(pattern: string, label: string): boolean;
/**
 * Case-insensitive substring match where `*` matches any run of characters.
 * @public
 */
export declare function containsGlob(pattern: string, text: string): boolean;
//# sourceMappingURL=values.d.ts.map