import {
  Hierarchy,
  matchQuery,
  toFindResult,
  type Class,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type Ref,
  type Timestamp
} from '@hcengineering/core'
import type { Query, QueryId } from './types'

export interface DocumentRef {
  doc: Doc
  // A Set, not an array: with N subscribers on one class every tx re-registers the whole
  // result N times, so membership has to be O(1).
  queries: Set<QueryId>
  lastUsed: Timestamp
}

export class Refs {
  // A map of _class to documents.
  private readonly documentRefs = new Map<string, Map<Ref<Doc>, DocumentRef>>()

  constructor (readonly getHierarchy: () => Hierarchy) {}

  public updateDocuments (q: Query, docs: Doc[], clean: boolean = false): void {
    if (q.options?.projection !== undefined) {
      return
    }
    const params = ':' + JSON.stringify(q.options?.lookup ?? {}) + ':' + JSON.stringify(q.options?.associations ?? {})
    for (const d of docs) {
      const classKey = Hierarchy.mixinOrClass(d) + params

      let docMap = this.documentRefs.get(classKey)
      if (docMap === undefined) {
        if (clean) {
          continue
        }
        docMap = new Map()
        this.documentRefs.set(classKey, docMap)
      }
      const existing = docMap.get(d._id)
      if (existing === undefined) {
        if (!clean) {
          docMap.set(d._id, { doc: d, queries: new Set([q.id]), lastUsed: d.modifiedOn })
        }
        continue
      }
      if (clean) {
        // We need to remove query if it doesn't contains element anymore
        existing.queries.delete(q.id)
        if (existing.queries.size === 0) {
          docMap.delete(d._id)
          continue
        }
      }
      if (!clean) {
        // Membership does not depend on the revision: a query holding a copy another query has
        // already moved past still holds the document, and must keep it alive when that one leaves.
        existing.queries.add(q.id)
      }
      if (existing.lastUsed <= d.modifiedOn) {
        existing.doc = d
        existing.lastUsed = d.modifiedOn
      }
    }
  }

  public findFromDocs<T extends Doc> (
    _class: Ref<Class<Doc>>,
    query: DocumentQuery<Doc>,
    options?: FindOptions<T>
  ): FindResult<T> | null {
    if (typeof query._id === 'string') {
      const desc = this.getHierarchy().getDescendants(_class)
      for (const des of desc) {
        const classKey =
          des + ':' + JSON.stringify(options?.lookup ?? {}) + ':' + JSON.stringify(options?.associations ?? {})
        // One document query
        const doc = this.documentRefs.get(classKey)?.get(query._id)?.doc
        if (doc !== undefined) {
          const q = matchQuery([doc], query, _class, this.getHierarchy())
          if (q.length > 0) {
            return toFindResult(this.getHierarchy().clone([doc]), 1)
          }
        }
      }
    }
    if (
      options?.limit === 1 &&
      options.total !== true &&
      options?.sort === undefined &&
      options?.projection === undefined
    ) {
      const classKey =
        _class + ':' + JSON.stringify(options?.lookup ?? {}) + ':' + JSON.stringify(options?.associations ?? {})
      const docs = this.documentRefs.get(classKey)
      if (docs !== undefined) {
        const _docs = Array.from(docs.values()).map((it) => it.doc)

        const q = matchQuery(_docs, query, _class, this.getHierarchy())
        if (q.length > 0) {
          return toFindResult(this.getHierarchy().clone([q[0]]), 1)
        }
      }
      if (options.lookup === undefined && options.associations === undefined) {
        const keys = Array.from(this.documentRefs.keys())
        for (const key of keys) {
          if (key.startsWith(_class + ':')) {
            const docs = this.documentRefs.get(key)
            if (docs !== undefined) {
              const _docs = Array.from(docs.values()).map((it) => it.doc)

              const q = matchQuery(_docs, query, _class, this.getHierarchy())
              if (q.length > 0) {
                const clonedDoc = this.getHierarchy().clone(q[0])
                const { $lookup, $associations, ...clean } = clonedDoc
                if (this.getHierarchy().isMixin(_class)) {
                  return toFindResult([this.getHierarchy().as(clean, _class)] as T[], 1)
                }
                return toFindResult([clean], 1)
              }
            }
          }
        }
      }
    }
    return null
  }
}
