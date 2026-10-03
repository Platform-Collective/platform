//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import tracker from '@hcengineering/tracker'
import view from '@hcengineering/view'

import { applyProjectCopyPlan, loadProjectCopySource } from '../copy'

describe('loadProjectCopySource', () => {
  it('reads the five kinds of documents of the project', async () => {
    const calls: Array<[string, any]> = []
    const client: any = {
      findAll: async (cls: string, query: any) => {
        calls.push([cls, query])
        return [{ _id: `${cls}-1` }]
      }
    }
    const project: any = { _id: 'p1', shortDescription: 's' }
    const source = await loadProjectCopySource(client, project)
    expect(calls).toEqual([
      [tracker.class.ProjectField, { space: 'p1' }],
      [tracker.class.Iteration, { space: 'p1' }],
      [view.class.FilteredView, { project: 'p1' }],
      [tracker.class.Workflow, { space: 'p1' }],
      [tracker.class.InsightChart, { space: 'p1' }]
    ])
    expect(source.project).toBe(project)
    expect(source.fields).toHaveLength(1)
    expect(source.views).toHaveLength(1)
    expect(source.charts).toHaveLength(1)
  })
})

describe('applyProjectCopyPlan', () => {
  it('creates the documents of the plan in order with their ids', async () => {
    const created: any[] = []
    const batch = {
      createDoc: async (cls: string, space: string, data: any, id: string) => {
        created.push([cls, space, data, id])
      }
    }
    const plan: any = {
      ops: [
        { _class: 'a', space: 's', id: '1', data: { x: 1 } },
        { _class: 'b', space: 's', id: '2', data: { y: 2 } }
      ]
    }
    await applyProjectCopyPlan(batch as any, plan)
    expect(created).toEqual([
      ['a', 's', { x: 1 }, '1'],
      ['b', 's', { y: 2 }, '2']
    ])
  })
})
