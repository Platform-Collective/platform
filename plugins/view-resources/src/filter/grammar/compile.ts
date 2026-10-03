//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { createPredicate, numericMatch, optionIdsFor } from './evaluate'
import { parseFilter } from './parser'
import type { FieldSpec, FieldValue, FilterContext, Node, ParseError } from './types'

// Compilation of the AST into a Huly `DocumentQuery`. A document query is a conjunction of one
// selector per attribute: it has no OR, so everything it cannot express stays in a residual AST
// that the client evaluates over the already narrowed result (see `splitServerClient`).

type Clause = Record<string, any>

/**
 * Server-side part of a filter and what is left for the client.
 * @public
 */
export interface SplitResult {
  // Selectors the server evaluates. Always a safe narrowing of the result
  query: Record<string, any>
  // Part of the filter the server cannot evaluate; undefined when the query is exact
  residual?: Node
}

function conjuncts (node: Node): Node[] {
  return node.type === 'and' ? node.children.flatMap(conjuncts) : [node]
}

function isPlainSelector (v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// A clause is added only when it does not collide with a selector already in the query
function mergeClause (query: Record<string, any>, clause: Clause, reserved?: ReadonlySet<string>): boolean {
  for (const [key, sel] of Object.entries(clause)) {
    if (reserved?.has(key) === true) return false
    if (!(key in query)) continue
    const existing = query[key]
    if (!isPlainSelector(existing) || !isPlainSelector(sel)) return false
    if (Object.keys(sel).some((op) => op in existing)) return false
  }
  for (const [key, sel] of Object.entries(clause)) {
    query[key] = key in query ? { ...query[key], ...sel } : sel
  }
  return true
}

// `%`, `_` and `\` are LIKE metacharacters; such text is left to the client instead of being escaped
const LIKE_UNSAFE = /[%_\\]/

function textClause (value: string): Clause | undefined {
  if (LIKE_UNSAFE.test(value)) return undefined
  return { title: { $like: `%${value.replaceAll('*', '%')}%` } }
}

function serverField (field: FieldSpec): boolean {
  return field.source === 'attribute' && field.clientOnly !== true
}

function selectedIds (field: FieldSpec, values: readonly FieldValue[], ctx: FilterContext): Array<string | number> | undefined {
  const ids = new Set<string | number>()
  for (const v of values) {
    if (v.kind !== 'eq') return undefined
    for (const id of optionIdsFor(field, v.value, ctx)) ids.add(id)
  }
  return [...ids]
}

function fieldClause (field: FieldSpec, values: readonly FieldValue[], negated: boolean, ctx: FilterContext): Clause | undefined {
  if (!serverField(field)) return undefined

  if (field.resolveDocIds !== undefined) {
    const ids = selectedIds(field, values, ctx)
    if (ids === undefined) return undefined
    const docs = field.resolveDocIds(ids)
    return { _id: negated ? { $nin: docs } : { $in: docs } }
  }

  switch (field.type) {
    case 'text': {
      if (negated || values.length !== 1) return undefined
      const v = values[0]
      return v.kind === 'eq' && v.value.kind === 'text' ? textClause(v.value.text) : undefined
    }
    case 'select':
    case 'user': {
      const ids = selectedIds(field, values, ctx)
      if (ids === undefined) return undefined
      return { [field.key]: negated ? { $nin: ids } : { $in: ids } }
    }
    case 'number':
    case 'date': {
      if (negated || values.length !== 1) return undefined
      const m = numericMatch(field, values[0], ctx)
      // A value that cannot match anything selects nothing
      if (m === undefined) return { [field.key]: { $in: [] } }
      const sel: Record<string, number | null> = {}
      if (m.lo !== undefined) sel[m.loExclusive === true ? '$gt' : '$gte'] = m.lo
      if (m.hi !== undefined) sel[m.hiExclusive === true ? '$lt' : '$lte'] = m.hi
      return { [field.key]: Object.keys(sel).length > 0 ? sel : { $ne: null } }
    }
    default:
      return undefined
  }
}

function presenceClause (field: FieldSpec, present: boolean): Clause | undefined {
  if (!serverField(field) && field.presenceQuery === undefined) return undefined
  if (field.presenceQuery !== undefined) return field.presenceQuery(present)
  switch (field.type) {
    case 'select':
    case 'user':
    case 'number':
    case 'date':
      return { [field.key]: present ? { $ne: null } : null }
    default:
      return undefined
  }
}

// `a:x OR a:y` on one field is the same as `a:x,y`
function mergeSameField (node: Extract<Node, { type: 'or' }>): Node | undefined {
  const first = node.children[0]
  if (first?.type !== 'field') return undefined
  const values: FieldValue[] = []
  for (const c of node.children) {
    if (c.type !== 'field' || c.field !== first.field) return undefined
    values.push(...c.values)
  }
  return { type: 'field', field: first.field, values, pos: first.pos }
}

function compileClause (node: Node, ctx: FilterContext): Clause | undefined {
  switch (node.type) {
    case 'text':
      return textClause(node.value)
    case 'field':
      return fieldClause(node.field, node.values, false, ctx)
    case 'presence':
      return presenceClause(node.field, node.present)
    case 'is':
      switch (node.state) {
        case 'issue':
          return {}
        case 'open':
        case 'closed': {
          if (ctx.closedStatuses === undefined) return undefined
          const ids = [...ctx.closedStatuses]
          return { status: node.state === 'open' ? { $nin: ids } : { $in: ids } }
        }
        case 'archived':
          return { archivedAt: { $ne: null } }
        default:
          return ctx.noParentId === undefined ? undefined : { attachedTo: { $ne: ctx.noParentId } }
      }
    case 'or': {
      const merged = mergeSameField(node)
      return merged !== undefined ? compileClause(merged, ctx) : undefined
    }
    case 'not': {
      // `-is:archived`
      if (node.child.type === 'is' && node.child.state === 'archived') return { archivedAt: null }
      const inner = node.child.type === 'or' ? (mergeSameField(node.child) ?? node.child) : node.child
      return inner.type === 'field' ? fieldClause(inner.field, inner.values, true, ctx) : undefined
    }
    default:
      return undefined
  }
}

/**
 * Splits a filter into the part a `DocumentQuery` can express and the part the client has to evaluate.
 * The top level AND is taken apart, each conjunct goes to the server when it is a plain condition on
 * an indexed attribute. Anything else, in particular an OR across different fields or across server
 * and client fields, is kept whole in the residual so that the combined result stays correct.
 * Conditions on `reservedKeys` (attributes the host query already constrains) are left to the client too.
 * @public
 */
export function splitServerClient (ast: Node, ctx: FilterContext, reservedKeys?: ReadonlySet<string>): SplitResult {
  const query: Record<string, any> = {}
  const rest: Node[] = []
  for (const c of conjuncts(ast)) {
    const clause = compileClause(c, ctx)
    if (clause === undefined || !mergeClause(query, clause, reservedKeys)) rest.push(c)
  }
  const residual = rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : ({ type: 'and', children: rest } as Node)
  return { query, residual }
}

/**
 * Query of a filter that is fully evaluated on the server, or undefined when part of it needs the client.
 * @public
 */
export function compileQuery (ast: Node, ctx: FilterContext): Record<string, any> | undefined {
  const { query, residual } = splitServerClient(ast, ctx)
  return residual === undefined ? query : undefined
}

/**
 * A parsed filter ready to be applied.
 * @public
 */
export interface CompiledFilter {
  ast: Node
  // Narrowing the server applies
  query: Record<string, any>
  // Client evaluation of what the server cannot do; undefined when the query is exact
  residual?: Node
  // Evaluates the residual (always true when there is none)
  predicate: (doc: any) => boolean
  // Evaluates the whole filter on the client, independently of the split
  matches: (doc: any) => boolean
}

/**
 * Parses and compiles a filter string. An empty string matches everything.
 * @public
 */
export function compileFilter (
  input: string,
  schema: readonly FieldSpec[],
  ctx: FilterContext
): { ok: true, value: CompiledFilter } | { ok: false, error: ParseError } {
  const parsed = parseFilter(input, schema)
  if (parsed.ok === false) return parsed
  const ast = parsed.value
  const { query, residual } = splitServerClient(ast, ctx)
  return {
    ok: true,
    value: {
      ast,
      query,
      residual,
      predicate: createPredicate(residual, ctx),
      matches: createPredicate(ast, ctx)
    }
  }
}

/**
 * Document properties a client evaluation of the node reads, for projecting a scan:
 * attributes by name, plus `customFields` when a user-defined field is involved.
 * @public
 */
export function referencedProperties (node: Node | undefined): string[] {
  const props = new Set<string>(['_id'])
  const visit = (n: Node): void => {
    switch (n.type) {
      case 'and':
      case 'or':
        n.children.forEach(visit)
        break
      case 'not':
        visit(n.child)
        break
      case 'text':
        props.add('title')
        break
      case 'field':
      case 'presence':
        if (n.field.source === 'custom') props.add('customFields')
        else props.add(n.field.key)
        n.field.dependsOn?.forEach((d) => props.add(d))
        break
      case 'is':
        props.add(n.state === 'sub-issue' ? 'attachedTo' : n.state === 'archived' ? 'archivedAt' : 'status')
        break
    }
  }
  if (node !== undefined) visit(node)
  return [...props]
}

/**
 * Whether a filter talks about archived items anywhere (`is:archived`, `-is:archived`). Archived items are hidden
 * unless the filter asks for them (GitHub's rule), see `archiveScopeQuery`.
 * @public
 */
export function mentionsArchived (node: Node | undefined): boolean {
  if (node === undefined) return false
  switch (node.type) {
    case 'and':
    case 'or':
      return node.children.some(mentionsArchived)
    case 'not':
      return mentionsArchived(node.child)
    case 'is':
      return node.state === 'archived'
    default:
      return false
  }
}

/**
 * The query that keeps archived items out of a view: none when the filter mentions archived items (the filter
 * decides then), otherwise `archivedAt` must be empty.
 * @public
 */
export function archiveScopeQuery (node: Node | undefined): Record<string, any> {
  return mentionsArchived(node) ? {} : { archivedAt: null }
}
