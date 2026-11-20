// SPDX-License-Identifier: EPL-2.0

import core, {
  ClassifierKind,
  Hierarchy,
  MeasureMetricsContext,
  TxFactory,
  TxOperations,
  TxProcessor,
  toFindResult
} from '@hcengineering/core'
import type {
  AttachedDoc,
  Class,
  Client,
  Doc,
  DocumentQuery,
  Domain,
  FindOptions,
  Obj,
  Ref,
  Tx,
  TxApplyIf,
  TxCreateDoc,
  TxCUD,
  TxMixin,
  TxUpdateDoc
} from '@hcengineering/core'
import activity from '@hcengineering/activity'
import contact from '@hcengineering/contact'
import github from '@hcengineering/github'
import type { IntlString } from '@hcengineering/platform'
import time from '@hcengineering/time'
import tracker from '@hcengineering/tracker'

/** Uses real transaction operations and processors with an in-memory collection-counter simulation. */
export class TimestampStore {
  readonly docs = new Map<string, Doc>()
  readonly metadata = new Map<string, Doc>()
  readonly txes: TxCUD<Doc>[] = []
  readonly missingParents: string[] = []
  readonly hierarchy = new Hierarchy()
  readonly ctx = new MeasureMetricsContext('timestamps', {})
  readonly client: TxOperations

  constructor (readonly backend: 'mongo' | 'postgres') {
    const factory = new TxFactory(core.account.System)
    const define = (id: Ref<Class<Obj>>, parent?: Ref<Class<Obj>>, mixin = false): void => {
      this.hierarchy.tx(
        factory.createTxCreateDoc(
          core.class.Class,
          core.space.Model,
          {
            label: id as unknown as IntlString,
            extends: parent,
            kind: mixin ? ClassifierKind.MIXIN : ClassifierKind.CLASS,
            domain: 'test' as Domain
          },
          id
        )
      )
    }
    define(core.class.Obj)
    define(core.class.Doc, core.class.Obj)
    define(core.class.Class, core.class.Doc)
    define(core.class.AttachedDoc, core.class.Doc)
    define(core.class.Attribute, core.class.Doc)
    define(tracker.class.Project, core.class.Doc)
    define(tracker.class.Issue, core.class.AttachedDoc)
    define(github.class.GithubPullRequest, tracker.class.Issue)
    define(github.class.DocSyncInfo, core.class.Doc)
    define(github.mixin.GithubIssue, tracker.class.Issue, true)
    define(activity.class.ActivityInfoMessage, core.class.AttachedDoc)
    define(github.class.GithubReview, core.class.AttachedDoc)
    define(github.class.GithubReviewComment, core.class.AttachedDoc)
    define(github.class.GithubReviewThread, core.class.AttachedDoc)
    define(time.class.ToDo, core.class.AttachedDoc)
    define(time.class.ProjectToDo, time.class.ToDo)
    define(github.mixin.GithubTodo, time.class.ToDo, true)
    define(contact.class.Person, core.class.Doc)
    define(contact.class.SocialIdentity, core.class.AttachedDoc)
    define(contact.mixin.Employee, contact.class.Person, true)
    for (const name of ['githubNumber', 'url', 'repository', 'descriptionLocked']) {
      this.hierarchy.tx(
        factory.createTxCreateDoc(core.class.Attribute, core.space.Model, {
          name,
          attributeOf: github.mixin.GithubIssue,
          type: { _class: core.class.TypeString },
          label: name as IntlString
        })
      )
    }
    this.client = new TxOperations(
      {
        getHierarchy: () => this.hierarchy,
        findOne: async (cls: Ref<Class<Doc>>, query: DocumentQuery<Doc>, options?: FindOptions<Doc>) =>
          this.findAll(cls, query, options)[0],
        findAll: async (cls: Ref<Class<Doc>>, query: DocumentQuery<Doc>, options?: FindOptions<Doc>) =>
          toFindResult(this.findAll(cls, query, options)),
        tx: async (tx: Tx) => {
          const txes = tx._class === core.class.TxApplyIf ? (tx as TxApplyIf).txes : [tx]
          const ordered =
            this.backend === 'postgres'
              ? [
                  ...txes.filter((t) => t._class !== core.class.TxMixin),
                  ...txes.filter((t) => t._class === core.class.TxMixin)
                ]
              : txes
          for (const t of ordered) this.persist(t as TxCUD<Doc>)
          // Mirror the create/delete counter branch in TriggersMiddleware.processCollection:
          // attached-doc timestamps propagate to the parent, even when they are older.
          for (const tx of txes) {
            const colTx = tx as TxCUD<AttachedDoc>
            if (
              colTx.attachedTo === undefined ||
              colTx.attachedToClass === undefined ||
              colTx.collection === undefined ||
              (tx._class !== core.class.TxCreateDoc && tx._class !== core.class.TxRemoveDoc)
            ) {
              continue
            }
            const parent = this.findAll(colTx.attachedToClass, { _id: colTx.attachedTo })[0]
            if (parent === undefined) {
              this.missingParents.push(colTx.attachedTo)
              continue
            }
            const counter = new TxFactory(colTx.modifiedBy, true).createTxUpdateDoc(
              colTx.attachedToClass,
              parent.space,
              parent._id,
              { $inc: { [colTx.collection]: tx._class === core.class.TxCreateDoc ? 1 : -1 } }
            )
            counter.modifiedOn = colTx.modifiedOn
            this.persist(counter)
          }
          const object = this.docs.get((tx as TxCUD<Doc>).objectId)
          return { success: true, object: object === undefined ? undefined : structuredClone(object) }
        }
      } as unknown as Client,
      core.account.System
    )
  }

