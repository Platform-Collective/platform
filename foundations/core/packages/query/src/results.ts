//
// Copyright © 2026 Intabia Fusion.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import {
  resultSort,
  WithLookup,
  type Class,
  type Doc,
  type Hierarchy,
  type MemDb,
  type Ref,
  type SortingQuery,
  type Timestamp,
  type Tx
} from '@hcengineering/core'

export class ResultArray {
  private docs: Map<Ref<Doc>, WithLookup<Doc>>
  private readonly loadedModifiedOn = new Map<Ref<Doc>, Timestamp>()

  // An equal-timestamp $inc is applied locally, so a re-delivered tx would increment twice.
  // Ids are kept only for the doc's current timestamp, which only moves forward.
  private readonly appliedInc = new Map<Ref<Doc>, { ts: Timestamp, ids: Set<Ref<Tx>> }>()

  private readonly clones = new Map<string, Map<Ref<Doc>, WithLookup<Doc>>>()

  get length (): number {
    return this.docs.size
  }

  constructor (
    docs: Doc[],
    readonly hierarchy: Hierarchy
  ) {
    this.docs = new Map(docs.map((it) => [it._id, it]))
    for (const doc of docs) {
      this.loadedModifiedOn.set(doc._id, doc.modifiedOn)
    }
  }

  isLoadedAtModifiedOn (_id: Ref<Doc>, modifiedOn: Timestamp): boolean {
    return this.loadedModifiedOn.get(_id) === modifiedOn
  }

  setLoadedModifiedOn (_id: Ref<Doc>, modifiedOn: Timestamp): void {
    this.loadedModifiedOn.set(_id, modifiedOn)
  }

  clearLoadedModifiedOn (_id: Ref<Doc>): void {
    this.loadedModifiedOn.delete(_id)
  }

  isIncApplied (_id: Ref<Doc>, txId: Ref<Tx>, modifiedOn: Timestamp): boolean {
    const applied = this.appliedInc.get(_id)
    return applied?.ts === modifiedOn && applied.ids.has(txId)
  }

  markIncApplied (_id: Ref<Doc>, txId: Ref<Tx>, modifiedOn: Timestamp): void {
    const applied = this.appliedInc.get(_id)
    if (applied?.ts === modifiedOn) {
      applied.ids.add(txId)
    } else {
      this.appliedInc.set(_id, { ts: modifiedOn, ids: new Set([txId]) })
    }
  }

  clean (): void {
    this.clones.clear()
  }

  getDocs (): WithLookup<Doc>[] {
    return Array.from(this.docs.values())
  }

  findDoc (_id: Ref<Doc>): WithLookup<Doc> | undefined {
    return this.docs.get(_id)
  }

  getClone<T extends Doc> (): T[] {
    return this.hierarchy.clone(this.getDocs())
  }

  getResult (id: string): Doc[] {
    // Lets form a new list based on clones we have already.
    const info = this.clones.get(id)
    if (info === undefined) {
      const docs = this.getClone()
      this.clones.set(id, new Map(docs.map((it) => [it._id, it])))
      return docs
    } else {
      return Array.from(info.values())
    }
  }

  delete (_id: Ref<Doc>): Doc | undefined {
    this.loadedModifiedOn.delete(_id)
    this.appliedInc.delete(_id)
    const doc = this.docs.get(_id)
    this.docs.delete(_id)
    for (const [, v] of this.clones.entries()) {
      v.delete(_id)
    }
    return doc
  }

  // Both return the object actually stored, which is a clone of the argument unless told
  // otherwise: Refs has to point at that one, or later in-place updates pass it by.
  updateDoc (doc: WithLookup<Doc>, mainClone = true): WithLookup<Doc> {
    const stored = mainClone ? this.hierarchy.clone(doc) : doc
    this.docs.set(doc._id, stored)
    for (const [, v] of this.clones.entries()) {
      v.set(doc._id, this.hierarchy.clone(doc))
    }
    return stored
  }

  push (doc: WithLookup<Doc>): WithLookup<Doc> {
    const stored = this.hierarchy.clone(doc)
    this.docs.set(doc._id, stored)
    for (const [, v] of this.clones.entries()) {
      v.set(doc._id, this.hierarchy.clone(doc))
    }
    return stored
  }

  pop (): WithLookup<Doc> | undefined {
    const lastElement = Array.from(this.docs)[this.docs.size - 1]
    if (lastElement !== undefined) {
      this.docs.delete(lastElement[0])
      for (const [, v] of this.clones.entries()) {
        v.delete(lastElement[0])
      }
      return lastElement[1]
    }
    return undefined
  }

  sort<T extends Doc> (_class: Ref<Class<Doc>>, sort: SortingQuery<T>, hierarchy: Hierarchy, memdb: MemDb): void {
    const docs = Array.from(this.docs.values())
    resultSort(docs, sort, _class, hierarchy, memdb)
    this.docs = new Map(docs.map((it) => [it._id, it]))
    for (const [k, v] of this.clones.entries()) {
      this.clones.set(k, new Map(docs.map((it) => [it._id, v.get(it._id) ?? this.hierarchy.clone(it)])))
    }
  }
}
