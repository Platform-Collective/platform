// SPDX-License-Identifier: EPL-2.0

import core, {
  ClassifierKind,
  type Collaborator,
  Hierarchy,
  ModelDb,
  SortingOrder,
  TxFactory,
  type Account,
  type Doc,
  type PersonId,
  type Ref,
  type Status,
  type StatusCategory
} from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'
import { createDuplicatePickerQuery, createDuplicateTargetFilter } from '../duplicate-issue-utils'

const lost = 'lost' as Ref<StatusCategory>
const active = 'active' as Ref<StatusCategory>
const status = (id: string, category: Ref<StatusCategory>): Status => {
  const result: Partial<Status> = { _id: id as Ref<Status>, category }
  return result as Status
}

function createIssue (id: string, space: string, statusId: Ref<Status>, createdBy?: PersonId, modifiedOn = 1): Issue {
  return {
    _id: id,
    _class: tracker.class.Issue,
    space,
    status: statusId,
    title: id,
    createdBy,
    modifiedOn
  } as unknown as Issue
}

function createStorage (): { db: ModelDb, hierarchy: Hierarchy, factory: TxFactory } {
  const hierarchy = new Hierarchy()
  const factory = new TxFactory(core.account.System)
  for (const [_id, parent] of [
    [core.class.Doc, undefined],
    [tracker.class.Issue, core.class.Doc],
    [core.class.Collaborator, core.class.Doc]
  ]) {
    hierarchy.tx(
      factory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        { kind: ClassifierKind.CLASS, extends: parent, label: _id as unknown as IntlString },
        _id
      )
    )
  }
  return { db: new ModelDb(hierarchy), hierarchy, factory }
}

async function addDoc<T extends Doc> (db: ModelDb, factory: TxFactory, doc: T): Promise<void> {
  const tx = factory.createTxCreateDoc(doc._class, doc.space, doc, doc._id, doc.modifiedOn, doc.createdBy)
  await db.tx(tx)
}

it('excludes canceled issues and projects without edit permission from the picker query', () => {
  const editableProjects = ['editable-a', 'editable-b'] as Array<Ref<Project>>
  expect(
    createDuplicatePickerQuery(
      [status('open', active), status('canceled-a', lost), status('canceled-b', lost)],
      editableProjects,
      lost
    )
  ).toEqual({
    status: { $in: ['open'] },
    space: { $in: editableProjects }
  })
})

it('returns an empty editable-project query until permissions have loaded', () => {
  expect(createDuplicatePickerQuery([], [], lost)).toEqual({
    status: { $in: [] },
    space: { $in: [] }
  })
})

it('uses real storage and guest rules to select only editable creator or collaborator issues', async () => {
  const { db, hierarchy, factory } = createStorage()
  const guest = {
    uuid: 'guest-account',
    socialIds: ['guest-social']
  } as unknown as Account
  const creator = createIssue('creator', 'editable', 'open' as Ref<Status>, guest.socialIds[0])
  const collaborator = createIssue('collaborator', 'visible-without-membership', 'open' as Ref<Status>)
  const unrelated = createIssue('unrelated', 'editable', 'open' as Ref<Status>)
  const canceled = createIssue('canceled', 'editable', 'canceled' as Ref<Status>, guest.socialIds[0])
  const readonly = createIssue('readonly', 'readonly', 'open' as Ref<Status>, guest.socialIds[0])
  for (const issue of [creator, collaborator, unrelated, canceled, readonly]) {
    await addDoc(db, factory, issue)
  }
  await addDoc(db, factory, {
    _id: 'collaboration',
    _class: core.class.Collaborator,
    space: collaborator.space,
    attachedTo: collaborator._id,
    attachedToClass: tracker.class.Issue,
    collection: 'collaborators',
    collaborator: guest.uuid
  } as unknown as Collaborator)

  const query = createDuplicatePickerQuery(
    [status('open', active), status('canceled', lost)],
    ['editable', 'visible-without-membership'] as Array<Ref<Project>>,
    lost
  )
  const candidates = await db.findAll(tracker.class.Issue, query)
  expect(new Set(candidates.map((issue) => issue._id))).toEqual(new Set([creator._id, collaborator._id, unrelated._id]))

  const collaborations = await db.findAll(core.class.Collaborator, { collaborator: guest.uuid })
  const guestFilter = createDuplicateTargetFilter(query, hierarchy, {
    socialIds: guest.socialIds,
    collaboratorOf: new Set(collaborations.map((collaboration) => collaboration.attachedTo))
  })
  const selected = (await db.findAll(tracker.class.Issue, {})).filter(guestFilter)
  expect(new Set(selected.map((issue) => issue._id))).toEqual(new Set([creator._id, collaborator._id]))

  const regularFilter = createDuplicateTargetFilter(query, hierarchy)
  expect(new Set(candidates.filter(regularFilter).map((issue) => issue._id))).toEqual(
    new Set([creator._id, collaborator._id, unrelated._id])
  )
})

it('applies guest eligibility before the default list limit', async () => {
  const { db, factory } = createStorage()
  const socialId = 'guest-social' as PersonId
  const open = 'open' as Ref<Status>
  const source = createIssue('source', 'editable', open, socialId, 9)
  const creator = createIssue('creator', 'editable', open, socialId, 3)
  const collaborator = createIssue('collaborator', 'editable', open, undefined, 2)
  const unknown = createIssue('unknown', 'editable', 'unknown' as Ref<Status>, socialId, 8)
  for (const issue of [source, creator, collaborator, unknown]) {
    await addDoc(db, factory, issue)
  }
  for (let i = 0; i < 200; i++) {
    await addDoc(db, factory, createIssue(`unrelated-${i}`, 'editable', open, undefined, 4))
  }
  const account = 'guest-account' as Account['uuid']
  await addDoc(db, factory, {
    _id: 'guest-collaboration',
    _class: core.class.Collaborator,
    space: collaborator.space,
    attachedTo: collaborator._id,
    attachedToClass: tracker.class.Issue,
    collection: 'collaborators',
    collaborator: account
  } as unknown as Collaborator)

  const statuses = [status('open', active)]
  const projects = ['editable' as Ref<Project>]
  const options = { limit: 200, sort: { modifiedOn: SortingOrder.Descending, _id: SortingOrder.Ascending } }
  const creators = await db.findAll(
    tracker.class.Issue,
    createDuplicatePickerQuery(statuses, projects, lost, { source: source._id, creators: [socialId] }),
    options
  )
  const collaborations = await db.findAll(core.class.Collaborator, { collaborator: account })
  const query = createDuplicatePickerQuery(statuses, projects, lost, {
    source: source._id,
    eligible: [...creators.map((issue) => issue._id), ...collaborations.map((row) => row.attachedTo as Ref<Issue>)]
  })

  const defaultList = await db.findAll(tracker.class.Issue, query, options)
  expect(defaultList.map((issue) => issue._id)).toEqual([creator._id, collaborator._id])
})
