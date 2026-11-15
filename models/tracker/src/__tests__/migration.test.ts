//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
//

import core, { DOMAIN_TX, Hierarchy } from '@hcengineering/core'
import { DOMAIN_TASK } from '@hcengineering/model-task'
import tags from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

import { DOMAIN_TRACKER } from '../types'
import view, { type Viewlet } from '@hcengineering/view'
import {
  addGanttPhase1ViewOptions,
  addSearchViewOptions,
  ensureDefaultLabelCategory,
  migrateAddStartDate,
  migrateRelationActivityAttachment
} from '../migration'
import { issuesOptions } from '../viewlets'
import trackerModel from '../plugin'

describe('migrateAddStartDate', () => {
  it('sets startDate=null on every Issue lacking the field (DOMAIN_TASK)', async () => {
    const update = jest.fn().mockResolvedValue(undefined)
    const client: any = { update }

    await migrateAddStartDate(client)

    expect(update).toHaveBeenCalledWith(
      DOMAIN_TASK,
      { _class: tracker.class.Issue, startDate: { $exists: false } },
      { startDate: null }
    )
  })

  it('sets startDate=null on every Milestone lacking the field (DOMAIN_TRACKER)', async () => {
    const update = jest.fn().mockResolvedValue(undefined)
    const client: any = { update }

    await migrateAddStartDate(client)

    expect(update).toHaveBeenCalledWith(
      DOMAIN_TRACKER,
      { _class: tracker.class.Milestone, startDate: { $exists: false } },
      { startDate: null }
    )
  })

  it('issues exactly two update calls (one per class)', async () => {
    const update = jest.fn().mockResolvedValue(undefined)
    const client: any = { update }

    await migrateAddStartDate(client)

    expect(update).toHaveBeenCalledTimes(2)
  })
})

describe('migrateRelationActivityAttachment', () => {
  it('looks up the relation create-tx in DOMAIN_TX (not DOMAIN_MODEL_TX)', async () => {
    const findDomains: string[] = []
    const client: any = {
      find: jest.fn(async (domain: string, q: any) => {
        findDomains.push(domain)
        // one broken remove-DUM on the first (DOMAIN_ACTIVITY) call:
        if (domain === 'activity') {
          return [{ _id: 'dum1', objectId: 'rel1', attachedToClass: 'x', updateCollection: undefined }]
        }
        return [] // tx lookup returns empty regardless of domain
      }),
      update: jest.fn(async () => undefined)
    }
    await migrateRelationActivityAttachment(client)
    // The create-tx lookup MUST hit DOMAIN_TX, never DOMAIN_MODEL_TX.
    expect(findDomains).toContain(DOMAIN_TX)
    expect(findDomains).not.toContain('model_tx')
  })
})

