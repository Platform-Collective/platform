/**
 * Kind of values a field holds. It decides which operators and value syntaxes are valid.
 * @public
 */
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'multi' | 'user' | 'iteration' | 'presence';
/**
 * @public
 */
export interface FieldOption {
    id: string | number;
    name: string;
}
/**
 * Description of a filterable field. The schema is supplied by the host view.
 * @public
 */
export interface FieldSpec {
    name: string;
    label: string;
    type: FieldType;
    source: 'attribute' | 'custom';
    key: string;
    options?: FieldOption[];
    read?: (doc: any) => unknown;
    resolveDocIds?: (optionIds: Array<string | number>) => string[];
    presenceQuery?: (present: boolean) => Record<string, any>;
    dependsOn?: string[];
    clientOnly?: boolean;
}
/**
 * Where an error was found: character offsets into the filter string, end exclusive.
 * @public
 */
export type ParseErrorCode = 'unterminatedQuote' | 'unbalancedParenthesis' | 'unexpectedToken' | 'unknownField' | 'missingValue' | 'invalidOperator' | 'invalidValue' | 'invalidDate' | 'invalidNumber' | 'invalidRange' | 'unknownKeyword';
/**
 * @public
 */
export interface ParseError {
    code: ParseErrorCode;
    message: string;
    pos: number;
    end: number;
    hints?: string[];
}
/**
 * @public
 */
export type Result<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: ParseError;
};
/**
 * One comma separated value of a `field:value` term.
 * @public
 */
export interface ValueToken {
    text: string;
    quoted: boolean;
    pos: number;
    end: number;
}
/**
 * @public
 */
export type Token = {
    type: 'lparen';
    pos: number;
    end: number;
} | {
    type: 'rparen';
    pos: number;
    end: number;
} | {
    type: 'and';
    pos: number;
    end: number;
} | {
    type: 'or';
    pos: number;
    end: number;
} | {
    type: 'not';
    pos: number;
    end: number;
} | {
    type: 'term';
    pos: number;
    end: number;
    negated: boolean;
    field?: {
        name: string;
        pos: number;
        end: number;
    };
    values: ValueToken[];
};
/**
 * Calendar unit of a relative date.
 * @public
 */
export type DateUnit = 'd' | 'w' | 'm' | 'y';
/**
 * @public
 */
export type Scalar = {
    kind: 'text';
    text: string;
    quoted: boolean;
} | {
    kind: 'me';
} | {
    kind: 'number';
    value: number;
} | {
    kind: 'date';
    abs?: number;
    amount: number;
    unit: DateUnit;
} | {
    kind: 'iteration';
    keyword: 'current' | 'next' | 'previous';
    offset: number;
};
/**
 * @public
 */
export type CompareOp = '>' | '>=' | '<' | '<=';
/**
 * @public
 */
export type FieldValue = {
    kind: 'eq';
    value: Scalar;
} | {
    kind: 'compare';
    op: CompareOp;
    value: Scalar;
} | {
    kind: 'range';
    from?: Scalar;
    to?: Scalar;
};
/**
 * @public
 */
export type IsState = 'open' | 'closed' | 'issue' | 'sub-issue';
/**
 * @public
 */
export type Node = {
    type: 'and';
    children: Node[];
} | {
    type: 'or';
    children: Node[];
} | {
    type: 'not';
    child: Node;
} | {
    type: 'text';
    value: string;
    quoted: boolean;
    pos: number;
} | {
    type: 'field';
    field: FieldSpec;
    values: FieldValue[];
    pos: number;
} | {
    type: 'presence';
    field: FieldSpec;
    present: boolean;
    pos: number;
} | {
    type: 'is';
    state: IsState;
    pos: number;
};
/**
 * Environment of compilation and evaluation.
 * @public
 */
export interface FilterContext {
    now: number;
    me?: string;
    iterations?: (fieldKey: string) => IterationInfo[];
    closedStatuses?: ReadonlySet<string>;
    noParentId?: string;
}
/**
 * @public
 */
export interface IterationInfo {
    id: string;
    title: string;
    start: number;
    end: number;
}
//# sourceMappingURL=types.d.ts.map