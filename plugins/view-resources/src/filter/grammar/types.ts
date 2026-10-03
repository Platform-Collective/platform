//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Shared types of the GitHub-Projects style filter grammar (plan D3). The module is pure:
// it has no platform or UI imports so that the tokenizer, parser, compiler and evaluator
// can be unit tested and reused by any view.

/**
 * Kind of values a field holds. It decides which operators and value syntaxes are valid.
 * @public
 */
export type FieldType =
  | 'text' // contains-match, `*` wildcards
  | 'number' // =, comparison, ranges
  | 'date' // =, comparison, ranges, `@today[-7d]`
  | 'select' // one of the options, matched by label
  | 'multi' // any of the options (labels, multi-select)
  | 'user' // like select, plus `@me`
  | 'iteration' // like select, plus `@current`, `@next`, `@previous` and arithmetic
  | 'presence' // only usable with has:/no:

/**
 * @public
 */
export interface FieldOption {
  // Stored value (ref, enum value or option id)
  id: string | number
  // Label the user types in a filter
  name: string
}

/**
 * Description of a filterable field. The schema is supplied by the host view.
 * @public
 */
export interface FieldSpec {
  // Name as typed in the filter, lowercase without spaces (`story-points`)
  name: string
  // Human readable label, for suggestions
  label: string
  type: FieldType
  // Where the value lives: an attribute of the document or an entry of `customFields`
  source: 'attribute' | 'custom'
  // Attribute name or custom field key
  key: string
  // Choices of select / multi / user / iteration fields
  options?: FieldOption[]
  // Reads the value from a document. Defaults to the attribute / custom field named by `key`
  read?: (doc: any) => unknown
  // Document ids that have any of the option ids, for fields the server cannot index directly (labels)
  resolveDocIds?: (optionIds: Array<string | number>) => string[]
  // Server query fragment for has:/no: on fields that are not plain attributes
  presenceQuery?: (present: boolean) => Record<string, any>
  // Attributes `read` needs besides `key`, so that a client scan loads them
  dependsOn?: string[]
  // Never evaluated on the server (e.g. values that only exist on the client)
  clientOnly?: boolean
}

/**
 * Where an error was found: character offsets into the filter string, end exclusive.
 * @public
 */
export type ParseErrorCode =
  | 'unterminatedQuote'
  | 'unbalancedParenthesis'
  | 'unexpectedToken'
  | 'unknownField'
  | 'missingValue'
  | 'invalidOperator'
  | 'invalidValue'
  | 'invalidDate'
  | 'invalidNumber'
  | 'invalidRange'
  | 'unknownKeyword'

/**
 * @public
 */
export interface ParseError {
  code: ParseErrorCode
  message: string
  // Offset of the first offending character
  pos: number
  // Offset after the last offending character
  end: number
  // Suggestions for the offending token, e.g. known field names
  hints?: string[]
}

/**
 * @public
 */
export type Result<T> = { ok: true, value: T } | { ok: false, error: ParseError }

// ---- tokens ----

/**
 * One comma separated value of a `field:value` term.
 * @public
 */
export interface ValueToken {
  text: string
  quoted: boolean
  pos: number
  end: number
}

/**
 * @public
 */
export type Token =
  | { type: 'lparen', pos: number, end: number }
  | { type: 'rparen', pos: number, end: number }
  | { type: 'and', pos: number, end: number }
  | { type: 'or', pos: number, end: number }
  // `-(`: negation of a group
  | { type: 'not', pos: number, end: number }
  | {
    type: 'term'
    pos: number
    end: number
    negated: boolean
    // Absent for free text
    field?: { name: string, pos: number, end: number }
    values: ValueToken[]
  }

// ---- values ----

/**
 * Calendar unit of a relative date.
 * @public
 */
export type DateUnit = 'd' | 'w' | 'm' | 'y'

/**
 * @public
 */
export type Scalar =
  | { kind: 'text', text: string, quoted: boolean }
  | { kind: 'me' }
  | { kind: 'number', value: number }
  // Absolute day (`abs`, start of the day) or relative to `@today`
  | { kind: 'date', abs?: number, amount: number, unit: DateUnit }
  | { kind: 'iteration', keyword: 'current' | 'next' | 'previous', offset: number }

/**
 * @public
 */
export type CompareOp = '>' | '>=' | '<' | '<='

/**
 * @public
 */
export type FieldValue =
  | { kind: 'eq', value: Scalar }
  | { kind: 'compare', op: CompareOp, value: Scalar }
  // Inclusive; a missing bound is the `*` wildcard
  | { kind: 'range', from?: Scalar, to?: Scalar }

// ---- AST ----

/**
 * @public
 */
export type IsState = 'open' | 'closed' | 'issue' | 'sub-issue' | 'archived'

/**
 * @public
 */
export type Node =
  | { type: 'and', children: Node[] }
  | { type: 'or', children: Node[] }
  | { type: 'not', child: Node }
  // Free text, matches the title
  | { type: 'text', value: string, quoted: boolean, pos: number }
  // `field:a,b` matches when ANY value matches
  | { type: 'field', field: FieldSpec, values: FieldValue[], pos: number }
  // has:field (present = true) or no:field
  | { type: 'presence', field: FieldSpec, present: boolean, pos: number }
  | { type: 'is', state: IsState, pos: number }

/**
 * Environment of compilation and evaluation.
 * @public
 */
export interface FilterContext {
  // Timestamp that `@today` refers to
  now: number
  // Id of the current user for `@me`
  me?: string
  // Iterations of an iteration field (by field key); resolves @current, @next, @previous
  iterations?: (fieldKey: string) => IterationInfo[]
  // Option ids of statuses that count as closed (done or cancelled), for is:open / is:closed
  closedStatuses?: ReadonlySet<string>
  // Value of `Issue.attachedTo` of an issue without a parent, for is:sub-issue
  noParentId?: string
}

/**
 * @public
 */
export interface IterationInfo {
  id: string
  title: string
  // Start of the first day
  start: number
  // Last millisecond of the last day
  end: number
}