describe('ensureDefaultLabelCategory', () => {
  it('creates the default issue label category when it is missing', async () => {
    const tx: any = {
      findOne: jest.fn().mockResolvedValue(undefined),
      createDoc: jest.fn().mockResolvedValue(tracker.category.Other)
    }

    await ensureDefaultLabelCategory(tx)

    expect(tx.findOne).toHaveBeenCalledWith(tags.class.TagCategory, { _id: tracker.category.Other })
    expect(tx.createDoc).toHaveBeenCalledWith(
      tags.class.TagCategory,
      core.space.Workspace,
      expect.objectContaining({ targetClass: tracker.class.Issue, default: true }),
      tracker.category.Other
    )
  })

  it('leaves an existing category untouched', async () => {
    const tx: any = {
      findOne: jest.fn().mockResolvedValue({ _id: tracker.category.Other, label: 'Custom' }),
      createDoc: jest.fn(),
      update: jest.fn()
    }

    await ensureDefaultLabelCategory(tx)

    expect(tx.createDoc).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('addSearchViewOptions', () => {
  // Right after `backup-restore --upgrade` of an older workspace the upgrade client returned the stored
  // IssueList/IssueKanban viewlets without `_id`; `txOp.update(v, ...)` then sent a TxUpdateDoc with
  // objectId undefined, NormalizeTxMiddleware rejected it (BadRequest) and the migration state failed.
  function upgradeClient (viewlets: Array<Partial<Viewlet>>): { client: any, txes: any[] } {
    const txes: any[] = []
    const client: any = {
      getHierarchy: () => new Hierarchy(),
      getModel: () => undefined,
      findAll: jest.fn(async (_class: unknown, query: { _id: string }) =>
        viewlets.filter((v) => (v as any).$id === query._id).map(({ $id, ...rest }: any) => rest)
      ),
      findOne: jest.fn(async () => undefined),
      tx: jest.fn(async (tx: unknown) => {
        txes.push(tx)
        return {}
      })
    }
    return { client, txes }
  }

  it('addresses the viewlet by its known id even when the stored doc comes back without _id', async () => {
    const old = {
      groupBy: ['status'],
      orderBy: [],
      other: [{ key: 'shouldShowSubIssues', type: 'toggle', defaultValue: true }]
    }
    const { client, txes } = upgradeClient([
      {
        $id: trackerModel.viewlet.IssueList,
        _class: view.class.Viewlet,
        space: core.space.Model,
        viewOptions: old
      } as any,
      {
        $id: trackerModel.viewlet.IssueKanban,
        _class: view.class.Viewlet,
        space: core.space.Model,
        viewOptions: old
      } as any
    ])

    await addSearchViewOptions(client)

    expect(txes.map((tx) => tx.objectId)).toEqual([trackerModel.viewlet.IssueList, trackerModel.viewlet.IssueKanban])
    for (const tx of txes) {
      expect(tx.objectClass).toBe(view.class.Viewlet)
      expect(tx.objectSpace).toBe(core.space.Model)
      const keys = tx.operations.viewOptions.other.map((o: { key: string }) => o.key)
      expect(keys).toEqual(
        expect.arrayContaining(['shouldShowSubIssues', 'showQuickModeSelector', 'searchScope', 'searchHighlight'])
      )
      expect(tx.operations.viewOptions.groupBy).toEqual(['status'])
    }
  })

  it('is a no-op when the stored viewlets already carry every option', async () => {
    const full = (kanban: boolean): any => ({ groupBy: [], orderBy: [], other: issuesOptions(kanban).other })
    const { client, txes } = upgradeClient([
      {
        $id: trackerModel.viewlet.IssueList,
        _id: trackerModel.viewlet.IssueList,
        _class: view.class.Viewlet,
        space: core.space.Model,
        viewOptions: full(false)
      } as any,
      {
        $id: trackerModel.viewlet.IssueKanban,
        _id: trackerModel.viewlet.IssueKanban,
        _class: view.class.Viewlet,
        space: core.space.Model,
        viewOptions: full(true)
      } as any
    ])

    await addSearchViewOptions(client)

    expect(txes).toEqual([])
  })
})

describe('addGanttPhase1ViewOptions', () => {
  it('uses the known id and preserves custom options on repeated runs', async () => {
    const custom = { key: 'ganttBarLabelLeft', type: 'toggle', defaultValue: 'custom' }
    const stored: any = { viewOptions: { groupBy: ['status'], orderBy: [['rank', 1]], other: [custom] } }
    const txes: any[] = []
    const client: any = {
      getHierarchy: () => new Hierarchy(),
      getModel: () => undefined,
      findAll: jest.fn(async () => [stored]),
      findOne: jest.fn(async () => undefined),
      tx: jest.fn(async (tx: any) => {
        txes.push(tx)
        Object.assign(stored, tx.operations)
        return {}
      })
    }
    await addGanttPhase1ViewOptions(client)
    await addGanttPhase1ViewOptions(client)
    expect(txes).toHaveLength(1)
    expect(txes[0]).toMatchObject({
      objectId: trackerModel.viewlet.IssueGantt,
      objectClass: view.class.Viewlet,
      objectSpace: core.space.Model
    })
    expect(stored.viewOptions.groupBy).toEqual(['status'])
    expect(stored.viewOptions.orderBy).toEqual([['rank', 1]])
    expect(stored.viewOptions.other[0]).toEqual(custom)
    expect(stored.viewOptions.other.map((o: { key: string }) => o.key)).toEqual(
      expect.arrayContaining(['ganttBarLabelLeft', 'ganttBarLabelInside', 'ganttBarLabelRight', 'ganttQuickInfoOnClick'])
    )
  })
})
