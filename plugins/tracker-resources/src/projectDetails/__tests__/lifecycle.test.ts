//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  closeProject,
  deleteProjectConfirmed,
  ProjectSettingsError,
  reopenProject,
  setProjectTemplate,
  setProjectVisibility
} from '../lifecycle'

function writer (): { client: any, updates: any[], removed: any[] } {
  const updates: any[] = []
  const removed: any[] = []
  return {
    updates,
    removed,
    client: {
      update: async (doc: any, update: any) => {
        updates.push([doc._id, update])
      },
      remove: async (doc: any) => {
        removed.push(doc._id)
      }
    }
  }
}

const project = (props: Record<string, any> = {}): any => ({
  _id: 'p1',
  name: 'Roadmap',
  archived: false,
  private: false,
  members: ['a'],
  owners: ['a'],
  ...props
})

describe('close and reopen', () => {
  it('closes an open project and reopens a closed one', async () => {
    const w = writer()
    await closeProject(w.client, project())
    await reopenProject(w.client, project({ archived: true }))
    expect(w.updates).toEqual([
      ['p1', { archived: true }],
      ['p1', { archived: false }]
    ])
  })

  it('does nothing when the project is in the wanted state', async () => {
    const w = writer()
    await closeProject(w.client, project({ archived: true }))
    await reopenProject(w.client, project())
    expect(w.updates).toEqual([])
  })
})

describe('visibility', () => {
  it('maps private and public on Space.private', async () => {
    const w = writer()
    await setProjectVisibility(w.client, project(), true)
    await setProjectVisibility(w.client, project({ private: true }), false)
    expect(w.updates).toEqual([
      ['p1', { private: true }],
      ['p1', { private: false }]
    ])
  })

  it('does nothing when nothing changes', async () => {
    const w = writer()
    await setProjectVisibility(w.client, project(), false)
    expect(w.updates).toEqual([])
  })

  it('refuses a private project nobody could open', async () => {
    const w = writer()
    await expect(setProjectVisibility(w.client, project({ members: [] }), true)).rejects.toBeInstanceOf(
      ProjectSettingsError
    )
    expect(w.updates).toEqual([])
    // making it public is always possible
    await setProjectVisibility(w.client, project({ members: [], private: true }), false)
    expect(w.updates).toHaveLength(1)
  })
})

describe('template', () => {
  it('marks and unmarks', async () => {
    const w = writer()
    await setProjectTemplate(w.client, project(), true)
    await setProjectTemplate(w.client, project({ isTemplate: true }), false)
    await setProjectTemplate(w.client, project(), false)
    expect(w.updates).toEqual([
      ['p1', { isTemplate: true }],
      ['p1', { isTemplate: false }]
    ])
  })
})

describe('delete', () => {
  it('deletes only after the name was typed', async () => {
    const w = writer()
    await expect(deleteProjectConfirmed(w.client, project(), 'roadmap')).rejects.toMatchObject({
      code: 'nameMismatch'
    })
    await expect(deleteProjectConfirmed(w.client, project(), '')).rejects.toBeInstanceOf(ProjectSettingsError)
    expect(w.removed).toEqual([])
    await deleteProjectConfirmed(w.client, project(), 'Roadmap')
    expect(w.removed).toEqual(['p1'])
  })
})