  findAll (cls: Ref<Class<Doc>>, query: DocumentQuery<Doc>, options?: FindOptions<Doc>): Doc[] {
    if (cls === core.class.TxCUD || cls === core.class.TxMixin) return []
    const result = [...this.docs.values(), ...this.metadata.values()].filter((doc) => {
      if (!this.hierarchy.isDerived(doc._class, cls) && !this.hierarchy.hasMixin(doc, cls)) return false
      return Object.entries(query).every(([key, value]) => {
        const actual = (doc as unknown as Record<string, unknown>)[key]
        if (value !== null && typeof value === 'object') {
          const op = value as { $in?: unknown[], $nin?: unknown[], $exists?: boolean, $ne?: unknown }
          if (op.$in !== undefined) return op.$in.includes(actual)
          if (op.$nin !== undefined) return !op.$nin.includes(actual)
          if (op.$exists !== undefined) return (actual !== undefined) === op.$exists
          if ('$ne' in op) return actual !== op.$ne
        }
        return actual === value
      })
    })
    for (const [key, direction] of Object.entries(options?.sort ?? {})) {
      result.sort(
        (a, b) =>
          Number(direction) *
          (Number((a as unknown as Record<string, unknown>)[key]) -
            Number((b as unknown as Record<string, unknown>)[key]))
      )
    }
    return structuredClone(result.slice(0, options?.limit)).map((doc) =>
      this.hierarchy.isMixin(cls) ? this.hierarchy.as(doc, cls) : doc
    )
  }

  private persist (tx: TxCUD<Doc>): void {
    this.txes.push(tx)
    const target = tx.objectClass === github.class.DocSyncInfo ? this.metadata : this.docs
    const doc = target.get(tx.objectId)
    if (tx._class === core.class.TxCreateDoc) {
      target.set(tx.objectId, TxProcessor.createDoc2Doc(tx as TxCreateDoc<Doc>))
    } else if (doc !== undefined && tx._class === core.class.TxUpdateDoc) {
      TxProcessor.updateDoc2Doc(doc, tx as TxUpdateDoc<Doc>)
    } else if (doc !== undefined && tx._class === core.class.TxMixin) {
      TxProcessor.updateMixin4Doc(doc, tx as TxMixin<Doc, Doc>)
    }
  }
}
